# GarbageTrack — General Overview

**Project Name:** GarbageTrack GPS Fleet Tracking System  
**Version:** 1.2.0  
**Deployment Location:** Aliaga, Nueva Ecija, Philippines  
**Device ID:** TL-001 (TrackLocator 001)

---

## 1. What Is GarbageTrack?

GarbageTrack is a **solar-powered, fully autonomous GPS tracking system** designed to monitor the real-time location and operational health of municipal garbage trucks. It was developed to give fleet managers and dispatchers a live, accurate picture of every truck's position, speed, battery level, and connectivity status — all from a web browser, anywhere in the world.

The system was purpose-built for the garbage collection operations in Aliaga, Nueva Ecija, where trucks travel through a mix of urban roads and rural areas with uneven cellular coverage.

---

## 2. The Problem It Solves

Before GarbageTrack, fleet managers had no reliable way to know:
- Where trucks were at any given moment
- Whether a truck had broken down or gone off-route
- If a truck had visited all required collection points
- Whether a truck was idle or actively collecting

GarbageTrack solves all of these problems by embedding a smart GPS tracker directly onto each truck, transmitting location data continuously to a cloud dashboard visible to authorized personnel.

---

## 3. How the System Works (End-to-End)

```
┌─────────────────────┐     HTTPS/LTE or WiFi     ┌──────────────────────┐
│   Garbage Truck      │ ─────────────────────────► │  Supabase Cloud      │
│                      │                            │  (PostgreSQL + API)  │
│  • LILYGO T-Call     │                            └──────────┬───────────┘
│    A7670E (ESP32)    │                                       │ Realtime WebSocket
│  • GNSS Antenna      │                            ┌──────────▼───────────┐
│  • Solar Panel       │                            │  Web Dashboard       │
│  • 2x18650 Battery   │                            │  (Vite + React)      │
│  • SIM Card (Smart)  │                            │                      │
│  • TP5100 charging   │                            │                      │
│    module            │                            │                      │
│  • 2S2A BMS          │                            │  Vercel Hosted       │
└─────────────────────┘                            └──────────────────────┘
```

1. **The tracker** (ESP32 microcontroller) wakes up every few seconds, reads its GPS coordinates from the built-in GNSS module, and packages the data (latitude, longitude, speed, heading, battery level, signal strength) into a JSON record.
2. **Upload path** — The tracker first tries to upload over **Wi-Fi** (when parked at the depot). If Wi-Fi is unavailable, it switches to the **LTE cellular network** (Smart PH SIM). If both are unavailable (dead zone), it stores records locally in flash memory and uploads them in bulk as soon as connectivity returns.
3. **The cloud backend** (Supabase) receives the records, stores them in a PostgreSQL/PostGIS database, and instantly pushes the latest position to connected dashboard clients via WebSocket (Supabase Realtime).
4. **The dashboard** (React web app hosted on Vercel) displays the truck's live position on an interactive map, plus status cards for battery, signal, and GPS quality. Fleet managers can also review historical routes and replay the truck's path for any given day.

---

## 4. Key Features

| Feature | Description |
|---------|-------------|
| **Real-Time Tracking** | Truck position updates on the map every 5–15 seconds |
| **Offline Buffering** | Stores up to ~200 GPS records locally if internet is lost; auto-syncs on reconnect |
| **Dual Connectivity** | Automatically switches between Wi-Fi (depot) and LTE (road) |
| **Solar Powered** | 10W solar panel + LiFePO4 battery; fully self-sustaining |
| **Captive Portal** | Technician diagnostic portal accessible via the device's own Wi-Fi hotspot |
| **Historical Playback** | Replay any truck's route for any past date with speed control |
| **Geofence Checkpoints** | Mark collection points; system logs each time a truck enters/exits |
| **Event Log** | Automated log of system events: reboots, GPS loss, LTE reconnects, upload failures |
| **Offline Detection** | Dashboard automatically marks a truck "offline" if no data received for 3 minutes |
| **Device Configuration** | Remote control of recording interval, history tracking, and event logging via dashboard |

---

## 5. Target Users

| User | Role |
|------|------|
| **Fleet Manager / Dispatcher** | Monitors live map, checks truck status, reviews route history |
| **Field Technician** | Uses the local captive portal to diagnose hardware, configure Wi-Fi |
| **System Administrator** | Manages device registration, credentials, Supabase configuration |

---

## 6. Hardware at a Glance

| Component | Details |
|-----------|---------|
| **Microcontroller** | LILYGO T-Call A7670E — ESP32 + integrated SIM7670 LTE modem |
| **GNSS** | Built-in A7670 GNSS module with external active antenna |
| **Battery** | LiFePO4 12V 10Ah — long-life, safe chemistry for outdoor use |
| **Solar** | 10W monocrystalline panel + MPPT charge controller |
| **Power Regulator** | 12V → 5V 3A buck converter |
| **SIM Card** | Smart PH (09613556081); APN: `internet` |
| **Enclosure** | IP67 weatherproof box; external antennas for GPS + LTE mounted on truck roof |

---

## 7. Software Stack at a Glance

| Layer | Technology |
|-------|------------|
| **Firmware** | C++ · Arduino framework · FreeRTOS (multi-task) |
| **Backend** | Supabase — PostgreSQL + PostGIS + Edge Functions + Auth + Realtime |
| **Frontend** | Vite + React 18 + TypeScript + shadcn/ui + Leaflet.js |
| **Maps** | Leaflet.js + OpenStreetMap, centered: 15.49°N, 120.83°E |
| **Hosting** | Vercel (free tier, auto-deploy from GitHub) |

---

## 8. Live Access

| Resource | URL / Address |
|----------|---------------|
| **Web Dashboard** | https://garbage-truck-gps-z59i-2wpo36hdb-dumjaes-projects.vercel.app/ |
| **Device Wi-Fi Hotspot** | SSID: `TrackLocator-Service` |
| **Local Diagnostics Portal** | http://192.168.4.1/ (connect to device Wi-Fi first) |

---

## 9. Security Summary

- All cloud data is transmitted over **TLS 1.2+** (HTTPS)
- The ESP32 authenticates to Supabase using a **device-specific API key** sent in the `X-API-Key` header
- The web dashboard uses **JWT-based authentication** via Supabase Auth
- Database tables are protected by **Row-Level Security (RLS)** — anonymous users cannot write data
- The device's local portal requires a **WPA2 Wi-Fi password** AND an **HTTP session login**

---

*Document generated: September 2026 | GarbageTrack v1.2.0*
