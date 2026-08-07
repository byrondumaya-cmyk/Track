-- Tracking controls + history deletion support
-- 1) Add per-device toggles for recording history/events.
-- 2) Allow authenticated dashboard users to update device settings.
-- 3) Allow authenticated dashboard users to delete history records.
-- 4) Skip checkpoint_visit system events when event recording is paused.

-- ── 1. Per-device tracking toggles ───────────────────────────────────────────
ALTER TABLE public.devices
  ADD COLUMN IF NOT EXISTS track_history_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS track_events_enabled  BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN public.devices.track_history_enabled IS
  'When FALSE, ingest skips inserting gps_records for this device.';
COMMENT ON COLUMN public.devices.track_events_enabled IS
  'When FALSE, ingest and checkpoint triggers skip writing system_events for this device.';

-- ── 2. Allow authenticated users to update devices from dashboard ───────────
ALTER TABLE public.devices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "devices_update_auth" ON public.devices;
CREATE POLICY "devices_update_auth"
  ON public.devices
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- ── 3. Allow authenticated users to delete history data ─────────────────────
ALTER TABLE public.gps_records ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "gps_records_delete_auth" ON public.gps_records;
CREATE POLICY "gps_records_delete_auth"
  ON public.gps_records
  FOR DELETE
  TO authenticated
  USING (true);

ALTER TABLE public.checkpoint_visits ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "checkpoint_visits_delete_auth" ON public.checkpoint_visits;
CREATE POLICY "checkpoint_visits_delete_auth"
  ON public.checkpoint_visits
  FOR DELETE
  TO authenticated
  USING (true);

-- ── 4. Respect event tracking toggle in checkpoint-visit mirroring ──────────
CREATE OR REPLACE FUNCTION public.log_checkpoint_visit_event()
RETURNS TRIGGER AS $$
DECLARE
  cp_name TEXT;
  events_enabled BOOLEAN;
BEGIN
  SELECT d.track_events_enabled
  INTO events_enabled
  FROM public.devices d
  WHERE d.id = NEW.device_id;

  IF COALESCE(events_enabled, TRUE) = FALSE THEN
    RETURN NEW;
  END IF;

  SELECT name INTO cp_name
  FROM public.checkpoints
  WHERE id = NEW.checkpoint_id;

  INSERT INTO public.system_events (device_id, event_type, payload, timestamp)
  VALUES (
    NEW.device_id,
    'checkpoint_visit',
    jsonb_build_object(
      'checkpoint_id', NEW.checkpoint_id,
      'checkpoint_name', cp_name,
      'gps_record_id', NEW.gps_record_id,
      'distance_m', NEW.distance_m,
      'visited_at', NEW.visited_at
    ),
    NEW.visited_at
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
