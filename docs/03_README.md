# GarbageTrack — Project README

[![Live Dashboard](https://img.shields.io/badge/Live%20Dashboard-Vercel-black)](https://garbage-truck-gps-z59i-2wpo36hdb-dumjaes-projects.vercel.app/)
[![Backend](https://img.shields.io/badge/Backend-Supabase-green)](https://supabase.com)
[![Firmware](https://img.shields.io/badge/Firmware-PlatformIO-orange)](https://platformio.org)

A **solar-powered, autonomous GPS fleet tracking system** for garbage trucks in Aliaga, Nueva Ecija. Tracks real-time location, speed, battery, and signal strength. Features offline buffering, dual WiFi/LTE connectivity, a local technician portal, and a live web dashboard.

---

## Architecture Overview

```
[LILYGO T-Call A7670E]  →  HTTPS (WiFi/LTE)  →  [Supabase Cloud]  →  WebSocket  →  [React Dashboard]
  ESP32 + SIM7670 Modem                           PostgreSQL + PostGIS               Vercel Hosted
  GNSS · NVS Queue                                Edge Functions · Auth · Realtime
  Solar + LiFePO4                                 Row-Level Security
```

---

## Live Access

| Resource | URL |
|----------|-----|
| **Web Dashboard** | https://garbage-truck-gps-z59i-2wpo36hdb-dumjaes-projects.vercel.app/ |
| **Dashboard Email** | `mlgualiaga@gmail.com` |
| **Dashboard Password** | `admin@menrolgu-aliaga` |
| **Device WiFi AP** | `TrackLocator-Service` (password: `GTrack2026`) |
| **Local Portal** | http://192.168.4.1 (Username: `admin` / Password: `GTrack@2026!`) |

---

## Project Structure

```
Garbage_Truck_Tracking/
├── firmware/               # ESP32 C++ firmware (PlatformIO)
│   └── src/
│       ├── main.cpp        # Core firmware — FreeRTOS tasks, portal, upload
│       ├── config.h        # Hardware pins, timing constants
│       ├── system_state.h  # Shared state types
│       └── secrets.h       # ⚠️ Git-ignored — copy from template
├── backend/
│   └── supabase/
│       ├── functions/      # Edge Functions (Deno/TypeScript)
│       └── migrations/     # PostgreSQL schema (13 migration files)
├── dashboard/              # Vite + React + TypeScript web app
│   └── src/
│       ├── pages/          # LiveMap, History, Events, Checkpoints, DeviceConfig
│       ├── components/     # Layout (sidebar + header)
│       ├── hooks/          # useRouteHistory
│       └── lib/            # supabase.ts, geocode.ts
└── docs/                   # Supporting documentation (this folder)
```

---

## Prerequisites

| Tool | Version | Purpose |
|------|---------|---------|
| [PlatformIO](https://platformio.org/install) | Latest | Build & flash firmware |
| [Node.js](https://nodejs.org) | 18+ | Dashboard development |
| [Supabase CLI](https://supabase.com/docs/guides/cli) | Latest | Deploy migrations & functions |
| [Git](https://git-scm.com) | Any | Version control |

---

## Setup Guide

### 1. Clone the Repository

```bash
git clone https://github.com/byrondumaya-cmyk/Track.git
cd Track
```

---

### 2. Firmware Setup

#### Create `secrets.h`
Copy the template and fill in your values:

```bash
cp firmware/src/secrets.h.example firmware/src/secrets.h
```

Edit `firmware/src/secrets.h`:
```cpp
// Device credentials
#define DEVICE_ID        "TL-001"
#define API_KEY          "<your-device-api-key-from-supabase>"
#define INGEST_URL       "https://abbhqglzswbrpstndyrl.supabase.co/functions/v1/ingest"

// Portal admin password
#define PORTAL_ADMIN_PASSWORD  "GTrack@2026!"

// Default APN (Smart PH)
#define DEFAULT_APN      "internet"
```

#### Flash the Device

```bash
cd firmware
pio run --target upload        # Build + flash via USB
pio device monitor             # Open serial monitor (115200 baud)
```

---

### 3. Backend Setup (Supabase)

#### Link to Supabase Project

```bash
supabase login
supabase link --project-ref abbhqglzswbrpstndyrl
```

#### Apply Database Migrations

```bash
supabase db push
```

#### Deploy Edge Functions

```bash
supabase functions deploy ingest
supabase functions deploy config
supabase functions deploy event
supabase functions deploy health
supabase functions deploy provision
supabase functions deploy device-config
```

#### Set Edge Function Secrets

```bash
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=<your-service-role-key>
```

---

### 4. Dashboard Setup

#### Install Dependencies

```bash
cd dashboard
npm install
```

#### Configure Environment

Create `dashboard/.env`:
```env
VITE_SUPABASE_URL=https://abbhqglzswbrpstndyrl.supabase.co
VITE_SUPABASE_ANON_KEY=<your-anon-key>
```

#### Run Development Server

```bash
npm run dev
# Opens at http://localhost:5173
```

#### Deploy to Vercel

```bash
npm install -g vercel
vercel --prod
```

Set the same environment variables in the Vercel dashboard under **Project → Settings → Environment Variables**.

---

## Device Registration

After flashing the firmware, register the device in Supabase:

1. Open Supabase Table Editor → `devices` table
2. Insert a new row:

| Field | Value |
|-------|-------|
| `device_id` | `TL-001` |
| `api_key` | `<generate a strong random key>` |
| `is_active` | `true` |
| `track_history_enabled` | `true` |
| `track_events_enabled` | `true` |
| `recording_interval_s` | `5` |

3. Copy the same `api_key` into `firmware/src/secrets.h` as `API_KEY`.

---

## Environment Variables Reference

### Dashboard (`dashboard/.env`)

| Variable | Description |
|----------|-------------|
| `VITE_SUPABASE_URL` | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon/public key (safe to expose in frontend) |

### Edge Functions (Supabase Secrets)

| Variable | Description |
|----------|-------------|
| `SUPABASE_SERVICE_ROLE_KEY` | Full-access service role key — **never expose in frontend** |

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Firmware | C++ · Arduino · FreeRTOS · PlatformIO |
| Modem | TinyGSM (A7672X) · AT Commands |
| Backend | Supabase · PostgreSQL · PostGIS · Deno Edge Functions |
| Frontend | Vite · React 18 · TypeScript · shadcn/ui · Leaflet.js |
| Hosting | Vercel (dashboard) · Supabase Cloud (backend) |
| Maps | Leaflet.js · OpenStreetMap · Nominatim geocoding |

---

## Key Features

- 📍 **Real-time GPS tracking** — live map updates via Supabase Realtime WebSocket
- 📶 **Dual connectivity** — WiFi preferred, LTE fallback (Smart PH SIM)
- 💾 **Offline buffering** — stores ~200 records in NVS flash; auto-syncs on reconnect
- ☀️ **Solar powered** — LiFePO4 battery + 10W solar panel + MPPT controller
- 🔧 **Local technician portal** — diagnostics and WiFi provisioning at http://192.168.4.1
- 📅 **Route history & playback** — replay any truck's route with speed control
- 📌 **Geofence checkpoints** — auto-log when trucks visit collection points
- 🔐 **Secure** — TLS 1.2+, per-device API keys, JWT auth, Row-Level Security

---

## Contributing

1. Create a feature branch: `git checkout -b feature/<name>`
2. Make changes and commit: `git commit -m "feat: <description>"`
3. Push and open a Pull Request

---

## License

This project is developed as an academic capstone system for Aliaga, Nueva Ecija.

---

*GarbageTrack v1.2.0 — September 2026*
