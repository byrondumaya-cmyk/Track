-- ================================================================
-- Migration: SIM and APN Configuration
-- ================================================================
-- Adds apn, sim_number, and sim_carrier columns to the devices table.
-- Allows dynamic APN provisioning and tracking SIM info per device.
-- ================================================================

ALTER TABLE public.devices
  ADD COLUMN IF NOT EXISTS apn TEXT,
  ADD COLUMN IF NOT EXISTS sim_number TEXT,
  ADD COLUMN IF NOT EXISTS sim_carrier TEXT;

COMMENT ON COLUMN public.devices.apn IS
  'Cellular APN used for LTE connection (e.g. internet, internet.globe.com.ph). Fetched by ESP32 on boot.';
COMMENT ON COLUMN public.devices.sim_number IS
  'Phone number of the inserted SIM card.';
COMMENT ON COLUMN public.devices.sim_carrier IS
  'Carrier name (e.g. Smart PH, Globe PH).';
