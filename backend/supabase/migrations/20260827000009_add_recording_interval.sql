-- Add recording_interval_s to devices table
ALTER TABLE public.devices ADD COLUMN IF NOT EXISTS recording_interval_s INTEGER DEFAULT 5;
