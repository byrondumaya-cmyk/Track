# GarbageTrack — Full-Stack Architecture

**System:** GarbageTrack GPS Fleet Tracking System v1.2.0  
**Architecture Style:** IoT Edge → Cloud Backend → Web Frontend (3-tier)

---

## 1. System Architecture Diagram

```
╔══════════════════════════════════════════════════════════════════════════════╗
║                        GARBAGETRACK SYSTEM ARCHITECTURE                     ║
╠══════════════════════════════════════════════════════════════════════════════╣
║                                                                              ║
║  ┌─────────────────────────────────┐                                         ║
║  │         TIER 1: HARDWARE        │                                         ║
║  │      (On-Vehicle Edge Device)   │                                         ║
║  │                                 │                                         ║
║  │  ┌──────────────────────────┐   │                                         ║
║  │  │  LILYGO T-Call A7670E    │   │                                         ║
║  │  │  ESP32 + SIM7670 Modem   │   │                                         ║
║  │  │                          │   │                                         ║
║  │  │  FreeRTOS Tasks:         │   │                                         ║
║  │  │  ├─ TaskGPS              │   │    HTTPS POST (WiFi preferred)          ║
║  │  │  ├─ TaskUpload           │───┼─────────────────────────────────►       ║
║  │  │  ├─ TaskPortal           │   │    HTTPS POST (LTE fallback)            ║
║  │  │  ├─ TaskLED              │   │                                         ║
║  │  │  └─ TaskWatchdog         │   │                                         ║
║  │  │                          │   │                                         ║
║  │  │  Storage: NVS Flash      │   │                                         ║
║  │  │  (offline queue ~200 rec)│   │                                         ║
║  │  └──────────────────────────┘   │                                         ║
║  │                                 │                                         ║
║  │  Power: LiFePO4 12V + Solar     │                                         ║
║  │  Connectivity: WiFi + LTE (SIM) │                                         ║
║  └─────────────────────────────────┘                                         ║
║                                                                              ║
║  ┌─────────────────────────────────┐                                         ║
║  │       TIER 2: CLOUD BACKEND     │                                         ║
║  │           (Supabase)            │                                         ║
║  │                                 │    WebSocket Realtime                   ║
║  │  ┌─────────────────────────┐    │◄────────────────────────────────        ║
║  │  │   Edge Functions (Deno) │    │    (dashboard subscribes)               ║
║  │  │   ├─ /ingest            │    │                                         ║
║  │  │   ├─ /event             │    │                                         ║
║  │  │   ├─ /config            │    │                                         ║
║  │  │   ├─ /health            │    │                                         ║
║  │  │   ├─ /provision         │    │                                         ║
║  │  │   └─ /device-config     │    │                                         ║
║  │  └──────────┬──────────────┘    │                                         ║
║  │             │                   │                                         ║
║  │  ┌──────────▼──────────────┐    │                                         ║
║  │  │   PostgreSQL + PostGIS  │    │                                         ║
║  │  │   ├─ devices            │    │                                         ║
║  │  │   ├─ gps_records        │    │                                         ║
║  │  │   ├─ device_status      │    │                                         ║
║  │  │   ├─ system_events      │    │                                         ║
║  │  │   ├─ checkpoints        │    │                                         ║
║  │  │   ├─ checkpoint_visits  │    │                                         ║
║  │  │   ├─ wifi_credentials   │    │                                         ║
║  │  │   └─ sim_config         │    │                                         ║
║  │  └─────────────────────────┘    │                                         ║
║  │  Auth: Supabase Auth (JWT)       │                                         ║
║  │  Security: RLS on all tables     │                                         ║
║  └─────────────────────────────────┘                                         ║
║                                                                              ║
║  ┌─────────────────────────────────┐                                         ║
║  │     TIER 3: WEB DASHBOARD       │                                         ║
║  │   (Vite + React + TypeScript)   │                                         ║
║  │         Hosted on Vercel        │                                         ║
║  │                                 │                                         ║
║  │  Pages:                         │                                         ║
║  │  ├─ /           (LiveMap)       │                                         ║
║  │  ├─ /history    (Route Replay)  │                                         ║
║  │  ├─ /events     (Event Log)     │                                         ║
║  │  ├─ /checkpoints (Geofences)    │                                         ║
║  │  └─ /device-config (Settings)   │                                         ║
║  └─────────────────────────────────┘                                         ║
╚══════════════════════════════════════════════════════════════════════════════╝
```

---

## 2. Data Flow

### 2.1 Normal Upload (Online)
```
GPS Fix → Build JSON Record → Check WiFi → POST /ingest (WiFi)
                                         → POST /ingest (LTE if WiFi fails)
                                         → Supabase inserts gps_records
                                         → Trigger updates device_status
                                         → Realtime pushes to dashboard
                                         → Dashboard marker updates on map
```

### 2.2 Offline Buffering
```
GPS Fix → Build JSON Record → No Internet → Save to NVS Flash Queue
                                           → (up to ~200 records)
Network Restored → Bulk read NVS → POST /ingest (batch) → Clear NVS → Done
```

### 2.3 Dashboard Login Flow
```
User opens URL → Login page → Supabase Auth (email + password)
→ JWT issued → Stored in browser session → Dashboard loads
→ Subscribes to device_status Realtime channel → Live updates begin
```

---

## 3. Tech Stack (Detailed)

### Tier 1 — Firmware
| Component | Technology | Version |
|-----------|------------|---------|
| MCU | LILYGO T-Call A7670E (ESP32-WROVER) | — |
| Framework | Arduino + FreeRTOS | ESP-IDF 5.x |
| Modem Driver | TinyGSM (A7672X) | Latest |
| HTTP | HTTPClient (WiFi) + TinyGsmClient (LTE) | — |
| JSON | ArduinoJson | v7 |
| Web Server | ESP32 WebServer | — |
| Storage | ESP-IDF NVS (Preferences) | — |
| Watchdog | esp_task_wdt | — |
| Build System | PlatformIO | — |

### Tier 2 — Backend
| Component | Technology |
|-----------|------------|
| Database | PostgreSQL 15 + PostGIS (geospatial) |
| Auth | Supabase Auth (JWT, bcrypt) |
| Realtime | Supabase Realtime (WebSocket) |
| API | Supabase Edge Functions (Deno/TypeScript) |
| ORM | Supabase JS Client v2 |
| Hosting | Supabase Cloud (free tier) |

### Tier 3 — Dashboard
| Component | Technology |
|-----------|------------|
| Build Tool | Vite 5 |
| Framework | React 18 + TypeScript |
| Routing | React Router v6 |
| UI Components | shadcn/ui + Radix UI |
| Maps | Leaflet.js 1.9 + React-Leaflet |
| Tile Source | OpenStreetMap (Nominatim for geocoding) |
| DB Client | @supabase/supabase-js v2 |
| Linter | Oxlint |
| Hosting | Vercel (CI/CD from GitHub) |

---

## 4. Database Schema

### `devices`
| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID (PK) | Internal device UUID |
| `device_id` | TEXT UNIQUE | Human-readable ID (e.g. "TL-001") |
| `api_key` | TEXT | Pre-shared key for firmware auth |
| `is_active` | BOOLEAN | Enable/disable device |
| `track_history_enabled` | BOOLEAN | Toggle GPS record storage |
| `track_events_enabled` | BOOLEAN | Toggle system event logging |
| `recording_interval_s` | INTEGER | GPS recording interval in seconds |
| `created_at` | TIMESTAMPTZ | — |

### `gps_records`
| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID (PK) | — |
| `device_id` | UUID (FK → devices) | — |
| `timestamp` | TIMESTAMPTZ | GPS fix time |
| `lat` | DOUBLE | Latitude |
| `lon` | DOUBLE | Longitude |
| `location` | GEOGRAPHY(POINT) | PostGIS point (SRID 4326) |
| `speed_kmh` | REAL | Speed in km/h |
| `heading` | REAL | Direction in degrees |
| `hdop` | REAL | GPS accuracy indicator |
| `battery_pct` | INTEGER | Battery percentage |
| `rssi_dbm` | INTEGER | Signal strength dBm |
| `gps_fix` | BOOLEAN | Whether GPS had a valid fix |
| `wifi_connected` | BOOLEAN | Upload came via WiFi (vs LTE) |
| `satellites` | INTEGER | Number of GPS satellites |

### `device_status`
Auto-upserted by DB trigger on every `gps_records` insert. Stores the **latest** state of each device for fast dashboard queries.

| Column | Type | Description |
|--------|------|-------------|
| `device_id` | UUID (PK, FK) | — |
| `last_seen` | TIMESTAMPTZ | Timestamp of last received record |
| `last_lat` / `last_lon` | DOUBLE | Latest position |
| `last_speed` | REAL | Latest speed |
| `battery_pct` | INTEGER | Latest battery % |
| `rssi_dbm` | INTEGER | Latest signal strength |
| `lte_connected` | BOOLEAN | — |
| `gps_fix` | BOOLEAN | — |
| `status` | TEXT | `online` / `offline` |

### `system_events`
| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID (PK) | — |
| `device_id` | UUID (FK) | — |
| `event_type` | TEXT | e.g. `upload_success`, `REBOOT`, `GPS_NO_FIX` |
| `payload` | JSONB | Event-specific metadata |
| `created_at` | TIMESTAMPTZ | — |

### `checkpoints`
Geofenced collection points defined by administrators.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID (PK) | — |
| `name` | TEXT | Checkpoint name |
| `lat` / `lon` | DOUBLE | Center coordinates |
| `radius_m` | REAL | Geofence radius in meters |
| `location` | GEOGRAPHY(POINT) | PostGIS point |

### `checkpoint_visits`
Logged automatically when a truck enters a checkpoint geofence.

### `wifi_credentials`
Stores Wi-Fi networks provisioned via the captive portal for each device.

### `sim_config`
Stores APN and SIM configuration per device.

---

## 5. Edge Function API Reference

All Edge Functions are deployed at:  
`https://abbhqglzswbrpstndyrl.supabase.co/functions/v1/<name>`

### `POST /ingest`
Receives GPS records from the device.

**Headers:**
```
X-Device-ID: TL-001
X-API-Key: <device api key>
Content-Type: application/json
```

**Body:**
```json
{
  "records": [
    {
      "timestamp": "2026-09-05T13:00:00Z",
      "lat": 15.4923,
      "lon": 120.8301,
      "speed_kmh": 24.5,
      "heading": 180,
      "hdop": 1.2,
      "battery_pct": 87,
      "rssi_dbm": -75,
      "gps_fix": true,
      "wifi_connected": false,
      "satellites": 9
    }
  ]
}
```

**Response:** `{ "status": "ok", "accepted": 1 }`

---

### `GET /config`
Returns current configuration for the device (recording intervals, thresholds).

**Headers:** `X-Device-ID`, `X-API-Key`

**Response:**
```json
{
  "interval_moving_sec": 5,
  "interval_stopped_sec": 60,
  "interval_low_battery_sec": 300,
  "gps_accuracy_threshold_hdop": 2.5,
  "server_time": "2026-09-05T13:00:00Z"
}
```

---

### `POST /event`
Receives system events from the device (reboot, GPS loss, LTE reconnect, etc.).

---

### `GET /health`
Liveness check — returns `{ "status": "ok" }`. Used by the device to verify backend reachability before attempting data upload.

---

### `POST /provision`
Registers a new device or updates its Wi-Fi credentials sent from the captive portal.

---

### `GET /device-config`
Returns the full configuration set for a device, including Wi-Fi credentials and SIM config, for the dashboard's Device Config page.

---

## 6. FreeRTOS Task Map

```
┌────────────────────────────────────────────────────┐
│                  FreeRTOS Scheduler                 │
├──────────┬──────────┬──────────┬──────────┬────────┤
│ TaskGPS  │TaskUpload│TaskPortal│ TaskLED  │Task WDT│
│ Core 1   │ Core 1   │ Core 0   │ Core 0   │ Both   │
│ 4KB stack│ 8KB stack│ 8KB stack│ 2KB stack│ —      │
│          │          │          │          │        │
│ • Parse  │ • Read   │ • HTTP   │ • Status │ • Feed │
│   GNSS   │   NVS    │   server │   LED    │   WDT  │
│ • Update │ • POST   │ • Portal │ • Blink  │ • 30s  │
│   health │   /ingest│   UI     │   codes  │   reset│
│ • Queue  │ • Clear  │ • WiFi   │          │        │
│   record │   on OK  │   prov   │          │        │
└──────────┴──────────┴──────────┴──────────┴────────┘
     ▲           ▲
     └───────────┘
   Shared via g_health (SemaphoreHandle_t g_healthMutex)
   Modem access via g_modemMutex
```

---

## 7. Network State Machine (Firmware)

```
PROV_IDLE
    │ credentials submitted via portal
    ▼
PROV_CONNECTING
    │ WiFi.begin() → WL_CONNECTED
    ▼
PROV_DHCP_WAIT
    │ IP assigned
    ▼
PROV_INTERNET_CHECK   ──fail──► PROV_FAILED (FAIL_INTERNET_UNREACHABLE)
    │ HEAD /health = 200
    ▼
PROV_AUTH_CHECK       ──fail──► PROV_FAILED (FAIL_AUTH_FAILED)
    │ POST /ingest dry-run = 200
    ▼
PROV_SUCCESS (NET_TRACKING)
```

If WiFi fails at any stage, the firmware falls back to the LTE path:

```
NET_LTE_CONNECTING → NET_LTE_CONNECTED → NET_INTERNET_OK → NET_BACKEND_OK → NET_TRACKING
```

---

## 8. Security Architecture

| Layer | Mechanism |
|-------|-----------|
| **Transport** | TLS 1.2+ (HTTPS for all cloud communication) |
| **Device Authentication** | `X-API-Key` header (per-device pre-shared key, stored in firmware `secrets.h`) |
| **Dashboard Authentication** | Supabase Auth — email/password → JWT (30-day session) |
| **Database Authorization** | Row-Level Security (RLS) — anon key is read-only; writes require service role key |
| **Local Portal Auth** | WPA2 Wi-Fi password + HTTP session token (30-minute timeout) |
| **Secret Management** | `firmware/src/secrets.h` is git-ignored; dashboard keys in `.env` (not committed) |

---

## 9. Power System Architecture

```
☀️ Solar Panel (10W)
        │
        ▼
  MPPT Controller
        │
        ▼
  LiFePO4 Battery (12V 10Ah)  ◄── sustains device overnight / cloudy days
        │
        ▼
  Buck Converter (12V → 5V 3A)
        │
        ▼
  LILYGO T-Call A7670E (ESP32)
  Avg draw: ~300mA @ 5V = 1.5W
  Peak (LTE transmit): ~500mA
```

**Battery runtime without solar:** ~12–15 hours  
**Solar surplus on sunny day:** Panel generates ~40Wh; device uses ~12Wh → full charge maintained

---

*Document generated: September 2026 | GarbageTrack v1.2.0*
