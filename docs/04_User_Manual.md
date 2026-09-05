# GarbageTrack — User Manual

**System:** GarbageTrack GPS Fleet Tracking System v1.2.0  
**Prepared for:** Fleet Managers, Dispatchers, and Field Technicians  
**Deployment:** Aliaga, Nueva Ecija, Philippines

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Access Credentials](#2-access-credentials)
3. [Hardware Operation](#3-hardware-operation)
4. [Local Maintenance Portal](#4-local-maintenance-portal)
5. [Web Dashboard — Live Map](#5-web-dashboard--live-map)
6. [Web Dashboard — Route History](#6-web-dashboard--route-history)
7. [Web Dashboard — Events](#7-web-dashboard--events)
8. [Web Dashboard — Checkpoints](#8-web-dashboard--checkpoints)
9. [Web Dashboard — Device Configuration](#9-web-dashboard--device-configuration)
10. [Troubleshooting](#10-troubleshooting)
11. [FAQ](#11-frequently-asked-questions)

---

## 1. System Overview

GarbageTrack is an autonomous, solar-powered GPS tracking system installed on garbage trucks. It continuously records the truck's position and transmits it to a secure cloud server, which can be monitored in real time through the web dashboard.

**How it works:**
- The device powers on automatically when connected to the solar/battery system
- It acquires GPS coordinates every few seconds
- Data is uploaded via the depot's Wi-Fi when parked, or via the LTE cellular network when on the road
- If there is no internet connection (dead zone), data is saved locally and uploaded automatically once connectivity returns
- The web dashboard receives updates within seconds and displays the truck's live position on a map

---

## 2. Access Credentials

> ⚠️ **Important:** Keep these credentials confidential. Do not share them outside your organization. Change default passwords after first use.

### 2.1 Device Wi-Fi Access Point

When the tracker is powered on, it broadcasts its own Wi-Fi network that technicians can connect to for local diagnostics.

| Field | Value |
|-------|-------|
| **Network Name (SSID)** | `TrackLocator-Service` |
| **Wi-Fi Password (WPA2)** | `GTrack2026` |

### 2.2 Local Maintenance Portal Login

After connecting to the device Wi-Fi, open a browser and go to **http://192.168.4.1**

| Field | Value |
|-------|-------|
| **URL** | http://192.168.4.1/ |
| **Username** | `admin` |
| **Password** | `GTrack@2026!` |

> The captive portal will often open automatically on your phone. If it does not, open any browser and type the URL manually.

### 2.3 Web Dashboard Login

| Field | Value |
|-------|-------|
| **Dashboard URL** | https://garbage-truck-gps-z59i-2wpo36hdb-dumjaes-projects.vercel.app/ |
| **Authentication** | Your registered Supabase administrator email and password |

> Contact your system administrator to receive your dashboard login credentials. Each user has their own secure account managed via Supabase Auth.

### 2.4 Device SIM / Connectivity

| Field | Value |
|-------|-------|
| **SIM Number** | 09613556081 (Smart PH) |
| **Network / APN** | Smart PH — APN: `internet` |

---

## 3. Hardware Operation

### 3.1 Powering On

The device starts automatically when power is available from the battery/solar system. **There are no physical buttons to press.** Once powered:

1. The LED will blink rapidly — the device is booting and connecting
2. After 30–60 seconds, the LED will slow to a steady pulse — the device is tracking and uploading
3. The truck's icon will appear on the web dashboard map

### 3.2 LED Status Indicators

| LED Pattern | Meaning |
|-------------|---------|
| Rapid blink (4× per second) | Booting / connecting to network |
| Slow pulse (1× per 2 seconds) | Fully operational — GPS tracking & uploading |
| Solid ON | Error — check local portal for details |
| Off | Device is unpowered or in deep failure state |

### 3.3 Powering Off

The device should remain powered at all times. It is designed to run 24/7 on solar power. If you need to cut power for maintenance, disconnect the battery terminal from the buck converter.

### 3.4 Solar Charging

The device charges its LiFePO4 battery from the 10W solar panel via an MPPT charge controller. On a clear day, the panel generates more power than the device consumes, keeping the battery fully charged. On overcast days or at night, the battery sustains operation for approximately 12–15 hours.

---

## 4. Local Maintenance Portal

The device acts as its own Wi-Fi hotspot, allowing technicians to connect directly without needing a separate internet connection.

### 4.1 Connecting to the Device

1. On your phone or laptop, open **Wi-Fi Settings**
2. Look for and connect to: **`TrackLocator-Service`**
3. Enter the Wi-Fi password: **`GTrack2026`**
4. A "Sign in to Network" notification may appear automatically — tap it to open the portal
5. If the portal does not open automatically, open a browser and go to: **http://192.168.4.1/**
6. Enter login credentials: Username `admin`, Password `GTrack@2026!`

### 4.2 Diagnostics Dashboard

Once logged in, the portal displays a live diagnostic view that refreshes every 2 seconds:

**System Health Section**
- **Uptime** — How long the device has been running since last reboot
- **Free Heap** — Available memory (should be above 100KB; if below 50KB, reboot the device)
- **Consecutive Failures** — Number of failed upload attempts in a row (should be 0)

**Network Status**
- **Active Interface** — Shows whether data is uploading via `WIFI` or `LTE`
- **WiFi SSID / IP / RSSI** — Current Wi-Fi connection details and signal strength
- **LTE Operator / RSSI** — Cellular network registration and signal strength
- **Internet OK** — Green = backend server is reachable
- **Authenticated** — Green = device API key is valid and accepted by the server

**GPS Status**
- **GPS Fix** — Green = device has a valid satellite lock
- **Satellites** — Number of locked satellites (aim for 6+)
- **Accuracy (HDOP)** — Lower is better; below 2.5 is good
- **Speed / Coordinates** — Current position and speed

**Storage (Offline Queue)**
- **Buffered Records** — Number of GPS records stored locally waiting to be uploaded
- **Capacity** — Maximum is 200 records. If this is consistently full, the device cannot reach the server

### 4.3 Configure Wi-Fi (Add a New Network)

If you move the truck to a new depot with a different Wi-Fi network:

1. In the portal, click **"Configure Wi-Fi"**
2. Enter the depot's Wi-Fi **Network Name (SSID)** and **Password**
3. Click **Save**
4. The device will attempt to connect to the new network automatically
5. Watch the portal diagnostics to confirm **WiFi Connected** turns green

### 4.4 Rebooting the Device

If the device appears frozen or the portal is unresponsive:

1. In the portal, click the **"Reboot"** button
2. Wait 60 seconds
3. Reconnect to the `TrackLocator-Service` Wi-Fi
4. Verify the device is tracking again

---

## 5. Web Dashboard — Live Map

**Access:** https://garbage-truck-gps-z59i-2wpo36hdb-dumjaes-projects.vercel.app/

### 5.1 Logging In

1. Open the dashboard URL in any browser
2. Enter your registered administrator email and password
3. Click **Sign In**

> If you have forgotten your password, contact your system administrator to reset it via Supabase Auth.

### 5.2 Reading the Live Map

The main page shows a map centered on Aliaga, Nueva Ecija with animated truck icons for each tracked vehicle.

**Truck Icon States:**
| Icon Appearance | Meaning |
|-----------------|---------|
| Animated green pulse ring | Truck is online and actively uploading data |
| Gray icon, no animation | Truck has been offline for more than 3 minutes |

**Clicking a Truck Icon** opens a popup showing:
- Current speed (km/h)
- Battery percentage
- Signal strength (dBm)
- GPS fix status
- Last seen timestamp
- Approximate address (reverse geocoded from coordinates)

### 5.3 Status Cards

Below the map are real-time metric cards for each truck:

| Card | Description |
|------|-------------|
| **GPS Status** | Whether the device has a valid satellite fix |
| **Battery** | Battery percentage (0–100%) |
| **Signal** | LTE signal bars |
| **Last Seen** | Seconds/minutes since last data received |

### 5.4 Offline Detection

If a truck stops sending data for more than **3 minutes** (e.g., device powered off, SIM ejected, or in a deep dead zone with no offline storage left), its icon will turn gray and the status will change to **Offline**. The dispatcher should investigate.

---

## 6. Web Dashboard — Route History

**Navigate to:** Sidebar → **History**

### 6.1 Viewing a Route

1. Select a **truck** from the device dropdown
2. Pick a **start date** and **end date**
3. Click **Load History**
4. The truck's driven path will appear as a colored polyline on the map
5. Click any dot on the route to see: time, speed, address, and coordinates at that point

### 6.2 Route Playback

Click the **Play** button to animate the truck's journey:

| Control | Action |
|---------|--------|
| ▶ Play | Start animated replay |
| ⏸ Pause | Pause at current position |
| Speed (1× / 2× / 5×) | Control replay speed |
| Slider | Drag to jump to any point in the route |

---

## 7. Web Dashboard — Events

**Navigate to:** Sidebar → **Events**

The Events page shows a log of all system events recorded by the device and backend. Use this page to diagnose issues or audit device activity.

**Common Event Types:**

| Event Type | Meaning |
|------------|---------|
| `upload_success` | Device successfully uploaded a batch of GPS records |
| `upload_fail` | Device attempted to upload but the server rejected it |
| `REBOOT` | Device restarted (watchdog, power cycle, or manual reboot) |
| `GPS_NO_FIX` | Device could not obtain a GPS fix for an extended period |
| `LTE_RECONNECT` | Device reconnected to the LTE network after a drop |
| `checkpoint_visit` | Truck entered a geofenced collection checkpoint |

You can filter events by type and date range using the filter controls at the top of the page.

---

## 8. Web Dashboard — Checkpoints

**Navigate to:** Sidebar → **Checkpoints**

Checkpoints are virtual geofenced zones (circles on the map) that mark collection points. When a truck enters a checkpoint area, it is automatically logged.

### 8.1 Viewing Checkpoints

All defined checkpoints appear on the map as colored circles with labels.

### 8.2 Adding a New Checkpoint

1. Click anywhere on the map to place a new checkpoint
2. Enter the checkpoint **Name** (e.g., "Barangay Caalibangbangan Dropoff")
3. Set the **Radius** in meters (default: 50m)
4. Click **Save**

### 8.3 Checkpoint Visit History

Click on a checkpoint circle to see a list of all truck visits — which truck arrived, at what time, and how long it stayed.

---

## 9. Web Dashboard — Device Configuration

**Navigate to:** Sidebar → **Device Config**

This page allows administrators to remotely adjust tracking settings for each device.

| Setting | Description |
|---------|-------------|
| **Recording Interval** | How often GPS records are taken (seconds). Lower = more precise but more data |
| **Track History** | Toggle: enable or disable GPS history recording |
| **Track Events** | Toggle: enable or disable system event logging |
| **Wi-Fi Credentials** | View and update the depot Wi-Fi networks stored for this device |
| **SIM Configuration** | View APN and SIM settings |

> Changes made here are delivered to the device on its next `/config` poll (every few minutes).

---

## 10. Troubleshooting

### Truck is not showing on the map

| Check | Action |
|-------|--------|
| Device powered? | Verify solar/battery connection. Check LED status. |
| GPS fix? | Connect to local portal → check GPS section. Move truck outdoors with clear sky view. |
| Internet connected? | Portal → check WiFi or LTE status. If no LTE, check SIM card is seated. |
| API key valid? | Portal → check "Authenticated" field. If red, contact administrator. |
| Dashboard subscription? | Refresh the browser page. |

### Portal (192.168.4.1) is not loading

| Check | Action |
|-------|--------|
| Connected to device Wi-Fi? | Confirm phone is connected to `TrackLocator-Service` |
| Correct URL? | Type exactly: `http://192.168.4.1/` (not https) |
| Device booted? | Wait 60 seconds after power-on before trying |
| Still not loading? | Reboot the device by disconnecting and reconnecting power |

### Battery percentage is dropping

| Check | Action |
|-------|--------|
| Solar panel getting sunlight? | Ensure panel is clean and facing the sun with no shade |
| MPPT charging? | Check the charge controller LED — green = charging |
| Consumption too high? | Increase recording interval in Device Config to reduce transmissions |

### "Offline" status but truck is running

The device may be in a cellular dead zone. Check:
- **Events page** → look for recent `LTE_RECONNECT` or `upload_success` events
- **Portal → Storage** → check if buffered records are accumulating (device is saving data locally)
- Once the truck returns to a coverage area, it will auto-upload all buffered records

---

## 11. Frequently Asked Questions

**Q: How often does the map update?**  
A: The map updates every time the device sends a GPS record — typically every 5–15 seconds when moving, and every 60 seconds when stopped.

**Q: What happens to data when the truck is in a dead zone?**  
A: The device stores up to ~200 GPS records locally in its internal flash memory. Once the truck returns to a connected area, all stored records are automatically uploaded in order with correct timestamps. No data is lost.

**Q: Can I access the dashboard on my phone?**  
A: Yes. The dashboard is a responsive web app. Open the URL in any modern mobile browser.

**Q: How do I add a new user to the dashboard?**  
A: Log in to the Supabase project dashboard at https://supabase.com, go to **Authentication → Users**, and invite a new user by email.

**Q: How do I add a second truck?**  
A: Flash another LILYGO device with a unique `DEVICE_ID` and `API_KEY` in `secrets.h`, then register it in the Supabase `devices` table with the same `API_KEY`. It will automatically appear on the dashboard.

**Q: Why is the battery percentage stuck at 0%?**  
A: The battery percentage is measured via an ADC pin. If it reads 0%, the ADC may be misconfigured or the voltage divider circuit may have a loose connection. Check the hardware wiring.

**Q: The device reboots frequently. What should I do?**  
A: Check the **Events** page for `REBOOT` events. If the reboot reason says "watchdog", a FreeRTOS task is hanging. This usually self-recovers. If reboots happen more than once per hour, update the firmware.

---

*GarbageTrack v1.2.0 — September 2026*  
*For support, contact the system administrator.*
