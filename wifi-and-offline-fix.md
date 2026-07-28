# WiFi Setup & Offline Status Fix Plan

## Goal
Fix the two core issues reported:
1. **Firmware:** The device reboots immediately after saving WiFi credentials, dropping the AP before the user knows if the connection actually succeeded.
2. **Dashboard:** The device shows "offline" because Vercel/Supabase free tiers do not run the `pg_cron` offline detector, or the device is failing to upload due to incorrect credentials.

---

## Proposed Changes

### 1. Firmware: Validate WiFi Connection & LED Status
*File: `firmware/src/main.cpp`*
- **Switch to `WIFI_AP_STA` mode** during provisioning. This allows the ESP32 to keep the captive portal (AP) running while simultaneously testing the new WiFi credentials (STA).
- **Update Captive Portal Logic:** Instead of immediately saving and rebooting, the `/save` endpoint will attempt to connect to the provided SSID.
  - If successful: Send a success page to the user, then reboot.
  - If failed: Send an error page so the user can try again without the AP dropping.
- **Add LED Status Indicator:** Define an `LED_PIN` (commonly GPIO 13 on LILYGO boards) to provide visual feedback:
  - Fast Blink: Provisioning mode / AP active
  - Slow Blink: Connecting to WiFi/LTE
  - Solid On: Connected and successfully uploading

### 2. Frontend: Client-Side Staleness Check
*File: `dashboard/src/pages/LiveMap.tsx`*
- Currently, the dashboard relies on the database `status` column being exactly `'online'`. On Supabase free tier, the `pg_cron` job that marks stale devices as offline does not run.
- **Change:** Implement a client-side staleness check. The dashboard will compare the `last_seen` timestamp with the current time. If it's been more than 3 minutes, it will display as `OFFLINE`, regardless of the database string.

### 3. Backend: Enhance Ingest Error Logging
*File: `backend/supabase/functions/ingest/index.ts`*
- Add console logs for authentication failures (e.g., "Invalid API key" or "Device not registered"). This will allow you to see in the Supabase Edge Function logs if the ESP32 is successfully reaching the internet but failing to authenticate (which is a common reason for a device appearing offline).

---

## User Review Required

> [!IMPORTANT]
> **API Key & Host Configuration**
> If your device is connected to WiFi but still not appearing online, please verify that you have updated `firmware/src/secrets.h` with your actual Supabase URL and the Device API Key (`gtrk-aliaga-2026-change-this-before-deploy`). 

## Open Questions

1. Does your specific LILYGO T-Call A7670 board have an onboard LED on GPIO 13? (I will use GPIO 13 as a default, which is standard, but you can adjust it later if needed).

---

## Verification Plan
- **Manual Verification:** Connect to the `GarbageTrack-Setup` AP, enter a wrong password, and verify the AP stays active and shows an error. Enter the correct password and verify it shows success before rebooting.
- **Dashboard Verification:** Check that the LiveMap correctly reports offline status if the `last_seen` is older than 3 minutes.
