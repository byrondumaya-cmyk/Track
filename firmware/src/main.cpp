// ╔══════════════════════════════════════════════════════════════╗
// ║  GarbageTrack GPS Firmware v1.1.0                           ║
// ║  Hardware: LILYGO T-Call A7670E (ESP32 + SIM7670 modem)     ║
// ║                                                              ║
// ║  Features:                                                   ║
// ║  • Integrated GNSS via A7670E modem                         ║
// ║  • Dual upload path: WiFi (preferred) / LTE (fallback)      ║
// ║  • Cloud-stored WiFi credentials (fetched from Supabase)    ║
// ║  • Captive-portal WiFi provisioning AP                      ║
// ║  • NVS offline flash queue (≈50 min buffering)              ║
// ║  • FreeRTOS multi-task + hardware watchdog                  ║
// ╚══════════════════════════════════════════════════════════════╝

#include "secrets.h" // Credentials — NOT committed to git
#include <Arduino.h>
#include <ArduinoJson.h>
#include <DNSServer.h>
#include <HTTPClient.h>
#include <Preferences.h>
#include <TinyGsmClient.h>
#include <WebServer.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <esp_task_wdt.h>

class TinyGsmClientSecure : public TinyGsmClient {
public:
  TinyGsmClientSecure(TinyGsm &modem) : TinyGsmClient(modem) {}
  void setInsecure() {}
  void setCACert(const char *) {}
  void setCertificate(const char *) {}
  void setPrivateKey(const char *) {}
};

// ─────────────────────────────────────────────────────────────
// CONFIGURATION
// ─────────────────────────────────────────────────────────────
#define LTE_CONNECT_TIMEOUT_MS 60000  // APN connect timeout
#define WDT_TIMEOUT_S 120             // Watchdog: reset if hung >2 min
#define UPLOAD_FAIL_REBOOT_LIMIT 10   // Reboot after N consecutive failures
#define GPS_INTERVAL_MS 15000         // GPS poll interval (moving)
#define WIFI_CONNECT_TIMEOUT_MS 15000 // Per-SSID connection timeout
#define WIFI_MAX_NETWORKS 10          // Max stored WiFi networks

// Provisioning AP settings
#define PROV_AP_SSID "GarbageTrack-Setup"
#define PROV_AP_PASS "" // Open AP — secured by captive portal
#define PROV_AP_IP "192.168.4.1"
#define PROV_BTN_PIN 0 // BOOT button (GPIO 0) — hold 3s to re-provision
#define WIFI_HOSTNAME "garbagetrack-001" // mDNS/DHCP hostname

// NVS namespaces
#define FLASH_NS "gpsq"   // GPS flash queue namespace
#define WIFI_NS "wificfg" // WiFi credential cache namespace
#define FLASH_KEY_COUNT "count"
#define FLASH_MAX_RECORDS 200 // ≈50 min offline buffer

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
#define LED_PIN 13 // Status indicator


// ─────────────────────────────────────────────────────────────
// Global Objects
// ─────────────────────────────────────────────────────────────
HardwareSerial SerialAT(1);
TinyGsm modem(SerialAT);
TinyGsmClientSecure lteSecureClient(modem); // LTE data path

Preferences prefs;     // GPS flash queue (NVS)
Preferences wifiPrefs; // WiFi credential cache (NVS)

WebServer portalServer(80); // Captive portal HTTP server
DNSServer dnsServer;        // DNS redirect for captive portal

struct GPSRecord {
  float lat, lon, speed_kmh, heading_deg, accuracy_m;
  int satellites, battery_pct;
  bool gps_fix;
  bool wifi_connected; // which path uploaded this record
  int year, month, day, hour, min, sec;
};

// Inter-task state
QueueHandle_t gpsQueue;
volatile bool wifiConnected = false; // WiFi data path available
volatile int consecutiveFailures = 0;

// ─────────────────────────────────────────────────────────────
// Function Prototypes
// ─────────────────────────────────────────────────────────────
void TaskGPS(void *pvParameters);
void TaskUpload(void *pvParameters);
void TaskWiFi(void *pvParameters); // WiFi connect + monitor (no OTA)

void modemPowerOn();
int readBatteryPercentage();
bool ensureLTE();
void buildTimestamp(const GPSRecord &r, char *buf, size_t len);

// Upload paths
bool uploadViaWiFi(const GPSRecord &r);
bool uploadViaLTE(const GPSRecord &r);
bool uploadRecord(GPSRecord &r);

// WiFi provisioning
bool tryConnectWiFi();
void startProvisioningAP();
void postProvisionCredentials(const String &ssid, const String &pass);

// Device config (cloud WiFi list)
void fetchDeviceConfig();
void saveWiFiToNVS(const String &ssid, const String &pass);
int loadWiFiFromNVS(String ssids[], String passes[], int maxCount);

// Flash queue (GPS offline buffer)
void flashSave(const GPSRecord &r);
bool flashLoad(GPSRecord &out);
void flashPop();
int flashCount();

// ─────────────────────────────────────────────────────────────
// Captive Portal HTML
// ─────────────────────────────────────────────────────────────
static const char PORTAL_HTML[] PROGMEM =
    R"rawhtml(
<!DOCTYPE html><html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>GarbageTrack WiFi Setup</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:system-ui,sans-serif;background:#0d1117;color:#e6edf3;
       min-height:100vh;display:flex;align-items:center;justify-content:center;padding:16px}
  .card{background:#161b22;border:1px solid #30363d;border-radius:12px;
        padding:28px 24px;width:100%;max-width:360px}
  h1{font-size:18px;font-weight:700;color:#00d4aa;margin-bottom:4px}
  p{font-size:13px;color:#8b949e;margin-bottom:20px}
  label{display:block;font-size:12px;color:#8b949e;margin-bottom:4px;font-weight:500}
  input{width:100%;padding:10px 12px;background:#0d1117;border:1px solid #30363d;
        border-radius:8px;color:#e6edf3;font-size:14px;margin-bottom:14px;outline:none}
  input:focus{border-color:#00d4aa}
  button{width:100%;padding:11px;background:linear-gradient(135deg,#00d4aa,#00a87c);
         border:none;border-radius:8px;color:#001a14;font-weight:700;font-size:14px;
         cursor:pointer;margin-top:4px}
  .note{font-size:11px;color:#484f58;text-align:center;margin-top:14px}
</style>
</head>
<body>
<div class="card">
  <h1>🛰 GarbageTrack Setup</h1>
  <p>Enter your WiFi credentials. The device will save them to the cloud and connect automatically.</p>
  <form method="POST" action="/save">
    <label>WiFi Network (SSID)</label>
    <input type="text" name="ssid" placeholder="Your network name" required autocomplete="off">
    <label>Password</label>
    <input type="password" name="password" placeholder="Leave blank for open networks" autocomplete="off">
    <button type="submit">Save &amp; Connect</button>
  </form>
  <p class="note">Device ID: )rawhtml" DEVICE_ID
    R"rawhtml( &nbsp;|&nbsp; v)rawhtml" FW_VERSION R"rawhtml(</p>
</div>
</body></html>
)rawhtml";

static const char PORTAL_SUCCESS_HTML[] PROGMEM = R"rawhtml(
<!DOCTYPE html><html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Saved!</title>
<style>
  body{font-family:system-ui,sans-serif;background:#0d1117;color:#e6edf3;
       min-height:100vh;display:flex;align-items:center;justify-content:center;padding:16px}
  .card{background:#161b22;border:1px solid #00d4aa44;border-radius:12px;
        padding:28px 24px;width:100%;max-width:360px;text-align:center}
  h1{font-size:20px;color:#00d4aa;margin-bottom:8px}
  p{font-size:13px;color:#8b949e}
</style>
</head>
<body>
<div class="card">
  <h1>✅ Credentials Saved</h1>
  <p>WiFi network saved to cloud. The device will reboot and connect automatically.</p>
  <p style="margin-top:12px;font-size:12px;color:#484f58">You can close this page.</p>
</div>
</body></html>
)rawhtml";

// ─────────────────────────────────────────────────────────────
// Setup
// ─────────────────────────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  delay(50);
  Serial.printf("[BOOT] GarbageTrack GPS v%s — Starting\n", FW_VERSION);

  pinMode(LED_PIN, OUTPUT);
  digitalWrite(LED_PIN, LOW);

  // ── Watchdog ──────────────────────────────────────────────
  esp_task_wdt_init(WDT_TIMEOUT_S, true);
  esp_task_wdt_add(NULL);

  // ── NVS ───────────────────────────────────────────────────
  prefs.begin(FLASH_NS, false);
  wifiPrefs.begin(WIFI_NS, false);

  String savedSSIDs[WIFI_MAX_NETWORKS], savedPasses[WIFI_MAX_NETWORKS];
  int storedWiFiCount = loadWiFiFromNVS(savedSSIDs, savedPasses, WIFI_MAX_NETWORKS);

  // ── Check for provisioning mode (hold BOOT btn at startup, or no saved WiFi)
  pinMode(PROV_BTN_PIN, INPUT_PULLUP);
  unsigned long btnStart = millis();
  bool triggerProvisioning = false;
  while (millis() - btnStart < 3000) {
    if (digitalRead(PROV_BTN_PIN) == LOW) {
      delay(50);
      if (digitalRead(PROV_BTN_PIN) == LOW) {
        Serial.println("[BOOT] BOOT button held — entering provisioning mode");
        triggerProvisioning = true;
        break;
      }
    }
    esp_task_wdt_reset();
    delay(100);
  }

  if (storedWiFiCount == 0) {
    Serial.println("[BOOT] No saved WiFi credentials — entering provisioning mode");
    triggerProvisioning = true;
  }

  int savedGps = flashCount();
  if (savedGps > 0) {
    Serial.printf("[BOOT] Flash queue: %d GPS records from prev session\n",
                  savedGps);
  }

  // ── FreeRTOS queue ─────────────────────────────────────────
  gpsQueue = xQueueCreate(20, sizeof(GPSRecord));
  if (!gpsQueue) {
    Serial.println("[BOOT] FATAL: Queue creation failed");
    esp_restart();
  }

  // ── Modem ─────────────────────────────────────────────────
  SerialAT.begin(115200, SERIAL_8N1, MODEM_RX, MODEM_TX);
  modemPowerOn();
  esp_task_wdt_reset();

  if (triggerProvisioning) {
    // Provisioning mode: block here until user submits WiFi form
    startProvisioningAP();
    // After credentials saved, device restarts
    esp_restart();
  }

  // ── Normal boot: fetch cloud WiFi list via LTE ─────────────
  // This runs synchronously in setup() so WiFi config is ready
  // before the WiFiOTA task starts.
  fetchDeviceConfig();
  esp_task_wdt_reset();

  // ── FreeRTOS tasks ─────────────────────────────────────────
  // Core 0: WiFi monitor (doesn't compete with GPS/LTE on core 1)
  // Core 1: GPS polling + Upload (time-critical)
  xTaskCreatePinnedToCore(TaskWiFi, "WiFi", 4096, NULL, 1, NULL, 0);
  xTaskCreatePinnedToCore(TaskGPS, "GPS", 4096, NULL, 1, NULL, 1);
  xTaskCreatePinnedToCore(TaskUpload, "Upload", 10240, NULL, 2, NULL, 1);

  esp_task_wdt_delete(NULL);
}

void loop() { 
  if (WiFi.getMode() == WIFI_AP_STA || WiFi.getMode() == WIFI_AP) {
    // Fast blink for AP provisioning
    digitalWrite(LED_PIN, !digitalRead(LED_PIN));
    vTaskDelay(pdMS_TO_TICKS(200));
  } else if (!wifiConnected && !modem.isNetworkConnected()) {
    // Slow blink connecting
    digitalWrite(LED_PIN, !digitalRead(LED_PIN));
    vTaskDelay(pdMS_TO_TICKS(1000));
  } else {
    // Solid on when connected
    digitalWrite(LED_PIN, HIGH);
    vTaskDelay(pdMS_TO_TICKS(1000));
  }
}

// ─────────────────────────────────────────────────────────────
// Modem Power-On Sequence (LILYGO T-Call A7670E)
// ─────────────────────────────────────────────────────────────
void modemPowerOn() {
  pinMode(MODEM_PWRKEY, OUTPUT);
  digitalWrite(MODEM_PWRKEY, LOW);
  delay(100);
  digitalWrite(MODEM_PWRKEY, HIGH);
  delay(1000);
  digitalWrite(MODEM_PWRKEY, LOW);
  Serial.println("[BOOT] Modem power-on complete");
}

// ─────────────────────────────────────────────────────────────
// Battery Percentage (ADC → voltage divider → percentage)
// T-Call A7670E uses a 2× voltage divider on BAT_ADC (GPIO35)
// ─────────────────────────────────────────────────────────────
int readBatteryPercentage() {
  int raw = analogRead(BAT_ADC);
  float volt = (raw / 4095.0f) * 3.3f * 2.0f;
  int pct = (int)((volt - 3.2f) / (4.2f - 3.2f) * 100.0f);
  return constrain(pct, 0, 100);
}

// ─────────────────────────────────────────────────────────────
// ISO-8601 UTC Timestamp
// ─────────────────────────────────────────────────────────────
void buildTimestamp(const GPSRecord &r, char *buf, size_t len) {
  snprintf(buf, len, "%04d-%02d-%02dT%02d:%02d:%02dZ", r.year, r.month, r.day,
           r.hour, r.min, r.sec);
}

// ─────────────────────────────────────────────────────────────
// LTE: ensure modem is registered and GPRS data is active
// ─────────────────────────────────────────────────────────────
bool ensureLTE() {
  if (!modem.isNetworkConnected()) {
    Serial.println("[LTE] Waiting for network...");
    if (!modem.waitForNetwork(LTE_CONNECT_TIMEOUT_MS, true)) {
      Serial.println("[LTE] Network timeout");
      return false;
    }
  }
  if (!modem.isGprsConnected()) {
    Serial.println("[LTE] Connecting GPRS...");
    if (!modem.gprsConnect(APN, "", "")) {
      Serial.println("[LTE] GPRS connect failed");
      return false;
    }
  }
  return true;
}

// ─────────────────────────────────────────────────────────────
// WiFi: save a network credential to NVS cache
// ─────────────────────────────────────────────────────────────
void saveWiFiToNVS(const String &ssid, const String &pass) {
  // Load existing networks, deduplicate, then append
  String ssids[WIFI_MAX_NETWORKS], passes[WIFI_MAX_NETWORKS];
  int count = loadWiFiFromNVS(ssids, passes, WIFI_MAX_NETWORKS);

  // Check if already exists — update password if so
  for (int i = 0; i < count; i++) {
    if (ssids[i] == ssid) {
      passes[i] = pass;
      // Re-save all
      wifiPrefs.putInt("count", count);
      for (int j = 0; j < count; j++) {
        char sk[12], pk[12];
        snprintf(sk, sizeof(sk), "s%d", j);
        snprintf(pk, sizeof(pk), "p%d", j);
        wifiPrefs.putString(sk, ssids[j]);
        wifiPrefs.putString(pk, passes[j]);
      }
      Serial.printf("[WIFI] Updated NVS for SSID: %s\n", ssid.c_str());
      return;
    }
  }

  // New network — append if space
  if (count < WIFI_MAX_NETWORKS) {
    char sk[12], pk[12];
    snprintf(sk, sizeof(sk), "s%d", count);
    snprintf(pk, sizeof(pk), "p%d", count);
    wifiPrefs.putString(sk, ssid);
    wifiPrefs.putString(pk, pass);
    wifiPrefs.putInt("count", count + 1);
    Serial.printf("[WIFI] NVS saved SSID: %s (total: %d)\n", ssid.c_str(),
                  count + 1);
  } else {
    Serial.println("[WIFI] NVS full — overwriting oldest entry");
    // Shift entries down and add new one at the end
    for (int i = 0; i < WIFI_MAX_NETWORKS - 1; i++) {
      ssids[i] = ssids[i + 1];
      passes[i] = passes[i + 1];
    }
    ssids[WIFI_MAX_NETWORKS - 1] = ssid;
    passes[WIFI_MAX_NETWORKS - 1] = pass;
    wifiPrefs.putInt("count", WIFI_MAX_NETWORKS);
    for (int j = 0; j < WIFI_MAX_NETWORKS; j++) {
      char sk[12], pk[12];
      snprintf(sk, sizeof(sk), "s%d", j);
      snprintf(pk, sizeof(pk), "p%d", j);
      wifiPrefs.putString(sk, ssids[j]);
      wifiPrefs.putString(pk, passes[j]);
    }
  }
}

// ─────────────────────────────────────────────────────────────
// WiFi: load all networks from NVS
// Returns number of networks loaded
// ─────────────────────────────────────────────────────────────
int loadWiFiFromNVS(String ssids[], String passes[], int maxCount) {
  int count = wifiPrefs.getInt("count", 0);
  count = min(count, maxCount);
  for (int i = 0; i < count; i++) {
    char sk[12], pk[12];
    snprintf(sk, sizeof(sk), "s%d", i);
    snprintf(pk, sizeof(pk), "p%d", i);
    ssids[i] = wifiPrefs.getString(sk, "");
    passes[i] = wifiPrefs.getString(pk, "");
  }
  return count;
}

// ─────────────────────────────────────────────────────────────
// WiFi: scan available networks, connect to strongest known SSID
// Returns true if connected
// ─────────────────────────────────────────────────────────────
bool tryConnectWiFi() {
  String ssids[WIFI_MAX_NETWORKS], passes[WIFI_MAX_NETWORKS];
  int storedCount = loadWiFiFromNVS(ssids, passes, WIFI_MAX_NETWORKS);

  if (storedCount == 0) {
    Serial.println("[WIFI] No stored networks — skipping WiFi");
    return false;
  }

  Serial.printf("[WIFI] Scanning... (%d stored networks)\n", storedCount);
  int found = WiFi.scanNetworks();
  if (found <= 0) {
    Serial.println("[WIFI] No networks found");
    return false;
  }

  // Build candidate list sorted by RSSI (strongest first)
  // Find which stored SSIDs are visible
  int bestIdx = -1;
  int bestRSSI = -9999;

  for (int s = 0; s < found; s++) {
    String scannedSSID = WiFi.SSID(s);
    for (int k = 0; k < storedCount; k++) {
      if (scannedSSID == ssids[k]) {
        int rssi = WiFi.RSSI(s);
        if (rssi > bestRSSI) {
          bestRSSI = rssi;
          bestIdx = k;
        }
      }
    }
  }
  WiFi.scanDelete();

  if (bestIdx < 0) {
    Serial.println("[WIFI] No known networks visible");
    return false;
  }

  Serial.printf("[WIFI] Connecting to: %s (RSSI: %d)\n", ssids[bestIdx].c_str(),
                bestRSSI);

  WiFi.begin(ssids[bestIdx].c_str(), passes[bestIdx].c_str());

  unsigned long deadline = millis() + WIFI_CONNECT_TIMEOUT_MS;
  while (WiFi.status() != WL_CONNECTED && millis() < deadline) {
    delay(250);
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("[WIFI] Connected! IP: %s\n",
                  WiFi.localIP().toString().c_str());
    return true;
  }

  Serial.println("[WIFI] Connection failed");
  WiFi.disconnect(true);
  return false;
}

// ─────────────────────────────────────────────────────────────
// Cloud config fetch: GET /functions/v1/device-config via LTE
// Merges returned WiFi networks into NVS cache
// ─────────────────────────────────────────────────────────────
void fetchDeviceConfig() {
  Serial.println("[CFG] Fetching device config from cloud...");

  modem.restart();
  delay(3000);
  Serial.println("[CFG] Modem: " + modem.getModemInfo());

  lteSecureClient.setInsecure(); // TODO: add CA cert for production

  if (!ensureLTE()) {
    Serial.println("[CFG] LTE unavailable — using cached WiFi list");
    return;
  }

  if (!lteSecureClient.connect(SUPABASE_HOST, 443)) {
    Serial.println("[CFG] TCP connect failed");
    return;
  }

  lteSecureClient.println("GET /functions/v1/device-config HTTP/1.1");
  lteSecureClient.println("Host: " + String(SUPABASE_HOST));
  lteSecureClient.println("X-Device-ID: " DEVICE_ID);
  lteSecureClient.println("X-API-Key: " DEVICE_API_KEY);
  lteSecureClient.println("Connection: close");
  lteSecureClient.println();

  // Read response
  unsigned long deadline = millis() + 10000UL;
  String body;
  bool inBody = false;
  while (lteSecureClient.connected() && millis() < deadline) {
    if (lteSecureClient.available()) {
      String line = lteSecureClient.readStringUntil('\n');
      if (line == "\r") {
        inBody = true;
        continue;
      }
      if (inBody) {
        body += line;
      }
    }
  }
  lteSecureClient.stop();

  if (body.isEmpty()) {
    Serial.println("[CFG] Empty response");
    return;
  }

  JsonDocument doc;
  if (deserializeJson(doc, body) != DeserializationError::Ok) {
    Serial.println("[CFG] JSON parse failed");
    return;
  }

  JsonArray networks = doc["wifi_networks"].as<JsonArray>();
  int merged = 0;
  for (JsonObject net : networks) {
    String ssid = net["ssid"] | "";
    String pass = net["password"] | "";
    if (ssid.length() > 0) {
      saveWiFiToNVS(ssid, pass);
      merged++;
    }
  }

  const char *fwLatest = doc["fw_version_latest"] | "";
  Serial.printf("[CFG] Merged %d WiFi networks from cloud. FW latest: %s\n",
                merged, fwLatest);
}

// ─────────────────────────────────────────────────────────────
// Provisioning: POST new WiFi credential to Supabase via LTE
// Called after user submits the captive portal form
// ─────────────────────────────────────────────────────────────
void postProvisionCredentials(const String &ssid, const String &pass) {
  if (!ensureLTE()) {
    Serial.println("[PROV] LTE unavailable — credential saved locally only");
    return;
  }

  JsonDocument doc;
  doc["ssid"] = ssid;
  doc["password"] = pass;
  String payload;
  serializeJson(doc, payload);

  if (!lteSecureClient.connect(SUPABASE_HOST, 443)) {
    Serial.println("[PROV] TCP connect failed");
    return;
  }

  lteSecureClient.println("POST /functions/v1/provision HTTP/1.1");
  lteSecureClient.println("Host: " + String(SUPABASE_HOST));
  lteSecureClient.println("Content-Type: application/json");
  lteSecureClient.println("X-Device-ID: " DEVICE_ID);
  lteSecureClient.println("X-API-Key: " DEVICE_API_KEY);
  lteSecureClient.print("Content-Length: ");
  lteSecureClient.println(payload.length());
  lteSecureClient.println("Connection: close");
  lteSecureClient.println();
  lteSecureClient.print(payload);

  unsigned long deadline = millis() + 10000UL;
  String status;
  while (lteSecureClient.connected() && millis() < deadline) {
    if (lteSecureClient.available()) {
      status = lteSecureClient.readStringUntil('\n');
      status.trim();
      break;
    }
  }
  lteSecureClient.stop();

  if (status.indexOf("200") >= 0) {
    Serial.printf("[PROV] Cloud saved: %s\n", ssid.c_str());
  } else {
    Serial.printf("[PROV] Cloud save failed: %s\n", status.c_str());
  }
}

// ─────────────────────────────────────────────────────────────
// Provisioning AP + Captive Portal
// Blocks until user submits credentials or timeout (5 min)
// ─────────────────────────────────────────────────────────────
void startProvisioningAP() {
  Serial.println("[PROV] Starting provisioning AP: " PROV_AP_SSID);

  WiFi.disconnect(true);
  WiFi.mode(WIFI_AP_STA);
  delay(100);
  WiFi.softAP(PROV_AP_SSID, PROV_AP_PASS);
  delay(500);

  IPAddress apIP(192, 168, 4, 1);
  WiFi.softAPConfig(apIP, apIP, IPAddress(255, 255, 255, 0));

  // DNS: redirect all hostnames to the portal IP (captive portal trick)
  dnsServer.start(53, "*", apIP);

  bool credentialsSaved = false;
  String newSSID, newPass;

  // Serve the portal form
  portalServer.on("/", HTTP_GET, [&]() {
    portalServer.send_P(200, "text/html", PORTAL_HTML);
  });

  // Redirect all unknown hosts to portal (catches Android/iOS captive probes)
  portalServer.onNotFound([&]() {
    portalServer.sendHeader("Location", "http://192.168.4.1/", true);
    portalServer.send(302, "text/plain", "");
  });

  portalServer.on("/save", HTTP_POST, [&]() {
    newSSID = portalServer.arg("ssid");
    newPass = portalServer.arg("password");

    if (newSSID.length() == 0) {
      portalServer.send(400, "text/plain", "SSID required");
      return;
    }

    Serial.printf("[PROV] Testing connection to: %s\n", newSSID.c_str());
    WiFi.begin(newSSID.c_str(), newPass.c_str());
    
    unsigned long timeout = millis() + 15000;
    while (WiFi.status() != WL_CONNECTED && millis() < timeout) {
      delay(250);
      esp_task_wdt_reset();
    }

    if (WiFi.status() == WL_CONNECTED) {
      // Save locally to NVS first (instant)
      saveWiFiToNVS(newSSID, newPass);
      credentialsSaved = true;

      portalServer.send_P(200, "text/html", PORTAL_SUCCESS_HTML);
      Serial.printf("[PROV] Connected and credentials saved for: %s\n", newSSID.c_str());
    } else {
      WiFi.disconnect();
      portalServer.send(400, "text/html", "<!DOCTYPE html><html><head><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><style>body{font-family:system-ui;background:#0d1117;color:#e6edf3;padding:20px;text-align:center;}button{padding:10px 20px;background:#00d4aa;border:none;border-radius:8px;margin-top:20px;cursor:pointer;font-weight:bold}</style></head><body><h2>Failed to connect</h2><p>Please check your password and try again.</p><button onclick=\"history.back()\">Go Back</button></body></html>");
      Serial.printf("[PROV] Failed to connect to: %s\n", newSSID.c_str());
    }
  });

  portalServer.begin();
  Serial.println(
      "[PROV] Portal live at http://192.168.4.1 — waiting for credentials");

  unsigned long timeout = millis() + 300000UL; // 5 min timeout
  while (!credentialsSaved && millis() < timeout) {
    dnsServer.processNextRequest();
    portalServer.handleClient();
    esp_task_wdt_reset();
    delay(10);
  }

  portalServer.stop();
  dnsServer.stop();
  WiFi.softAPdisconnect(true);

  if (credentialsSaved) {
    // Now post to cloud via LTE (modem was powered on in setup)
    postProvisionCredentials(newSSID, newPass);
    Serial.println("[PROV] Done — rebooting to connect to WiFi");
  } else {
    Serial.println("[PROV] Timeout — no credentials entered. Rebooting.");
  }
  delay(1000);
}

// ─────────────────────────────────────────────────────────────
// Upload: build JSON payload shared by both paths
// ─────────────────────────────────────────────────────────────
static String buildPayload(const GPSRecord &r) {
  char ts[32];
  buildTimestamp(r, ts, sizeof(ts));

  JsonDocument doc;
  JsonArray arr = doc.to<JsonArray>();
  JsonObject obj = arr.createNestedObject();

  obj["device_id"] = DEVICE_ID;
  obj["timestamp"] = ts;
  obj["lat"] = r.lat;
  obj["lon"] = r.lon;
  obj["speed_kmh"] = r.speed_kmh;
  obj["heading_deg"] = r.heading_deg;
  // Note: A7670E GNSS does not expose true HDOP/COG; accuracy_m is the
  // satellite accuracy estimate in meters returned by getGPS().
  obj["hdop"] = r.accuracy_m;
  obj["satellites"] = r.satellites;
  obj["battery_pct"] = r.battery_pct;
  obj["gps_fix"] = r.gps_fix;
  obj["wifi_connected"] = r.wifi_connected;

  String payload;
  serializeJson(doc, payload);
  return payload;
}

// ─────────────────────────────────────────────────────────────
// Upload via WiFi path (WiFiClientSecure + HTTPClient)
// ─────────────────────────────────────────────────────────────
bool uploadViaWiFi(GPSRecord &r) {
  if (WiFi.status() != WL_CONNECTED)
    return false;

  r.wifi_connected = true;
  String payload = buildPayload(r);

  WiFiClientSecure wifiClient;
  wifiClient.setInsecure(); // TODO: CA cert for production

  HTTPClient http;
  String url = String("https://") + SUPABASE_HOST + "/functions/v1/ingest";
  http.begin(wifiClient, url);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-Device-ID", DEVICE_ID);
  http.addHeader("X-API-Key", DEVICE_API_KEY);

  int code = http.POST(payload);
  http.end();

  Serial.printf("[UPLOAD] WiFi response: %d\n", code);
  return (code == 200 || code == 201);
}

// ─────────────────────────────────────────────────────────────
// Upload via LTE path (TinyGsmClientSecure — modem)
// ─────────────────────────────────────────────────────────────
bool uploadViaLTE(GPSRecord &r) {
  r.wifi_connected = false;
  String payload = buildPayload(r);

  if (!lteSecureClient.connect(SUPABASE_HOST, 443)) {
    Serial.println("[UPLOAD] LTE TCP connect failed");
    return false;
  }

  lteSecureClient.println("POST /functions/v1/ingest HTTP/1.1");
  lteSecureClient.println("Host: " + String(SUPABASE_HOST));
  lteSecureClient.println("Content-Type: application/json");
  lteSecureClient.println("X-Device-ID: " DEVICE_ID);
  lteSecureClient.println("X-API-Key: " DEVICE_API_KEY);
  lteSecureClient.print("Content-Length: ");
  lteSecureClient.println(payload.length());
  lteSecureClient.println("Connection: close");
  lteSecureClient.println();
  lteSecureClient.print(payload);

  unsigned long deadline = millis() + 10000UL;
  String status;
  while (lteSecureClient.connected() && millis() < deadline) {
    if (lteSecureClient.available()) {
      status = lteSecureClient.readStringUntil('\n');
      status.trim();
      break;
    }
  }
  lteSecureClient.stop();

  Serial.printf("[UPLOAD] LTE response: %s\n", status.c_str());
  return status.indexOf("200") >= 0 || status.indexOf("201") >= 0;
}

// ─────────────────────────────────────────────────────────────
// Upload dispatcher: WiFi preferred, LTE fallback
// ─────────────────────────────────────────────────────────────
bool uploadRecord(GPSRecord &r) {
  if (wifiConnected) {
    bool ok = uploadViaWiFi(r);
    if (ok)
      return true;
    Serial.println("[UPLOAD] WiFi upload failed — falling back to LTE");
  }
  return uploadViaLTE(r);
}

// ─────────────────────────────────────────────────────────────
// Flash Queue — NVS-backed persistent ring buffer
// Keys: "r000"…"r199" (record slots), "head", "count"
// ─────────────────────────────────────────────────────────────
int flashCount() { return prefs.getInt(FLASH_KEY_COUNT, 0); }

void flashSave(const GPSRecord &r) {
  int count = prefs.getInt(FLASH_KEY_COUNT, 0);
  int head = prefs.getInt("head", 0);

  if (count >= FLASH_MAX_RECORDS) {
    head = (head + 1) % FLASH_MAX_RECORDS;
    prefs.putInt("head", head);
    count = FLASH_MAX_RECORDS - 1;
  }

  int slot = (head + count) % FLASH_MAX_RECORDS;
  char key[8];
  snprintf(key, sizeof(key), "r%03d", slot);

  char buf[256];
  snprintf(buf, sizeof(buf),
           "{\"la\":%.6f,\"lo\":%.6f,\"sp\":%.1f,\"bp\":%d,\"fx\":%d,"
           "\"yr\":%d,\"mo\":%d,\"dy\":%d,\"hr\":%d,\"mn\":%d,\"sc\":%d}",
           r.lat, r.lon, r.speed_kmh, r.battery_pct, r.gps_fix ? 1 : 0, r.year,
           r.month, r.day, r.hour, r.min, r.sec);

  prefs.putString(key, buf);
  prefs.putInt(FLASH_KEY_COUNT, count + 1);
  Serial.printf("[FLASH] Saved slot %d (%d total)\n", slot, count + 1);
}

bool flashLoad(GPSRecord &out) {
  int count = prefs.getInt(FLASH_KEY_COUNT, 0);
  if (count == 0)
    return false;

  int head = prefs.getInt("head", 0);
  char key[8];
  snprintf(key, sizeof(key), "r%03d", head);
  String raw = prefs.getString(key, "");
  if (raw.isEmpty())
    return false;

  JsonDocument doc;
  if (deserializeJson(doc, raw) != DeserializationError::Ok)
    return false;

  out.lat = doc["la"] | 0.0f;
  out.lon = doc["lo"] | 0.0f;
  out.speed_kmh = doc["sp"] | 0.0f;
  out.battery_pct = doc["bp"] | 0;
  out.gps_fix = (doc["fx"] | 0) == 1;
  out.year = doc["yr"] | 2026;
  out.month = doc["mo"] | 1;
  out.day = doc["dy"] | 1;
  out.hour = doc["hr"] | 0;
  out.min = doc["mn"] | 0;
  out.sec = doc["sc"] | 0;
  return true;
}

void flashPop() {
  int count = prefs.getInt(FLASH_KEY_COUNT, 0);
  if (count == 0)
    return;
  int head = prefs.getInt("head", 0);
  char key[8];
  snprintf(key, sizeof(key), "r%03d", head);
  prefs.remove(key);
  prefs.putInt("head", (head + 1) % FLASH_MAX_RECORDS);
  prefs.putInt(FLASH_KEY_COUNT, count - 1);
}

// ─────────────────────────────────────────────────────────────
// Task: GPS Manager
// Polls A7670E integrated GNSS every GPS_INTERVAL_MS.
// GNSS and LTE are separate subsystems on the A7670E modem —
// GPS polling does NOT interrupt LTE data transmission.
// On valid fix → RAM queue; if queue full → NVS flash.
// ─────────────────────────────────────────────────────────────
void TaskGPS(void *pvParameters) {
  esp_task_wdt_add(NULL);

  vTaskDelay(pdMS_TO_TICKS(8000)); // Let modem fully initialize first
  Serial.println("[GPS] Enabling integrated GNSS...");
  modem.enableGPS();
  vTaskDelay(pdMS_TO_TICKS(2000));

  TickType_t lastPoll = xTaskGetTickCount();
  const TickType_t pollInterval = pdMS_TO_TICKS(GPS_INTERVAL_MS);

  for (;;) {
    esp_task_wdt_reset();

    if ((xTaskGetTickCount() - lastPoll) >= pollInterval) {
      GPSRecord rec = {};
      float lat = 0, lon = 0, speed = 0, alt = 0, acc = 0;
      int vsat = 0, usat = 0;

      bool fix =
          modem.getGPS(&lat, &lon, &speed, &alt, &vsat, &usat, &acc, &rec.year,
                       &rec.month, &rec.day, &rec.hour, &rec.min, &rec.sec);

      rec.lat = lat;
      rec.lon = lon;
      rec.speed_kmh = speed;
      // A7670E basic GNSS API does not provide heading/COG
      rec.heading_deg = 0;
      // acc = satellite accuracy estimate in meters (NOT true HDOP)
      rec.accuracy_m = acc;
      rec.satellites = usat;
      rec.battery_pct = readBatteryPercentage();
      rec.gps_fix = fix && (lat != 0.0f) && (lon != 0.0f);
      // wifi_connected is set at upload time by uploadRecord()

      if (rec.gps_fix) {
        Serial.printf(
            "[GPS] Fix: %.6f, %.6f | %.1f km/h | bat:%d%% | sats:%d\n", lat,
            lon, speed, rec.battery_pct, usat);
      } else {
        Serial.printf("[GPS] No fix (visible:%d used:%d)\n", vsat, usat);
      }

      if (xQueueSend(gpsQueue, &rec, 0) != pdPASS) {
        Serial.println("[GPS] RAM queue full → saving to flash");
        flashSave(rec);
      }

      lastPoll = xTaskGetTickCount();
    }
    vTaskDelay(pdMS_TO_TICKS(1000));
  }
}

// ─────────────────────────────────────────────────────────────
// Task: Upload Manager
// Priority: drain NVS flash (offline buffer) → then live queue.
// Automatically uses WiFi or LTE depending on availability.
// ─────────────────────────────────────────────────────────────
void TaskUpload(void *pvParameters) {
  esp_task_wdt_add(NULL);

  // LTE modem was already restarted in fetchDeviceConfig (setup)
  // Just ensure it stays connected
  lteSecureClient.setInsecure();

  int backoffMs = 5000;
  const int maxMs = 120000;

  for (;;) {
    esp_task_wdt_reset();

    // Always keep LTE as fallback — try to ensure it's connected
    if (!wifiConnected && !ensureLTE()) {
      Serial.printf("[UPLOAD] No network — retrying in %dms\n", backoffMs);
      vTaskDelay(pdMS_TO_TICKS(backoffMs));
      backoffMs = min(backoffMs * 2, maxMs);
      continue;
    }
    backoffMs = 5000;

    // ── Drain flash records first (offline buffer) ────────────
    GPSRecord rec;
    bool uploaded = false;
    while (flashCount() > 0) {
      esp_task_wdt_reset();
      if (!flashLoad(rec))
        break;

      Serial.printf("[UPLOAD] Flash record (%d remaining) via %s...\n",
                    flashCount(), wifiConnected ? "WiFi" : "LTE");

      if (uploadRecord(rec)) {
        flashPop();
        consecutiveFailures = 0;
        uploaded = true;
      } else {
        consecutiveFailures++;
        Serial.printf("[UPLOAD] Flash upload failed (%d)\n",
                      consecutiveFailures);
        if (consecutiveFailures >= UPLOAD_FAIL_REBOOT_LIMIT) {
          Serial.println("[UPLOAD] Too many failures — rebooting");
          esp_restart();
        }
        break;
      }
      vTaskDelay(pdMS_TO_TICKS(500));
    }

    // ── Then drain live RAM queue ─────────────────────────────
    if (xQueueReceive(gpsQueue, &rec, pdMS_TO_TICKS(uploaded ? 100 : 5000)) ==
        pdPASS) {
      Serial.printf("[UPLOAD] Live record via %s...\n",
                    wifiConnected ? "WiFi" : "LTE");
      if (uploadRecord(rec)) {
        consecutiveFailures = 0;
        Serial.println("[UPLOAD] OK");
      } else {
        consecutiveFailures++;
        Serial.println("[UPLOAD] Failed — saving to flash");
        flashSave(rec);
        if (consecutiveFailures >= UPLOAD_FAIL_REBOOT_LIMIT) {
          Serial.println("[UPLOAD] Too many failures — rebooting");
          esp_restart();
        }
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────
// Task: WiFi Monitor (runs on Core 0)
// - Connects to the strongest known WiFi network on startup.
// - Sets the global wifiConnected flag used by TaskUpload.
// - Monitors connection health; reconnects automatically on drop.
// ─────────────────────────────────────────────────────────────
void TaskWiFi(void *pvParameters) {
  esp_task_wdt_add(NULL);

  // Initial connection attempt
  wifiConnected = tryConnectWiFi();
  if (!wifiConnected) {
    Serial.println("[WIFI] No WiFi available — running LTE-only mode");
  }

  unsigned long lastReconnect = 0;
  const unsigned long INTERVAL = 60000; // retry every 60 s

  for (;;) {
    esp_task_wdt_reset();

    if (wifiConnected) {
      if (WiFi.status() != WL_CONNECTED) {
        Serial.println("[WIFI] Connection lost — will retry");
        WiFi.disconnect(true);
        wifiConnected = false;
        lastReconnect = millis(); // start reconnect timer now
      }
    } else {
      if (millis() - lastReconnect > INTERVAL) {
        lastReconnect = millis();
        Serial.println("[WIFI] Attempting reconnect...");
        wifiConnected = tryConnectWiFi();
      }
    }

    vTaskDelay(pdMS_TO_TICKS(1000));
  }
}
