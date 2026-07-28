-- ================================================================
-- Migration: Cloud WiFi Credentials + Dual-Path Upload Tracking
-- ================================================================
-- Adds wifi_networks JSONB to devices (cloud-stored WiFi list).
-- Adds wifi_connected columns to gps_records and device_status
-- so the dashboard can track which data path each upload used.
-- ================================================================


-- ── 1. Cloud-stored WiFi networks per device ──────────────────
-- Stored as a JSONB array:
--   [{"ssid": "HomeWiFi", "password": "secret", "added_at": "..."}]
-- The ESP32 fetches this on boot via LTE, merges with NVS cache,
-- then auto-connects to the strongest known network.
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.devices
  ADD COLUMN IF NOT EXISTS wifi_networks JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.devices.wifi_networks IS
  'Cloud-stored WiFi credential list. Array of {ssid, password, added_at}. '
  'ESP32 fetches this on boot to auto-provision WiFi.';


-- ── 2. Data-path tracking in GPS records ──────────────────────
-- Records whether a GPS point was uploaded via WiFi (true)
-- or LTE fallback (false). Useful for fleet health diagnostics.
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.gps_records
  ADD COLUMN IF NOT EXISTS wifi_connected BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.gps_records.wifi_connected IS
  'TRUE = uploaded via WiFi, FALSE = uploaded via LTE modem.';


-- ── 3. WiFi status in device_status ───────────────────────────
ALTER TABLE public.device_status
  ADD COLUMN IF NOT EXISTS wifi_connected BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE public.device_status
  ADD COLUMN IF NOT EXISTS wifi_ssid TEXT;

COMMENT ON COLUMN public.device_status.wifi_connected IS
  'Whether device is currently on a WiFi network.';
COMMENT ON COLUMN public.device_status.wifi_ssid IS
  'SSID of the currently connected WiFi network (NULL if LTE only).';


-- ── 4. Helper function: append a WiFi credential ──────────────
-- Called by the /provision Edge Function.
-- Prevents duplicate SSIDs from accumulating in the JSONB array.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.upsert_device_wifi(
  p_device_uuid UUID,
  p_ssid        TEXT,
  p_password    TEXT
)
RETURNS VOID AS $$
DECLARE
  existing_networks JSONB;
  new_entry         JSONB;
BEGIN
  SELECT wifi_networks INTO existing_networks
  FROM public.devices WHERE id = p_device_uuid;

  -- Remove any existing entry with the same SSID first
  existing_networks := (
    SELECT COALESCE(jsonb_agg(elem), '[]'::jsonb)
    FROM jsonb_array_elements(existing_networks) AS elem
    WHERE elem->>'ssid' != p_ssid
  );

  new_entry := jsonb_build_object(
    'ssid',     p_ssid,
    'password', p_password,
    'added_at', NOW()::TEXT
  );

  UPDATE public.devices
  SET wifi_networks = existing_networks || jsonb_build_array(new_entry)
  WHERE id = p_device_uuid;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION public.upsert_device_wifi IS
  'Adds or updates a WiFi credential for a device. Prevents duplicate SSIDs.';


-- ── 5. Helper function: remove a WiFi credential ──────────────
CREATE OR REPLACE FUNCTION public.remove_device_wifi(
  p_device_uuid UUID,
  p_ssid        TEXT
)
RETURNS VOID AS $$
BEGIN
  UPDATE public.devices
  SET wifi_networks = (
    SELECT COALESCE(jsonb_agg(elem), '[]'::jsonb)
    FROM jsonb_array_elements(wifi_networks) AS elem
    WHERE elem->>'ssid' != p_ssid
  )
  WHERE id = p_device_uuid;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION public.remove_device_wifi IS
  'Removes a WiFi credential by SSID for a given device.';
