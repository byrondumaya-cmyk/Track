# GarbageTrack — Code Explanation

**Version:** 1.2.0  
**Codebase:** Firmware (C++/Arduino) + Backend (Deno/TypeScript) + Frontend (React/TypeScript)

---

## 1. Project Structure

```
Garbage_Truck_Tracking/
├── firmware/                   # ESP32 device firmware (PlatformIO)
│   ├── src/
│   │   ├── main.cpp            # Main firmware file (~2000 lines)
│   │   ├── config.h            # Hardware pin definitions & constants
│   │   ├── system_state.h      # Shared state types (enums, structs)
│   │   └── secrets.h           # API keys & passwords (git-ignored)
│   ├── platformio.ini          # Build configuration
│   └── sim7600.h               # Modem AT command reference
│
├── backend/
│   └── supabase/
│       ├── functions/          # Edge Functions (Deno/TypeScript)
│       │   ├── ingest/         # POST GPS records from device
│       │   ├── config/         # GET device configuration
│       │   ├── event/          # POST system events from device
│       │   ├── health/         # GET liveness check
│       │   ├── provision/      # POST device/WiFi provisioning
│       │   └── device-config/  # GET full config for dashboard
│       └── migrations/         # PostgreSQL schema migrations (13 files)
│
└── dashboard/                  # Web frontend (Vite + React)
    └── src/
        ├── App.tsx             # Root component, auth guard, routing
        ├── pages/
        │   ├── LiveMap.tsx     # Real-time map with Supabase Realtime
        │   ├── History.tsx     # Route history + playback
        │   ├── Events.tsx      # System event log table
        │   ├── Checkpoints.tsx # Geofence checkpoint management
        │   ├── DeviceConfig.tsx# Device settings panel
        │   └── Login.tsx       # Supabase Auth login form
        ├── components/
        │   └── Layout.tsx      # Sidebar navigation shell
        ├── hooks/
        │   └── useRouteHistory.ts # Custom hook: fetch GPS history
        └── lib/
            ├── supabase.ts     # Supabase client singleton
            └── geocode.ts      # Reverse geocoding via Nominatim
```

---

## 2. Firmware (`firmware/src/`)

### 2.1 `system_state.h` — Shared Types

This file is the **single source of truth** for all device operational state. It defines the enums and structs that are read by every FreeRTOS task.

**Key types:**

```cpp
// 7-state provisioning state machine
enum ProvState : uint8_t {
  PROV_IDLE,           // AP up, waiting for WiFi credentials
  PROV_CONNECTING,     // WiFi.begin() called
  PROV_DHCP_WAIT,      // Connected, waiting for IP
  PROV_INTERNET_CHECK, // HEAD /health to verify internet
  PROV_AUTH_CHECK,     // POST /ingest dry-run to verify API key
  PROV_SUCCESS,        // Fully operational
  PROV_FAILED          // Stopped with a known failure reason
};

// Normal operation network state
enum NetState : uint8_t {
  NET_DISCONNECTED, NET_WIFI_CONNECTING, NET_WIFI_CONNECTED,
  NET_LTE_CONNECTING, NET_LTE_CONNECTED,
  NET_INTERNET_OK, NET_BACKEND_OK, NET_TRACKING
};

// DeviceHealth struct — everything the portal /status API exposes
struct DeviceHealth {
  uint32_t   uptime_s;
  ProvState  prov_state;
  bool       wifi_connected;
  bool       lte_registered;
  bool       gps_fix;
  float      gps_lat, gps_lon, gps_speed_kmh;
  int        battery_pct;
  int        nvs_buffered;      // Records queued in offline flash
  int        nvs_capacity;      // Max = 200
  uint32_t   last_upload_ago_s;
  // ...and more
};
```

---

### 2.2 `config.h` — Hardware Pins & Constants

Defines all hardware pin assignments and tunable constants in one place:
- UART pins for the A7670 modem (`MODEM_TX`, `MODEM_RX`)
- Default APN, API endpoint URL
- Timing constants: `GPS_INTERVAL_MS` (default 5s moving, 60s stopped)
- Portal credentials: AP SSID, WPA2 password, admin password
- NVS capacity: 200 offline records

---

### 2.3 `main.cpp` — Core Firmware (~2000 lines)

The entire device logic lives here. It is organized into logical sections:

#### Global Objects
```cpp
TinyGsm modem(debugger);                // LTE modem driver
TinyGsmClientSecure lteSecureClient;    // Modem-native SSL socket
Preferences prefs;                      // NVS offline queue
Preferences wifiPrefs;                  // Saved WiFi credentials
WebServer diagServer(80);               // Local HTTP portal server
DNSServer dnsServer;                    // Captive portal DNS redirect
DeviceHealth g_health;                  // Shared device state
```

#### Mutexes (thread safety)
```cpp
SemaphoreHandle_t g_healthMutex;   // Protects g_health reads/writes
SemaphoreHandle_t g_modemMutex;    // Serializes all modem AT commands
SemaphoreHandle_t g_logMutex;      // Protects rolling event log
```

#### Session Management (Portal)
The local web portal issues a 32-character random hex session token on login. Sessions expire after 30 minutes of inactivity. Only one session is active at a time.

```cpp
static String g_sessionToken = "";
static uint32_t g_sessionExpiry = 0;
```

#### FreeRTOS Tasks

**TaskGPS** — Reads GNSS via raw AT commands to the A7670 modem, parses NMEA-style response, updates `g_health`, and enqueues records for upload.

**TaskUpload** — Reads from the NVS flash queue, batches records, attempts POST to `/ingest` via WiFi first, then LTE. On success, clears the sent records from NVS.

**TaskPortal** — Runs the `WebServer` and `DNSServer`. Handles all HTTP routes:
- `GET /` — Serves the diagnostic HTML dashboard (inline HTML/CSS/JS)
- `GET /status` — Returns `DeviceHealth` as JSON (polled every 2s by portal UI)
- `POST /login` — Validates admin password, issues session token
- `GET /configure-wifi` — Saves new WiFi SSID/password to NVS
- `POST /reboot` — Triggers ESP.restart()

**TaskLED** — Blinks the onboard LED in patterns to indicate status (fast blink = connecting, slow pulse = tracking, solid = error).

**Hardware Watchdog** — `esp_task_wdt` with 30-second timeout. Each task calls `esp_task_wdt_reset()` in its main loop. Any task that hangs will trigger a full device reboot and log the event.

#### Offline Buffering (NVS Queue)
Records are stored in ESP32 Non-Volatile Storage (NVS) as JSON strings indexed by a counter:
```cpp
prefs.putString("r_0001", jsonRecord);
prefs.putString("r_0002", jsonRecord);
// ...up to "r_0200" (200 records = ~50 minutes at 15s interval)
```
On upload success, entries are deleted one by one. On reboot, the queue survives and continues from where it left off.

#### Upload Logic
```
1. Read next batch from NVS (up to 10 records)
2. If WiFi connected → try WiFiClientSecure POST to /ingest
3. If WiFi fails or not connected → try TinyGsmClientSecure POST via LTE
4. If 200 OK → delete batch from NVS, update g_health.consecutive_failures = 0
5. If fail → increment consecutive_failures, log event, retry next cycle
6. After 5 consecutive failures → log UPLOAD_FAIL event to Supabase
```

---

## 3. Backend (`backend/supabase/`)

### 3.1 Database Migrations

Migrations are applied in sequence and define the full database schema:

| Migration File | Purpose |
|----------------|---------|
| `..._init_schema.sql` | Creates `devices`, `gps_records`, `device_status`, `system_events` tables + PostGIS extension |
| `..._device_status_trigger.sql` | DB trigger: auto-upsert `device_status` on every `gps_records` insert |
| `..._fix_rls_policies.sql` | Row-Level Security: anon = read-only, service role = full write |
| `..._device_registration_and_offline_detection.sql` | Adds `is_active`, offline status tracking |
| `..._checkpoints_geofence.sql` | `checkpoints` + `checkpoint_visits` tables + PostGIS geofence trigger |
| `..._wifi_credentials.sql` | `wifi_credentials` table for captive portal provisioning |
| `..._sim_config.sql` | `sim_config` table for APN configuration |
| `..._event_logs_delete_and_checkpoint_visit.sql` | Adds cascading deletes, checkpoint visit cleanup |
| `..._tracking_controls_and_history_delete.sql` | Adds `track_history_enabled`, `track_events_enabled` columns |
| `..._add_recording_interval.sql` | Adds `recording_interval_s` to `devices` |
| `..._seed_admin_user.sql` | Seeds the initial administrator account |
| `..._fix_admin_user.sql` | Patches admin user permissions |
| `..._fix_last_seen_trigger.sql` | Fixes the `last_seen` timestamp update trigger |

### 3.2 Edge Functions

All functions are written in **Deno TypeScript** and use the Supabase JS client with the `SUPABASE_SERVICE_ROLE_KEY` environment variable for privileged database access.

#### `/ingest` — GPS Record Receiver
The most important edge function. Validates the device API key, then batch-inserts GPS records.

```typescript
// Auth flow:
// 1. Read X-Device-ID + X-API-Key headers
// 2. Look up device in `devices` table
// 3. Check is_active + api_key match
// 4. Map records: add device UUID, build PostGIS POINT, set wifi_connected flag
// 5. Insert into gps_records (if track_history_enabled)
// 6. Log upload_success event to system_events (if track_events_enabled)
```

**PostGIS point construction:**
```typescript
location: `SRID=4326;POINT(${record.lon} ${record.lat})`
// Note: PostGIS uses (longitude, latitude) order — NOT (lat, lon)
```

#### `/config` — Device Configuration
Returns the current recording configuration for the device. Reads `recording_interval_s` from the `devices` table.

#### `/event` — System Event Logger
Accepts events from the firmware (e.g., `REBOOT`, `GPS_NO_FIX`, `LTE_RECONNECT`) and inserts them into `system_events`.

#### `/health` — Liveness Probe
Simple GET endpoint that returns `{ "status": "ok" }`. The device calls this before attempting data upload to verify backend reachability.

#### `/provision` — Device & WiFi Registration
Handles device provisioning from the captive portal. Saves WiFi credentials to `wifi_credentials` table or registers new devices.

#### `/device-config` — Dashboard Configuration API
Returns full device configuration (WiFi credentials, SIM config, tracking settings) for the dashboard's Device Config page.

---

## 4. Frontend (`dashboard/src/`)

### 4.1 `App.tsx` — Root Component

The root component handles **session management** before rendering any route:

```tsx
// 1. On mount: call supabase.auth.getSession()
// 2. If no session → render <Login />
// 3. If session → render <BrowserRouter> with all routes
// 4. Subscribe to onAuthStateChange for logout detection
```

Routes are nested inside a `<Layout>` component (sidebar + header shell):
```
/                → <LiveMap />
/history         → <History />
/events          → <Events />
/checkpoints     → <Checkpoints />
/device-config   → <DeviceConfig />
```

### 4.2 `pages/LiveMap.tsx` — Real-Time Tracking Map

The most complex page. Key responsibilities:

1. **Supabase Realtime subscription** — Subscribes to `device_status` table changes on mount. When Supabase pushes a row update, the marker on the map moves immediately.

```tsx
supabase.channel('device_status')
  .on('postgres_changes', { event: '*', schema: 'public', table: 'device_status' },
    (payload) => setDevices(prev => /* merge update */))
  .subscribe()
```

2. **Leaflet map** — Custom truck icon (animated pulse ring + truck SVG). Uses `MapFlyTo` component to smoothly pan the map to the active truck.

3. **MetricCards** — Show GPS status, battery %, LTE signal strength, last seen timestamp.

4. **Route trail** — Uses `useRouteHistory` hook to show today's driven path as a polyline behind the live marker.

5. **Reverse geocoding** — Calls Nominatim (OpenStreetMap) to convert lat/lon to human-readable address in marker popups.

### 4.3 `pages/History.tsx` — Route Replay

Allows selecting a device + date range to load and replay historical GPS data:
- Date picker → fetch `gps_records` from Supabase for that range
- Display as polyline on map
- **Animated replay**: steps through records at configurable speed (1×, 2×, 5×) using `setInterval`
- Scrubber slider for manual position control

### 4.4 `pages/Events.tsx` — System Event Log

Paginated table of `system_events` records. Supports:
- Filtering by event type
- Date range filter
- Auto-refresh via Supabase Realtime subscription

### 4.5 `pages/Checkpoints.tsx` — Geofence Management

Allows admins to:
- View all geofence checkpoints on a map (circle overlays)
- Add new checkpoints by clicking on the map
- Set checkpoint name and radius
- View checkpoint visit history (when trucks entered/exited)

### 4.6 `pages/DeviceConfig.tsx` — Device Settings

Dashboard interface for remotely configuring the device:
- Toggle history tracking on/off
- Toggle event logging on/off
- Adjust recording interval
- View and update WiFi credentials stored in the cloud (sent to device on next `/config` poll)
- View SIM configuration

### 4.7 `lib/supabase.ts` — Supabase Client

```typescript
import { createClient } from '@supabase/supabase-js'

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
)
```

Single exported singleton — used across all pages and hooks.

### 4.8 `hooks/useRouteHistory.ts`

Custom React hook that fetches GPS records for a given device and date window:

```typescript
const { records, loading } = useRouteHistory(deviceId, startDate, endDate)
```

Returns an array of `{ lat, lon, timestamp, speed_kmh }` objects for map rendering.

---

## 5. Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| **NVS instead of SD card** | NVS is built into ESP32 EEPROM-equivalent flash — no extra hardware, no SPI conflicts, survives power loss |
| **Supabase Realtime over polling** | WebSocket push eliminates dashboard polling overhead; updates appear in <1 second |
| **Dual auth (WiFi + LTE)** | Prioritizes free WiFi at depot; falls back to cellular only when needed, reducing data costs |
| **PostGIS geography type** | Enables efficient geospatial queries (checkpoint geofence detection via `ST_DWithin`) |
| **TinyGSM for LTE** | Abstracts AT command complexity for the A7672X modem; provides familiar HTTPClient-like API |
| **Modem mutex** | The A7670 modem UART is shared between GPS polling and HTTP upload; mutex prevents concurrent AT command corruption |

---

*Document generated: September 2026 | GarbageTrack v1.2.0*
