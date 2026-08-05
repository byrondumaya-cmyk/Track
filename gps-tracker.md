# GPS Tracker System — Implementation Plan

## Goal
Build a solar-powered, fully autonomous GPS tracking system for a Tracker prototype using LILYGO T-Call A7670 (ESP32), Supabase backend, and a Vite+React dashboard with Leaflet maps.

---

## Tech Stack (Locked)

| Layer | Technology |
|-------|-----------|
| MCU | LILYGO T-Call A7670 (ESP32) |
| Firmware | C++ · Arduino framework · FreeRTOS |
| Local Storage | SD Card (primary, JSONL) + LittleFS (config/fallback) |
| Connectivity | HTTPS REST (device→cloud) · Supabase Realtime (cloud→dashboard) |
| Backend | Supabase (PostgreSQL + PostGIS + Edge Functions + Auth + Realtime) |
| Frontend | Vite + React + TypeScript + shadcn/ui |
| Maps | Leaflet.js + OpenStreetMap (centered: 15.49°N, 120.83°E — Aliaga, NE) |
| Hosting | Vercel (free tier) |
| Power | LiFePO4 12V 10Ah + 10W solar + MPPT controller + 12V→5V 3A buck |

---

## Phase 1 — Hardware Validation (Week 1–2)

- [ ] Task 1.1: Source all hardware components (LILYGO A7670, LiFePO4 battery, 10W solar, MPPT, SD module, IP67 enclosure) → Verify: all items received and accounted for
- [ ] Task 1.2: Flash LILYGO T-Call A7670 with Arduino IDE — run blinky test → Verify: LED blinks, serial output seen
- [ ] Task 1.3: Insert SIM card, run AT command test via Serial Monitor (`AT+CREG?`, `AT+CSQ`) → Verify: LTE registers, RSSI returns value
- [ ] Task 1.4: Test GPS acquisition with external active antenna outdoors → Verify: NMEA sentences appear on UART, lat/lon values valid
- [ ] Task 1.5: Wire and test SD card module (SPI) → Verify: SD.begin() returns true, file write/read works
- [ ] Task 1.6: Assemble solar + MPPT + battery + buck converter circuit → Verify: 5V stable on output under load, battery charges with solar
- [ ] Task 1.7: Measure actual ESP32 current draw (idle, GPS active, LTE transmit) with multimeter → Verify: readings logged for power budget validation

**Milestone:** Device powers on, acquires GPS, registers on LTE, SD card works, 5V stable from solar system.

---

## Phase 2 — Firmware Core (Week 3–5)

> Branch: `feature/firmware-core`

- [ ] Task 2.1: Create firmware project in PlatformIO (ESP32 + Arduino framework) → Verify: `pio run` compiles without errors
- [ ] Task 2.2: Implement `ConfigManager` — load device ID, API key, APN from LittleFS JSON → Verify: config loaded and printed on boot
- [ ] Task 2.3: Implement `GPSManager` FreeRTOS task — parse NMEA from A7670 UART → Verify: lat/lon/speed/heading/HDOP printed to serial
- [ ] Task 2.4: Implement `LTEManager` FreeRTOS task — AT command state machine (DISCONNECTED→CONNECTING→CONNECTED) → Verify: state transitions logged, reconnect on drop
- [ ] Task 2.5: Implement `BufferManager` — write GPS record as JSONL to SD card → Verify: records appended to `/gps_buffer.jsonl` on SD
- [ ] Task 2.6: Implement `PowerManager` — ADC read of battery voltage, sleep mode triggers → Verify: battery % printed every 60s, modem sleep on low battery
- [ ] Task 2.7: Implement `WatchdogManager` — hardware WDT + per-task software ping — Verify: intentional task hang triggers WDT reboot within 30s
- [ ] Task 2.8: Implement `InternetManager` — HTTP HEAD to Supabase health endpoint to verify real connectivity → Verify: INTERNET_UP/INTERNET_DOWN event fires correctly
- [ ] Task 2.9: Wire FreeRTOS inter-task communication (GPS_Queue, LTE_EventGroup, Power_EventGroup) → Verify: upload manager wakes on INTERNET_UP event

**Milestone:** Device logs GPS to SD card, manages LTE connection, watchdog recovers from hang, power manager tracks battery.

---

## Phase 3 — Backend Setup (Week 4–6)

> Branch: `feature/backend-setup`

- [ ] Task 3.1: Create Supabase project → Verify: project URL and anon key available
- [ ] Task 3.2: Enable PostGIS extension in Supabase SQL editor → Verify: `CREATE EXTENSION postgis;` succeeds
- [ ] Task 3.3: Create DB tables: `devices`, `gps_records`, `device_status`, `system_events` (with PostGIS GEOGRAPHY column) → Verify: tables visible in Supabase Table Editor
- [ ] Task 3.4: Create indexes on `gps_records(device_id, timestamp DESC)` and `gps_records(location)` GIST → Verify: `\d gps_records` shows indexes
- [ ] Task 3.5: Write Supabase Edge Function `/ingest` — validate `X-API-Key` header, insert GPS records batch → Verify: Postman POST with valid key returns `{"status":"ok"}`, invalid key returns 401
- [ ] Task 3.6: Write Supabase Edge Function `/event` — insert system events → Verify: Postman POST inserts row in `system_events`
- [ ] Task 3.7: Write Supabase Edge Function `/config` — return device config JSON → Verify: GET returns interval and threshold values
- [ ] Task 3.8: Configure Row-Level Security policies on all tables — dashboard users read-only, Edge Functions write via service key → Verify: anon key cannot write directly to `gps_records`
- [ ] Task 3.9: Set up `device_status` trigger — auto-upsert on each GPS insert → Verify: `device_status` row updates after each insert

**Milestone:** Backend accepts GPS records via HTTPS, stores to PostgreSQL, RLS active, Postman tests all pass.

---

## Phase 4 — Device-Cloud Integration (Week 6–7)

> Branch: `feature/device-cloud-integration`

- [ ] Task 4.1: Implement `UploadManager` FreeRTOS task — batch-read SD card records, POST to `/ingest` → Verify: records appear in Supabase `gps_records` table after POST
- [ ] Task 4.2: Test offline buffering scenario — disconnect SIM → let records accumulate on SD → reinsert SIM → verify all records uploaded in order → Verify: no records missing, timestamps correct
- [ ] Task 4.3: Test power interruption recovery — pull power mid-upload → restore → verify system resumes → Verify: no data corruption, boot log shows reboot reason
- [ ] Task 4.4: Test watchdog recovery with forced crash (infinite loop in GPS task) → Verify: reboots within 30s, event logged in `system_events`
- [ ] Task 4.5: Verify NTP time sync — A7670 syncs time via LTE on connect → Verify: GPS record timestamps match real UTC within ±2s
- [ ] Task 4.6: Test rate limiting — send >10 requests/min from device → Verify: Edge Function returns 429 after threshold

**Milestone:** Full end-to-end flow works. Offline buffering verified. Recovery from crash, reboot, and power loss confirmed.

---

## Phase 5 — Web Dashboard (Week 7–10)

> Branch: `feature/web-dashboard`

- [ ] Task 5.1: Init Vite + React + TypeScript project — install shadcn/ui, Leaflet.js, Supabase JS, React Router → Verify: `npm run dev` opens blank app
- [ ] Task 5.2: Implement login page with Supabase Auth (email/password) → Verify: login redirects to dashboard, JWT stored in session
- [ ] Task 5.3: Build live map page — Leaflet.js centered on Aliaga NE, custom truck marker with heading rotation → Verify: map loads, marker placed at correct coordinates
- [ ] Task 5.4: Subscribe to Supabase Realtime (`device_status` table) → update map marker on change → Verify: map marker moves in real time as ESP32 sends data
- [ ] Task 5.5: Build status card row (GPS status, LTE signal bars, battery %, last seen timestamp) → Verify: all values update live from Realtime subscription
- [ ] Task 5.6: Build History page — date picker loads route for selected date as polyline on map → Verify: selecting yesterday shows route correctly
- [ ] Task 5.7: Build Route Replay — animated marker playback with speed control (1×, 2×, 5×) and scrubber slider → Verify: playback animates along route, slider controls position
- [ ] Task 5.8: Build Events page — table of `system_events` (GPS_NO_FIX, REBOOT, LTE_RECONNECT, etc.) → Verify: events appear after triggering them on device
- [ ] Task 5.9: Deploy to Vercel, connect GitHub repo → Verify: production URL accessible, login works on live URL

**Milestone:** Dashboard shows live truck location, history playback works, events visible, deployed to Vercel.

---

## Phase 6 — Field Testing (Week 10–12)

- [ ] Task 6.1: Install device in weatherproof enclosure with external GPS + LTE antennas on roof of truck → Verify: antennas mounted securely, cables routed through cable glands
- [ ] Task 6.2: Run 48-hour continuous field test on actual truck — monitor dashboard → Verify: uptime >99%, <1% GPS record loss
- [ ] Task 6.3: Drive through LTE dead zones in Aliaga — verify buffering and sync → Verify: records buffered on SD, uploaded after reconnect, no gaps in track
- [ ] Task 6.4: Check solar charging performance over 2 days → Verify: battery stays above 50% on sunny days, charge controller logs look correct
- [ ] Task 6.5: Test rain and vibration resistance during actual truck operation → Verify: no moisture ingress, device remains operational
- [ ] Task 6.6: Measure real-world power consumption with USB power meter → Verify: matches design estimate (avg ~300mA @ 5V)
- [ ] Task 6.7: Stress test dashboard with simulated historical data (10,000 records) → Verify: history page loads in <3 seconds

**Milestone:** System runs unattended for 48 hours, <1% data loss, enclosure passes rain test, solar system self-sustaining.

---

## Phase 7 — Documentation & Thesis (Week 12+)

- [ ] Task 7.1: Document hardware wiring diagram (Fritzing or draw.io) → Verify: diagram matches actual physical build
- [ ] Task 7.2: Document firmware architecture with module diagram and task communication flow → Verify: diagram reviewed and matches code
- [ ] Task 7.3: Document API specification (all Edge Function endpoints with request/response examples) → Verify: Postman collection exported and importable
- [ ] Task 7.4: Compile performance metrics (uptime %, data loss %, GPS accuracy, battery runtime, solar surplus) → Verify: numbers sourced from actual field test logs
- [ ] Task 7.5: Write thesis chapters: System Design, Implementation, Testing, Results → Verify: chapters reviewed by thesis adviser

**Milestone:** Complete system documentation, performance data validated, thesis chapters drafted.

---

## Done When

- [ ] ESP32 runs unattended for 48+ hours without manual intervention
- [ ] GPS tracks truck in real-time visible on dashboard map
- [ ] Offline buffering syncs correctly after LTE interruption
- [ ] Battery sustained by solar charging
- [ ] Watchdog recovers from any firmware crash
- [ ] Dashboard accessible from any browser after login
- [ ] All field test metrics documented for thesis

---

## Notes

- **Device ID:** `TL-001` (TrackLocator 001)
- **APN:** Depends on SIM provider (Smart PH: `internet`, Globe: `internet.globe.com.ph`)
- **Supabase project pauses after 1 week inactivity** — set up a keepalive cron (GitHub Actions or Vercel cron) that pings the health endpoint every 3 days
- **GPS:** If A7670 built-in GPS is unreliable indoors, add external u-blox M8N on UART2
- **OTA updates:** Phase 2 feature — implement after field test is stable
- **Geofencing / alerts:** Phase 2 roadmap — architecture already supports it via PostGIS `ST_Contains`
