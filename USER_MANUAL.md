# GarbageTrack User Manual

Welcome to the GarbageTrack system! This manual explains how the hardware tracker operates, how to configure it locally, and how to monitor the fleet on the web dashboard.

## 1. System Overview
The GarbageTrack hardware (LILYGO T-Call A7670E) is designed to be installed on garbage trucks to provide real-time GPS tracking. 
- **Power:** It operates on a LiFePO4 battery, continuously recharged by a solar panel.
- **Connectivity:** It automatically prioritizes Wi-Fi (e.g., when parked at the depot) to save data costs, and seamlessly falls back to the LTE Cellular network when the truck is on the road.
- **Offline Resilience:** If the truck enters a dead zone (no Wi-Fi and no LTE), it will temporarily save GPS coordinates to its internal flash memory (up to 200 records). Once the network reconnects, it instantly bulk-uploads the delayed data.

---

## 2. Hardware Operation

### Powering On
Once connected to the battery/solar system, the device turns on automatically. 
There are no physical buttons to press.

---

## 3. Local Maintenance Portal
Because the device lacks physical screens or buttons, it acts as its own Wi-Fi router. Technicians can connect to it directly from a smartphone or laptop to diagnose issues or add new Wi-Fi passwords.

### Accessing the Portal
1. Stand near the truck and open your phone's Wi-Fi settings.
2. Connect to the network: **`GarbageTrack-Service`**
3. Enter the Wi-Fi password (default: `GTrack2026`).
4. On most phones, a "Sign In to Network" page will automatically pop up (Captive Portal). If it doesn't, open a web browser and go to: **[http://192.168.4.1/](http://192.168.4.1/)**
5. Log in with the Administrator credentials (default User: `admin`, Password: `GTrack@2026!`).

### Using the Portal
Once logged in, you will see the **Diagnostics Dashboard**:
- **Connection Status:** Shows if the device has Internet, if the Backend is reachable, and if Authentication is passing.
- **Wi-Fi & LTE:** Displays signal strength (RSSI), active IP addresses, and which network is currently being used to upload data.
- **GPS:** Shows the number of locked satellites and current location accuracy.
- **Configure Wi-Fi:** Click the **"Configure Wi-Fi"** button to manually add the depot's Wi-Fi network and password. The device will remember this network forever.
- **Reboot:** You can softly restart the hardware if it is acting unresponsive.

---

## 4. The Web Dashboard
The web dashboard is where fleet managers can view the real-time status of all trucks.

### Accessing the Dashboard
- **URL:** [https://garbage-truck-gps-z59i-2wpo36hdb-dumjaes-projects.vercel.app/](https://garbage-truck-gps-z59i-2wpo36hdb-dumjaes-projects.vercel.app/)
- Log in using your registered Supabase Administrator account.

### Features
- **Live Map:** Watch trucks move in real-time. Click on a truck icon to view its current speed, battery percentage, and cellular signal strength.
- **Offline Detection:** If a truck loses power or goes offline for more than 3 minutes, its status indicator will automatically turn gray to notify the dispatcher.
- **Historical Playback:** Select a specific truck and a date range to view its route history and verify where it has traveled.
