// ╔══════════════════════════════════════════════════════════════╗
// ║  config.h — GarbageTrack Firmware Configuration              ║
// ║  All tuneable constants live here.                           ║
// ║  Secrets (keys, host) are in secrets.h (git-ignored).       ║
// ╚══════════════════════════════════════════════════════════════╝
#pragma once

// ─────────────────────────────────────────────────────────────
// Firmware Version
// ─────────────────────────────────────────────────────────────
#define FW_VERSION "1.2.0"

// ─────────────────────────────────────────────────────────────
// Timing & Limits
// ─────────────────────────────────────────────────────────────
#define WDT_TIMEOUT_S 120     // Hardware watchdog reset threshold (seconds)
#define GPS_INTERVAL_MS 15000 // GPS poll interval while moving
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
#define FLASH_KEY_COUNT "count"
#define FLASH_MAX_RECORDS 200 // ~50 min offline buffer at 15s intervals
#define WIFI_MAX_NETWORKS 10  // Max stored WiFi networks

// ─────────────────────────────────────────────────────────────
// Hardware Pins — LILYGO T-Call A7670E
// ─────────────────────────────────────────────────────────────
#define MODEM_TX 27
#define MODEM_RX 26
#define MODEM_PWRKEY 4
#define MODEM_DTR 32
#define MODEM_RI 33
#define MODEM_FLIGHT 25
#define MODEM_STATUS 34
#define BAT_ADC 35
#define LED_PIN 13 // Status indicator LED

// ─────────────────────────────────────────────────────────────
// Service & Diagnostics Access Point
//
// DIAG_AP_SSID / DIAG_AP_PASS are compile-time defaults.
// Future: load overrides from NVS (DIAG_NS namespace) at boot
// so the password can be changed via the portal without reflashing.
// ─────────────────────────────────────────────────────────────
#define DIAG_AP_SSID "GarbageTrack-Service"
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
#define WIFI_HOSTNAME "garbagetrack-001" // mDNS/DHCP hostname
#define LOG_MAX_ENTRIES 25               // Rolling in-memory event log size
