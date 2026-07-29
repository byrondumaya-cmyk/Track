// ╔══════════════════════════════════════════════════════════════╗
// ║  system_state.h — Shared State Types                         ║
// ║  Single source of truth for all device operational state.    ║
// ║  Read by: Portal /status API, TaskLED, Portal UI renderer.   ║
// ╚══════════════════════════════════════════════════════════════╝
#pragma once
#include <Arduino.h>

// ─────────────────────────────────────────────────────────────
// Provisioning / Connection State Machine
// ─────────────────────────────────────────────────────────────
enum ProvState : uint8_t {
  PROV_IDLE = 0,         // AP up, awaiting credentials
  PROV_CONNECTING,       // WiFi.begin() called, waiting for WL_CONNECTED
  PROV_DHCP_WAIT,        // STA connected, waiting for non-zero IP
  PROV_INTERNET_CHECK,   // HEAD /health — is backend reachable?
  PROV_AUTH_CHECK,       // POST /ingest dry-run — is API key valid?
  PROV_SUCCESS,          // Fully operational
  PROV_FAILED            // Stopped at a known stage; see FailReason
};

// ─────────────────────────────────────────────────────────────
// Failure Reason Codes
// ─────────────────────────────────────────────────────────────
enum FailReason : uint8_t {
  FAIL_NONE = 0,
  FAIL_WRONG_PASSWORD,
  FAIL_SSID_NOT_FOUND,
  FAIL_DHCP_TIMEOUT,
  FAIL_INTERNET_UNREACHABLE,
  FAIL_BACKEND_UNREACHABLE,
  FAIL_AUTH_FAILED,
  FAIL_LTE_NO_SIM,
  FAIL_LTE_REGISTRATION,
  FAIL_TIMEOUT,
  FAIL_UNKNOWN
};

// ─────────────────────────────────────────────────────────────
// Normal Operational Network State (post-provisioning)
// ─────────────────────────────────────────────────────────────
enum NetState : uint8_t {
  NET_DISCONNECTED = 0,
  NET_WIFI_CONNECTING,
  NET_WIFI_CONNECTED,
  NET_LTE_CONNECTING,
  NET_LTE_CONNECTED,
  NET_INTERNET_OK,
  NET_BACKEND_OK,
  NET_TRACKING   // Fully operational — uploading telemetry
};

// ─────────────────────────────────────────────────────────────
// Active Communication Interface
// ─────────────────────────────────────────────────────────────
enum ActiveIface : uint8_t {
  IFACE_NONE = 0,
  IFACE_WIFI,
  IFACE_LTE
};

// ─────────────────────────────────────────────────────────────
// Device Health — Single Source of Truth
// Updated from multiple tasks; read by /status endpoint.
// Fields written atomically where possible; portal polls at 2s.
// ─────────────────────────────────────────────────────────────
struct DeviceHealth {
  // ── Device ───────────────────────────────────────────────
  uint32_t   uptime_s          = 0;
  uint32_t   free_heap         = 0;
  uint32_t   cpu_freq_mhz      = 240;

  // ── Provisioning ─────────────────────────────────────────
  ProvState  prov_state        = PROV_IDLE;
  FailReason fail_reason       = FAIL_NONE;
  String     prov_target_ssid  = "";   // SSID currently being attempted

  // ── Network ──────────────────────────────────────────────
  ActiveIface active_iface     = IFACE_NONE;
  bool       wifi_connected    = false;
  String     wifi_ssid         = "";
  String     wifi_ip           = "0.0.0.0";
  String     wifi_gateway      = "0.0.0.0";
  int        wifi_rssi         = 0;
  bool       lte_registered    = false;
  String     lte_operator      = "";
  int        lte_rssi          = 0;
  bool       sim_present       = false;
  bool       internet_ok       = false;
  bool       backend_reachable = false;
  bool       authenticated     = false;
  bool       telemetry_ready   = false;

  // ── GPS ──────────────────────────────────────────────────
  bool       gps_fix           = false;
  int        gps_satellites    = 0;
  float      gps_lat           = 0.0f;
  float      gps_lon           = 0.0f;
  float      gps_speed_kmh     = 0.0f;
  float      gps_accuracy_m    = 0.0f;
  uint32_t   gps_last_fix_ago_s = 0;

  // ── Power ────────────────────────────────────────────────
  int        battery_pct       = 0;
  float      battery_v         = 0.0f;

  // ── Storage ──────────────────────────────────────────────
  int        nvs_buffered      = 0;
  int        nvs_capacity      = 200;

  // ── Communication ────────────────────────────────────────
  uint32_t   last_upload_ago_s = 0;
  int        consecutive_failures = 0;
  int        queue_size        = 0;
};

// ─────────────────────────────────────────────────────────────
// Human-readable label helpers
// ─────────────────────────────────────────────────────────────
inline const char* provStateLabel(ProvState s) {
  switch (s) {
    case PROV_IDLE:            return "IDLE";
    case PROV_CONNECTING:      return "CONNECTING";
    case PROV_DHCP_WAIT:       return "DHCP_WAIT";
    case PROV_INTERNET_CHECK:  return "INTERNET_CHECK";
    case PROV_AUTH_CHECK:      return "AUTH_CHECK";
    case PROV_SUCCESS:         return "SUCCESS";
    case PROV_FAILED:          return "FAILED";
    default:                   return "UNKNOWN";
  }
}

inline const char* failReasonLabel(FailReason r) {
  switch (r) {
    case FAIL_NONE:                 return "none";
    case FAIL_WRONG_PASSWORD:       return "WRONG_PASSWORD";
    case FAIL_SSID_NOT_FOUND:       return "SSID_NOT_FOUND";
    case FAIL_DHCP_TIMEOUT:         return "DHCP_TIMEOUT";
    case FAIL_INTERNET_UNREACHABLE: return "INTERNET_UNREACHABLE";
    case FAIL_BACKEND_UNREACHABLE:  return "BACKEND_UNREACHABLE";
    case FAIL_AUTH_FAILED:          return "AUTH_FAILED";
    case FAIL_LTE_NO_SIM:           return "LTE_NO_SIM";
    case FAIL_LTE_REGISTRATION:     return "LTE_REGISTRATION";
    case FAIL_TIMEOUT:              return "TIMEOUT";
    default:                        return "UNKNOWN";
  }
}

inline const char* ifaceLabel(ActiveIface i) {
  switch (i) {
    case IFACE_WIFI: return "WIFI";
    case IFACE_LTE:  return "LTE";
    default:         return "NONE";
  }
}
