# GarbageTrack Credentials & Access

This document outlines the standard credentials for accessing the GarbageTrack hardware and dashboards.

> [!CAUTION]
> Do NOT store database passwords, `SUPABASE_SERVICE_ROLE_KEY`, or sensitive API keys in this file. Those should remain securely stored in `.env` files and `firmware/src/secrets.h` (which is git-ignored).

---

## 1. Local Hardware Access Point (AP)
When the device is powered on, it permanently broadcasts a Wi-Fi Access Point for technicians to connect and perform local diagnostics.

- **Network Name (SSID):** `TrackLocator-Service`
- **Wi-Fi Password (WPA2):** `GTrack2026`

## 2. Local Maintenance Portal (Captive Portal)
Once connected to the hardware's Wi-Fi network, navigate to the local portal to view live GPS status, network health, and battery levels, or to configure Wi-Fi credentials.

- **URL:** [http://192.168.4.1/](http://192.168.4.1/) (Will automatically open as a Captive Portal on most devices)
- **Username:** `admin`
- **Password:** `GTrack@2026!`

## 3. SIM / Connectivity Credentials
- **Device 1 (SIM):** `09613556081` (Smart PH)

## 4. Web-Hosted Dashboard
The global tracking application where administrators can monitor the entire fleet of garbage trucks in real time.

- **Production URL:** [https://garbage-truck-gps-z59i-2wpo36hdb-dumjaes-projects.vercel.app/](https://garbage-truck-gps-z59i-2wpo36hdb-dumjaes-projects.vercel.app/)
- **Authentication:** Managed securely via Supabase Auth (use your registered administrator email and password).

---
*Note: If you change the default passwords in the firmware (`config.h`), be sure to update this document accordingly for your field technicians.*
