-- Event log enhancements:
-- 1) Allow authenticated dashboard users to delete logs.
-- 2) Mirror checkpoint visit detections into system_events.

-- ── 1. Deletion policy for Event Log management ──────────────────────────────
ALTER TABLE public.system_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "system_events_delete_auth" ON public.system_events;
CREATE POLICY "system_events_delete_auth"
  ON public.system_events
  FOR DELETE
  TO authenticated
  USING (true);

-- ── 2. Checkpoint visit -> system event mirror ───────────────────────────────
CREATE OR REPLACE FUNCTION public.log_checkpoint_visit_event()
RETURNS TRIGGER AS $$
DECLARE
  cp_name TEXT;
BEGIN
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

DROP TRIGGER IF EXISTS tr_log_checkpoint_visit_event ON public.checkpoint_visits;
CREATE TRIGGER tr_log_checkpoint_visit_event
AFTER INSERT ON public.checkpoint_visits
FOR EACH ROW
EXECUTE FUNCTION public.log_checkpoint_visit_event();
