// ╔══════════════════════════════════════════════════════════════╗
// ║  config.h — GarbageTrack Firmware Configuration              ║
// ║  All tuneable constants live here.                           ║
// ║  Secrets (keys, host) are in secrets.h (git-ignored).       ║
// ╚══════════════════════════════════════════════════════════════╝
#pragma once

// ─────────────────────────────────────────────────────────────
// Firmware Version
// ─────────────────────────────────────────────────────────────
#define FW_VERSION "1.3.0"

// ─────────────────────────────────────────────────────────────
// Timing & Limits
// ─────────────────────────────────────────────────────────────
#define WDT_TIMEOUT_S 120     // Hardware watchdog reset threshold (seconds)
#define GPS_INTERVAL_MS 15000 // GPS poll interval (live tracking)
#define FLASH_INTERVAL_MS 30000 // Offline-only flash-write interval (saves NVS)
#define WIFI_CONNECT_TIMEOUT_MS 15000 // Per-SSID connection attempt timeout
#define LTE_CONNECT_TIMEOUT_MS 60000  // APN connect timeout
#define UPLOAD_FAIL_REBOOT_LIMIT                                               \
  30 // Reboot after N consecutive upload failures
#define WIFI_RECONNECT_INTERVAL_MS 60000 // WiFi reconnect retry interval
#define PROV_INTERNET_TIMEOUT_MS 8000    // Backend health check HTTP timeout

// ─────────────────────────────────────────────────────────────
// Storage
// ─────────────────────────────────────────────────────────────
#define FLASH_NS "gpsq"   // NVS namespace: GPS offline queue
#define WIFI_NS "wificfg" // NVS namespace: WiFi credential cache
#define DIAG_NS "diagcfg" // NVS namespace: Diagnostics portal config
#define APN_NS  "apncfg"  // NVS namespace: Dynamic APN configuration
#define FLASH_KEY_COUNT "count"
#define FLASH_MAX_RECORDS 200 // ~100 min offline buffer at 30s intervals
#define WIFI_MAX_NETWORKS 10  // Max stored WiFi networks

// ─────────────────────────────────────────────────────────────
// Hardware Pins — LILYGO T-Call A7670E
// Verified against official LilyGO reference:
// github.com/ittipu/IoT_Bhai_Youtube_Channel/.../3_Getting_GPS...
// ─────────────────────────────────────────────────────────────
#define MODEM_TX      26  // ESP32 → Modem (Serial1 TX)
#define MODEM_RX      25  // Modem → ESP32 (Serial1 RX)
#define MODEM_PWRKEY   4  // Active-high 100ms pulse to power on
#define MODEM_RESET   27  // Active-LOW reset; pulse to recover from bad state
#define MODEM_DTR     14  // Data Terminal Ready — keep LOW to prevent sleep
#define MODEM_RI      13  // Ring Indicator (input)
#define BOARD_LED     12  // Onboard LED (HIGH = on)
#define BAT_ADC       35  // Battery voltage ADC
#define LED_PIN       12  // Status indicator LED (same as BOARD_LED)

// ─────────────────────────────────────────────────────────────
// Service & Diagnostics Access Point
//
// DIAG_AP_SSID / DIAG_AP_PASS are compile-time defaults.
// Future: load overrides from NVS (DIAG_NS namespace) at boot
// so the password can be changed via the portal without reflashing.
// ─────────────────────────────────────────────────────────────
#define DIAG_AP_SSID "TrackLocator-Service"
#define DIAG_AP_PASS "GTrack2026" // WPA2 — change via portal or reflash
#define DIAG_AP_CHANNEL 1
#define DIAG_AP_MAX_CON 3 // Max simultaneous technician connections
#define DIAG_AP_IP "192.168.4.1"

// ─────────────────────────────────────────────────────────────
// Web Portal Authentication (Layer 2, after WPA2)
//
// PORTAL_USER / PORTAL_PASS are compile-time defaults.
// Future: store hashed password in NVS so it can be changed
// through the portal without reflashing firmware.
// ─────────────────────────────────────────────────────────────
#define PORTAL_USER "admin"
#define PORTAL_PASS "GTrack@2026!" // Must differ from AP pass in production
#define PORTAL_SESSION_TIMEOUT_MS                                              \
  (30UL * 60 * 1000) // 30-minute session idle timeout

// ─────────────────────────────────────────────────────────────
// Backend Health Check
// Uses our own /health Edge Function to verify the backend is
// reachable — NOT a generic host like google.com.
// ─────────────────────────────────────────────────────────────
#define BACKEND_HEALTH_PATH "/functions/v1/health"

// ─────────────────────────────────────────────────────────────
// Misc
// ─────────────────────────────────────────────────────────────
#define WIFI_HOSTNAME "tracklocator-001" // mDNS/DHCP hostname
#define LOG_MAX_ENTRIES 25               // Rolling in-memory event log size

// ─────────────────────────────────────────────────────────────
// Cellular / LTE — APN defaults per carrier
// Runtime APN is loaded from NVS (APN_NS) at boot.
// If no NVS value exists, DEFAULT_APN is used.
// ─────────────────────────────────────────────────────────────
#define DEFAULT_APN "internet" // Smart PH / DITO PH default
                               // Globe PH: "internet.globe.com.ph"
