-- ================================================================
-- Migration: Fix device_status trigger to use server-side NOW()
--            for last_seen instead of the GPS-derived timestamp.
--
-- Root Cause: When the MCU has no GPS fix, buildTimestamp() returns
-- "1970-01-01T00:00:00Z". Storing this as last_seen causes
-- mark_stale_devices_offline() to immediately mark the device
-- offline even though records are actively arriving.
--
-- Fix: last_seen = NOW() (server receive time) so the offline
--      detector always sees the true wall-clock time of last receipt.
--      The gps_records.timestamp column still holds the MCU GPS time
--      for accurate route history playback.
-- ================================================================

CREATE OR REPLACE FUNCTION public.update_device_status_on_gps()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.device_status (
    device_id,
    last_seen,
    last_lat,
    last_lon,
    last_speed,
    battery_pct,
    rssi_dbm,
    lte_connected,
    gps_fix,
    status
  )
  VALUES (
    NEW.device_id,
    NOW(),           -- server receive time (NOT the GPS-derived MCU timestamp)
    NEW.lat,
    NEW.lon,
    NEW.speed_kmh,
    NEW.battery_pct,
    NEW.rssi_dbm,
    NEW.lte_connected,
    NEW.gps_fix,
    'online'
  )
  ON CONFLICT (device_id) DO UPDATE SET
    last_seen     = NOW(),   -- server receive time
    last_lat      = EXCLUDED.last_lat,
    last_lon      = EXCLUDED.last_lon,
    last_speed    = EXCLUDED.last_speed,
    battery_pct   = EXCLUDED.battery_pct,
    rssi_dbm      = EXCLUDED.rssi_dbm,
    lte_connected = EXCLUDED.lte_connected,
    gps_fix       = EXCLUDED.gps_fix,
    status        = 'online';

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
