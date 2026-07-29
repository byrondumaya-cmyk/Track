// ╔══════════════════════════════════════════════════════════════╗
// ║  GarbageTrack GPS Firmware v1.2.0                           ║
// ║  Hardware: LILYGO T-Call A7670E (ESP32 + SIM7670 modem)     ║
// ║                                                              ║
// ║  Architecture:                                               ║
// ║  • Permanent WPA2-secured Service & Diagnostics AP           ║
// ║  • Two-layer portal auth (WPA2 + HTTP session login)         ║
// ║  • Async provisioning state machine (non-blocking)           ║
// ║  • Full /status JSON health API                              ║
// ║  • Integrated GNSS via A7670E modem                         ║
// ║  • Dual upload: WiFi (preferred) / LTE (fallback)           ║
// ║  • NVS offline flash queue (~50 min buffering)              ║
// ║  • FreeRTOS multi-task + hardware watchdog                  ║
// ╚══════════════════════════════════════════════════════════════╝

#include "config.h"
#include "secrets.h"
#include "system_state.h"

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

// Minimal TLS wrapper for TinyGSM (no cert pinning yet)
class TinyGsmClientSecure : public TinyGsmClient {
public:
  TinyGsmClientSecure(TinyGsm &modem) : TinyGsmClient(modem) {}
  void setInsecure() {}
  void setCACert(const char *) {}
  void setCertificate(const char *) {}
  void setPrivateKey(const char *) {}
};

// ─────────────────────────────────────────────────────────────
// Global Objects
// ─────────────────────────────────────────────────────────────
HardwareSerial SerialAT(1);
TinyGsm modem(SerialAT);
TinyGsmClientSecure lteSecureClient(modem);

Preferences prefs;     // GPS flash queue (NVS)
Preferences wifiPrefs; // WiFi credential cache (NVS)

WebServer diagServer(80); // Persistent diagnostics/portal server
DNSServer dnsServer;      // DNS redirect (captive portal probe catcher)

// ─────────────────────────────────────────────────────────────
// Shared Device State
// ─────────────────────────────────────────────────────────────
DeviceHealth g_health;
volatile bool g_wifiConnected = false;
volatile int g_consecutiveFailures = 0;
volatile uint32_t g_lastUploadMs = 0;
volatile uint32_t g_lastGpsFixMs = 0;

// Rolling in-memory event log
static String g_log[LOG_MAX_ENTRIES];
static int g_logHead = 0;
static int g_logCount = 0;
static SemaphoreHandle_t g_logMutex = nullptr;
static SemaphoreHandle_t g_healthMutex = nullptr;

// ─────────────────────────────────────────────────────────────
// Portal Session Management
// One active session at a time; 30-minute idle timeout.
// ─────────────────────────────────────────────────────────────
static String g_sessionToken = "";
static uint32_t g_sessionExpiry = 0;

static void generateSessionToken() {
  char buf[33];
  for (int i = 0; i < 32; i++) {
    buf[i] = "0123456789abcdef"[esp_random() & 0xF];
  }
  buf[32] = '\0';
  g_sessionToken = String(buf);
  g_sessionExpiry = millis() + PORTAL_SESSION_TIMEOUT_MS;
}

static bool sessionValid() {
  return g_sessionToken.length() > 0 && millis() < g_sessionExpiry;
}

static bool requestHasSession() {
  // Check Cookie header for session_token
  String cookie = diagServer.header("Cookie");
  if (cookie.length() == 0)
    return false;
  String needle = "session_token=" + g_sessionToken;
  return sessionValid() && cookie.indexOf(needle) >= 0;
}

static void refreshSession() {
  if (sessionValid()) {
    g_sessionExpiry = millis() + PORTAL_SESSION_TIMEOUT_MS;
  }
}

// ─────────────────────────────────────────────────────────────
// Event Log Helper
// ─────────────────────────────────────────────────────────────
static void logEvent(const char *fmt, ...) {
  char buf[128];
  va_list ap;
  va_start(ap, fmt);
  vsnprintf(buf, sizeof(buf), fmt, ap);
  va_end(ap);

  // Wall-clock label (uptime seconds)
  char entry[160];
  snprintf(entry, sizeof(entry), "[%lus] %s", (unsigned long)(millis() / 1000),
           buf);

  Serial.println(entry);

  if (xSemaphoreTake(g_logMutex, pdMS_TO_TICKS(50)) == pdTRUE) {
    g_log[g_logHead] = String(entry);
    g_logHead = (g_logHead + 1) % LOG_MAX_ENTRIES;
    if (g_logCount < LOG_MAX_ENTRIES)
      g_logCount++;
    xSemaphoreGive(g_logMutex);
  }
}

// ─────────────────────────────────────────────────────────────
// GPS Record Type
// ─────────────────────────────────────────────────────────────
struct GPSRecord {
  float lat, lon, speed_kmh, heading_deg, accuracy_m;
  int satellites, battery_pct;
  bool gps_fix;
  bool wifi_connected;
  int year, month, day, hour, min, sec;
};

QueueHandle_t gpsQueue;

// ─────────────────────────────────────────────────────────────
// Function Prototypes
// ─────────────────────────────────────────────────────────────
void TaskGPS(void *);
void TaskUpload(void *);
void TaskWiFi(void *);
void TaskLED(void *);
void TaskPortal(void *);

void modemPowerOn();
int readBatteryPct();
bool ensureLTE();
void buildTimestamp(const GPSRecord &r, char *buf, size_t len);

bool uploadViaWiFi(GPSRecord &r);
bool uploadViaLTE(GPSRecord &r);
bool uploadRecord(GPSRecord &r);

bool tryConnectWiFi();
void saveWiFiToNVS(const String &ssid, const String &pass);
int loadWiFiFromNVS(String ssids[], String passes[], int maxCount);
void fetchDeviceConfig();

void flashSave(const GPSRecord &r);
bool flashLoad(GPSRecord &out);
void flashPop();
int flashCount();

// Portal handlers
void setupDiagnosticServer();
void handleStatusAPI();
void handleLoginPage();
void handleLoginPost();
void handleDashboard();
void handleSetupPage();
void handleSetupPost();
void handleResetPost();
void handleRebootPost();
void handleNotFound();

// Internal
bool checkBackendHealth();
bool verifyDeviceAuth();
void advanceProvStateMachine();
String buildStatusJSON();

// ─────────────────────────────────────────────────────────────
// Portal HTML — stored in flash (PROGMEM)
// ─────────────────────────────────────────────────────────────

// Login page
static const char HTML_LOGIN[] PROGMEM = R"rawhtml(
<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>GarbageTrack — Login</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:system-ui,sans-serif;background:#0d1117;color:#e6edf3;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:16px}
.card{background:#161b22;border:1px solid #30363d;border-radius:12px;padding:28px 24px;width:100%;max-width:340px}
h1{font-size:17px;font-weight:700;color:#00d4aa;margin-bottom:4px}
.sub{font-size:12px;color:#8b949e;margin-bottom:20px}
label{display:block;font-size:11px;color:#8b949e;margin-bottom:4px;font-weight:600;letter-spacing:.05em;text-transform:uppercase}
input{width:100%;padding:9px 12px;background:#0d1117;border:1px solid #30363d;border-radius:8px;color:#e6edf3;font-size:13px;margin-bottom:14px;outline:none}
input:focus{border-color:#00d4aa}
button{width:100%;padding:10px;background:linear-gradient(135deg,#00d4aa,#00a87c);border:none;border-radius:8px;color:#001a14;font-weight:700;font-size:13px;cursor:pointer}
.err{color:#f85149;font-size:12px;margin-bottom:12px;padding:8px 10px;background:#ff000015;border-radius:6px;border:1px solid #f8514930}
</style></head><body>
<div class="card">
  <h1>🛰 GarbageTrack Service Portal</h1>
  <p class="sub">Administrator access required</p>
  %ERROR%
  <form method="POST" action="/login">
    <label>Username</label>
    <input type="text" name="user" autocomplete="username" required>
    <label>Password</label>
    <input type="password" name="pass" autocomplete="current-password" required>
    <button type="submit">Sign In</button>
  </form>
</div>
</body></html>
)rawhtml";

// Main diagnostics dashboard — polls /status every 3s
static const char HTML_DASHBOARD[] PROGMEM = R"rawhtml(
<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>GarbageTrack — Diagnostics</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:system-ui,sans-serif;background:#0d1117;color:#e6edf3;padding:16px;font-size:13px}
h1{color:#00d4aa;font-size:16px;margin-bottom:16px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:12px}
.card{background:#161b22;border:1px solid #30363d;border-radius:10px;padding:14px}
.card h2{font-size:11px;color:#8b949e;text-transform:uppercase;letter-spacing:.08em;margin-bottom:10px;font-weight:700}
.row{display:flex;justify-content:space-between;align-items:center;padding:4px 0;border-bottom:1px solid #21262d}
.row:last-child{border-bottom:none}
.lbl{color:#8b949e;font-size:12px}
.val{font-size:12px;font-weight:600;text-align:right;max-width:55%}
.ok{color:#3fb950}.warn{color:#d29922}.err{color:#f85149}.dim{color:#484f58}
.badge{display:inline-block;padding:2px 7px;border-radius:4px;font-size:10px;font-weight:700}
.badge-ok{background:#1a3a25;color:#3fb950}.badge-err{background:#3a1a1a;color:#f85149}
.badge-warn{background:#3a2f1a;color:#d29922}
.log{font-family:monospace;font-size:11px;color:#8b949e;white-space:pre-wrap;word-break:break-all;max-height:180px;overflow-y:auto;background:#0d1117;padding:8px;border-radius:6px;margin-top:6px}
.actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:16px}
.btn{padding:8px 14px;border-radius:7px;border:none;font-weight:700;font-size:12px;cursor:pointer}
.btn-setup{background:linear-gradient(135deg,#00d4aa,#00a87c);color:#001a14}
.btn-reboot{background:#1a1a2a;border:1px solid #30363d;color:#ccc}
.btn-logout{background:transparent;border:1px solid #30363d;color:#8b949e}
.status-bar{display:flex;align-items:center;gap:6px;margin-bottom:14px;font-size:12px;color:#8b949e}
.dot{width:8px;height:8px;border-radius:50%;background:#3fb950;animation:pulse 2s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
</style></head><body>
<div class="status-bar"><span class="dot" id="dot"></span><span id="ts">Loading...</span></div>
<h1>🛰 GarbageTrack Diagnostics</h1>
<div class="grid" id="grid">Loading device status...</div>
<div class="actions">
  <button class="btn btn-setup" onclick="location.href='/setup'">⚙ Configure Wi-Fi</button>
  <button class="btn btn-reboot" onclick="if(confirm('Reboot device?'))fetch('/reboot',{method:'POST'})">↺ Reboot</button>
  <button class="btn btn-logout" onclick="location.href='/logout'">Sign Out</button>
</div>
<script>
function badge(ok,yes,no){return`<span class="badge ${ok?'badge-ok':'badge-err'}">${ok?yes:no}</span>`}
function val(v,cls){return`<span class="val ${cls||''}">${v}</span>`}
function row(l,v){return`<div class="row"><span class="lbl">${l}</span>${v}</div>`}
function card(title,rows){return`<div class="card"><h2>${title}</h2>${rows}</div>`}
async function refresh(){
  try{
    const r=await fetch('/status');const d=await r.json();
    const ts=new Date().toLocaleTimeString();
    document.getElementById('ts').textContent='Last updated: '+ts;
    const n=d.network,p=d.provisioning,g=d.gps,pw=d.power,s=d.storage,c=d.communication,dv=d.device;
    document.getElementById('grid').innerHTML=
      card('Device',[
        row('Firmware',val(dv.fw_version)),
        row('Device ID',val(dv.id,'dim')),
        row('Uptime',val(dv.uptime_s+'s')),
        row('Free Heap',val(Math.round(dv.free_heap/1024)+'KB')),
      ].join(''))+
      card('Connection Status',[
        row('Provisioning',val(p.state,p.state==='SUCCESS'?'ok':p.state==='FAILED'?'err':'warn')),
        p.reason?row('Failure Reason',val(p.reason,'err')):'',
        row('Interface',val(n.active_iface||'NONE')),
        row('Internet',badge(n.internet,'✓ Verified','✗ Unreachable')),
        row('Backend',badge(n.backend_reachable,'✓ Reachable','✗ Unreachable')),
        row('Auth',badge(n.authenticated,'✓ Authenticated','✗ Failed')),
        row('Telemetry Ready',badge(n.telemetry_ready,'✓ Ready','✗ Not Ready')),
      ].join(''))+
      card('Wi-Fi',[
        row('Connected',badge(n.wifi.connected,'✓ Yes','✗ No')),
        n.wifi.connected?row('SSID',val(n.wifi.ssid)):'',
        n.wifi.connected?row('IP Address',val(n.wifi.ip)):'',
        n.wifi.connected?row('RSSI',val(n.wifi.rssi_dbm+' dBm',n.wifi.rssi_dbm>-70?'ok':n.wifi.rssi_dbm>-85?'warn':'err')):'',
      ].join(''))+
      card('GPS',[
        row('Fix',badge(g.fix,'✓ Fix Acquired','✗ No Fix')),
        row('Satellites',val(g.satellites)),
        g.fix?row('Position',val(g.lat.toFixed(5)+', '+g.lon.toFixed(5))):'',
        g.fix?row('Speed',val(g.speed_kmh.toFixed(1)+' km/h')):'',
        row('Last Fix',val(g.last_fix_ago_s<10?'Just now':g.last_fix_ago_s+'s ago')),
      ].join(''))+
      card('Power',[
        row('Battery',val(pw.battery_pct+'%',pw.battery_pct>50?'ok':pw.battery_pct>20?'warn':'err')),
        row('Voltage',val(pw.battery_v.toFixed(2)+'V')),
      ].join(''))+
      card('Storage',[
        row('NVS Buffer',val(s.nvs_buffered+' records',s.nvs_buffered>100?'warn':'')),
        row('Capacity',val(s.nvs_capacity+' records')),
      ].join(''))+
      card('Upload',[
        row('Last Upload',val(c.last_upload_ago_s+'s ago')),
        row('Failures (consec.)',val(c.consecutive_failures,c.consecutive_failures>3?'err':'')),
        row('Queue',val(c.queue_size+' records')),
      ].join(''))+
      card('Event Log','<div class="log">'+d.log.join('\n')+'</div>');
  }catch(e){document.getElementById('ts').textContent='Error: '+e.message;}
}
refresh();setInterval(refresh,3000);
</script>
</body></html>
)rawhtml";

// Wi-Fi setup form + live provisioning status — polls /status during connection
// attempt
static const char HTML_SETUP[] PROGMEM = R"rawhtml(
<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>GarbageTrack — Wi-Fi Setup</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:system-ui,sans-serif;background:#0d1117;color:#e6edf3;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:16px}
.card{background:#161b22;border:1px solid #30363d;border-radius:12px;padding:28px 24px;width:100%;max-width:380px}
h1{font-size:16px;font-weight:700;color:#00d4aa;margin-bottom:4px}
.sub{font-size:12px;color:#8b949e;margin-bottom:20px}
label{display:block;font-size:11px;color:#8b949e;margin-bottom:4px;font-weight:600;letter-spacing:.05em;text-transform:uppercase}
input{width:100%;padding:9px 12px;background:#0d1117;border:1px solid #30363d;border-radius:8px;color:#e6edf3;font-size:13px;margin-bottom:14px;outline:none}
input:focus{border-color:#00d4aa}
button{width:100%;padding:10px;background:linear-gradient(135deg,#00d4aa,#00a87c);border:none;border-radius:8px;color:#001a14;font-weight:700;font-size:13px;cursor:pointer;margin-top:4px}
.back{margin-top:10px;display:block;text-align:center;color:#8b949e;font-size:12px;text-decoration:none}
#status{display:none;margin-top:16px;padding:14px;background:#0d1117;border-radius:8px;border:1px solid #30363d}
.stage{display:flex;align-items:center;gap:8px;padding:6px 0;font-size:12px}
.stage-icon{width:18px;text-align:center}
.stage-lbl{flex:1}
.ok{color:#3fb950}.err{color:#f85149}.spin{animation:spin .8s linear infinite;display:inline-block}
@keyframes spin{to{transform:rotate(360deg)}}
#retry-btn{display:none;margin-top:12px;width:100%;padding:9px;border-radius:8px;background:transparent;border:1px solid #00d4aa;color:#00d4aa;font-weight:700;font-size:13px;cursor:pointer}
</style></head><body>
<div class="card">
  <h1>⚙ Wi-Fi Configuration</h1>
  <p class="sub">Enter credentials to connect to your network.</p>
  <form id="form">
    <label>Network Name (SSID)</label>
    <input type="text" id="ssid" name="ssid" placeholder="e.g. MyHomeWiFi" required autocomplete="off">
    <label>Password</label>
    <input type="password" id="pass" name="password" placeholder="Leave blank for open networks" autocomplete="off">
    <button type="submit" id="submitBtn">Connect & Verify</button>
  </form>
  <div id="status">
    <div class="stage" id="s1"><span class="stage-icon">○</span><span class="stage-lbl">Connecting to Wi-Fi...</span></div>
    <div class="stage" id="s2"><span class="stage-icon">○</span><span class="stage-lbl">Obtaining IP address...</span></div>
    <div class="stage" id="s3"><span class="stage-icon">○</span><span class="stage-lbl">Verifying internet access...</span></div>
    <div class="stage" id="s4"><span class="stage-icon">○</span><span class="stage-lbl">Reaching backend...</span></div>
    <div class="stage" id="s5"><span class="stage-icon">○</span><span class="stage-lbl">Authenticating device...</span></div>
    <div class="stage" id="s6"><span class="stage-icon">○</span><span class="stage-lbl">Ready for telemetry upload</span></div>
    <button id="retry-btn" onclick="reset()">← Try Different Credentials</button>
  </div>
  <a href="/" class="back">← Back to Dashboard</a>
</div>
<script>
const stageMap={CONNECTING:'s1',DHCP_WAIT:'s2',INTERNET_CHECK:'s3',AUTH_CHECK:['s3','s4'],SUCCESS:'s6',FAILED:'err'};
let polling=null;
function setStage(id,icon,cls){const el=document.getElementById(id);if(!el)return;el.querySelector('.stage-icon').innerHTML=icon;el.querySelector('.stage-lbl').className='stage-lbl '+(cls||'')}
function reset(){fetch('/reset',{method:'POST'});clearInterval(polling);document.getElementById('status').style.display='none';document.getElementById('form').style.display='block';document.getElementById('submitBtn').disabled=false;document.getElementById('retry-btn').style.display='none';}
async function poll(){
  const r=await fetch('/status');const d=await r.json();
  const p=d.provisioning,n=d.network;
  ['s1','s2','s3','s4','s5','s6'].forEach(id=>setStage(id,'○',''));
  if(p.state==='CONNECTING'){setStage('s1','<span class="spin">↻</span>','')}
  if(p.state==='DHCP_WAIT'){setStage('s1','✓','ok');setStage('s2','<span class="spin">↻</span>','')}
  if(p.state==='INTERNET_CHECK'){setStage('s1','✓','ok');setStage('s2','✓','ok');setStage('s3','<span class="spin">↻</span>','')}
  if(p.state==='AUTH_CHECK'){setStage('s1','✓','ok');setStage('s2','✓','ok');setStage('s3','✓','ok');setStage('s4','<span class="spin">↻</span>','')}
  if(p.state==='SUCCESS'){
    ['s1','s2','s3','s4','s5','s6'].forEach(id=>setStage(id,'✓','ok'));
    clearInterval(polling);
    setStage('s6','✓ '+n.wifi.ip,'ok');
  }
  if(p.state==='FAILED'){
    clearInterval(polling);
    const failedStage={WRONG_PASSWORD:'s1',SSID_NOT_FOUND:'s1',DHCP_TIMEOUT:'s2',INTERNET_UNREACHABLE:'s3',BACKEND_UNREACHABLE:'s4',AUTH_FAILED:'s5'}[p.reason]||'s1';
    setStage(failedStage,'✗ '+(p.reason||'Error'),'err');
    document.getElementById('retry-btn').style.display='block';
  }
}
document.getElementById('form').addEventListener('submit',async e=>{
  e.preventDefault();
  document.getElementById('submitBtn').disabled=true;
  document.getElementById('form').style.display='block';
  document.getElementById('status').style.display='block';
  const body=new URLSearchParams({ssid:document.getElementById('ssid').value,password:document.getElementById('pass').value});
  await fetch('/setup',{method:'POST',body});
  setStage('s1','<span class="spin">↻</span>','');
  polling=setInterval(poll,1200);
});
</script>
</body></html>
)rawhtml";

// ─────────────────────────────────────────────────────────────
// Hardware Utilities
// ─────────────────────────────────────────────────────────────
void modemPowerOn() {
  pinMode(MODEM_PWRKEY, OUTPUT);
  digitalWrite(MODEM_PWRKEY, LOW);
  delay(100);
  digitalWrite(MODEM_PWRKEY, HIGH);
  delay(1000);
  digitalWrite(MODEM_PWRKEY, LOW);
  logEvent("Modem power-on complete");
}

int readBatteryPct() {
  int raw = analogRead(BAT_ADC);
  float volt = (raw / 4095.0f) * 3.3f * 2.0f;
  g_health.battery_v = volt;
  int pct = (int)((volt - 3.2f) / (4.2f - 3.2f) * 100.0f);
  return constrain(pct, 0, 100);
}

void buildTimestamp(const GPSRecord &r, char *buf, size_t len) {
  if (r.year < 2000 || r.month == 0 || r.day == 0) {
    snprintf(buf, len, "1970-01-01T00:00:00Z");
  } else {
    snprintf(buf, len, "%04d-%02d-%02dT%02d:%02d:%02dZ", r.year, r.month, r.day,
             r.hour, r.min, r.sec);
  }
}

// ─────────────────────────────────────────────────────────────
// LTE: ensure modem registered and GPRS active
// ─────────────────────────────────────────────────────────────
bool ensureLTE() {
  if (!modem.isNetworkConnected()) {
    logEvent("LTE: Waiting for network...");
    if (!modem.waitForNetwork(LTE_CONNECT_TIMEOUT_MS, true)) {
      logEvent("LTE: Network timeout");
      return false;
    }
  }
  if (!modem.isGprsConnected()) {
    logEvent("LTE: Connecting GPRS...");
    if (!modem.gprsConnect(APN, "", "")) {
      logEvent("LTE: GPRS connect failed");
      return false;
    }
  }
  return true;
}

// ─────────────────────────────────────────────────────────────
// WiFi: NVS credential management
// ─────────────────────────────────────────────────────────────
void saveWiFiToNVS(const String &ssid, const String &pass) {
  String ssids[WIFI_MAX_NETWORKS], passes[WIFI_MAX_NETWORKS];
  int count = loadWiFiFromNVS(ssids, passes, WIFI_MAX_NETWORKS);

  for (int i = 0; i < count; i++) {
    if (ssids[i] == ssid) {
      passes[i] = pass;
      wifiPrefs.putInt("count", count);
      for (int j = 0; j < count; j++) {
        char sk[12], pk[12];
        snprintf(sk, sizeof(sk), "s%d", j);
        snprintf(pk, sizeof(pk), "p%d", j);
        wifiPrefs.putString(sk, ssids[j]);
        wifiPrefs.putString(pk, passes[j]);
      }
      logEvent("WiFi: Updated NVS for %s", ssid.c_str());
      return;
    }
  }

  if (count < WIFI_MAX_NETWORKS) {
    char sk[12], pk[12];
    snprintf(sk, sizeof(sk), "s%d", count);
    snprintf(pk, sizeof(pk), "p%d", count);
    wifiPrefs.putString(sk, ssid);
    wifiPrefs.putString(pk, pass);
    wifiPrefs.putInt("count", count + 1);
    logEvent("WiFi: NVS saved %s (total: %d)", ssid.c_str(), count + 1);
  } else {
    // Shift LRU
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

bool tryConnectWiFi() {
  String ssids[WIFI_MAX_NETWORKS], passes[WIFI_MAX_NETWORKS];
  int storedCount = loadWiFiFromNVS(ssids, passes, WIFI_MAX_NETWORKS);

  if (storedCount == 0) {
    logEvent("WiFi: No stored networks");
    return false;
  }

  logEvent("WiFi: Scanning... (%d known networks)", storedCount);
  int found = WiFi.scanNetworks();
  if (found <= 0) {
    logEvent("WiFi: No networks found");
    return false;
  }

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
    logEvent("WiFi: No known networks visible");
    return false;
  }

  logEvent("WiFi: Connecting to %s (RSSI %d)", ssids[bestIdx].c_str(),
           bestRSSI);
  WiFi.begin(ssids[bestIdx].c_str(), passes[bestIdx].c_str());

  unsigned long deadline = millis() + WIFI_CONNECT_TIMEOUT_MS;
  while (WiFi.status() != WL_CONNECTED && millis() < deadline)
    delay(250);

  if (WiFi.status() == WL_CONNECTED) {
    logEvent("WiFi: Connected! IP %s", WiFi.localIP().toString().c_str());
    g_health.wifi_ssid = ssids[bestIdx];
    g_health.wifi_ip = WiFi.localIP().toString();
    g_health.wifi_gateway = WiFi.gatewayIP().toString();
    g_health.wifi_rssi = WiFi.RSSI();
    return true;
  }

  logEvent("WiFi: Connection failed");
  WiFi.disconnect();
  return false;
}

void fetchDeviceConfig() {
  logEvent("CFG: Fetching device config via LTE...");
  modem.restart();
  delay(3000);

  lteSecureClient.setInsecure();
  if (!ensureLTE()) {
    logEvent("CFG: LTE unavailable — using cached WiFi list");
    return;
  }
  if (!lteSecureClient.connect(SUPABASE_HOST, 443)) {
    logEvent("CFG: TCP connect failed");
    return;
  }

  lteSecureClient.println("GET /functions/v1/device-config HTTP/1.1");
  lteSecureClient.println("Host: " + String(SUPABASE_HOST));
  lteSecureClient.println("X-Device-ID: " DEVICE_ID);
  lteSecureClient.println("X-API-Key: " DEVICE_API_KEY);
  lteSecureClient.println("Connection: close");
  lteSecureClient.println();

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
      if (inBody)
        body += line;
    }
  }
  lteSecureClient.stop();

  if (body.isEmpty()) {
    logEvent("CFG: Empty response");
    return;
  }

  JsonDocument doc;
  if (deserializeJson(doc, body) != DeserializationError::Ok) {
    logEvent("CFG: JSON parse failed");
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
  logEvent("CFG: Merged %d WiFi networks from cloud", merged);
}

// ─────────────────────────────────────────────────────────────
// Backend Health & Auth Verification
// ─────────────────────────────────────────────────────────────
bool checkBackendHealth() {
  if (WiFi.status() != WL_CONNECTED)
    return false;

  WiFiClientSecure wc;
  wc.setInsecure();
  HTTPClient http;
  String url = String("https://") + SUPABASE_HOST + BACKEND_HEALTH_PATH;
  http.begin(wc, url);
  http.addHeader("Authorization", String("Bearer ") + SUPABASE_ANON_KEY);
  http.addHeader("apikey", SUPABASE_ANON_KEY);
  http.setTimeout(PROV_INTERNET_TIMEOUT_MS);
  int code = http.GET();
  http.end();
  logEvent("Backend health: HTTP %d", code);
  return (code == 200);
}

bool verifyDeviceAuth() {
  if (WiFi.status() != WL_CONNECTED)
    return false;

  WiFiClientSecure wc;
  wc.setInsecure();
  HTTPClient http;
  String url = String("https://") + SUPABASE_HOST + "/functions/v1/ingest";
  http.begin(wc, url);
  http.addHeader("Authorization", String("Bearer ") + SUPABASE_ANON_KEY);
  http.addHeader("apikey", SUPABASE_ANON_KEY);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-Device-ID", DEVICE_ID);
  http.addHeader("X-API-Key", DEVICE_API_KEY);
  // Send empty array — ingest returns 400 "No records" when auth passes
  int code = http.POST("[]");
  http.end();
  logEvent("Auth check: HTTP %d", code);
  // 200/201 = ok with data; 400 = auth passed but empty payload
  return (code == 200 || code == 201 || code == 400);
}

// ─────────────────────────────────────────────────────────────
// Provisioning State Machine
// Called from TaskPortal loop — non-blocking; advances one step per call.
// ─────────────────────────────────────────────────────────────
static String g_pendingSSID = "";
static String g_pendingPass = "";
static unsigned long g_provStateEnteredMs = 0;

void advanceProvStateMachine() {
  ProvState cur = g_health.prov_state;

  switch (cur) {
  case PROV_IDLE:
    // Nothing to advance — waiting for POST /setup
    break;

  case PROV_CONNECTING: {
    wl_status_t ws = WiFi.status();
    unsigned long elapsed = millis() - g_provStateEnteredMs;

    if (ws == WL_CONNECTED) {
      logEvent("Prov: STA connected to %s", g_pendingSSID.c_str());
      g_health.prov_state = PROV_DHCP_WAIT;
      g_provStateEnteredMs = millis();
    } else if (ws == WL_CONNECT_FAILED || ws == WL_NO_SSID_AVAIL) {
      g_health.fail_reason =
          (ws == WL_NO_SSID_AVAIL) ? FAIL_SSID_NOT_FOUND : FAIL_WRONG_PASSWORD;
      g_health.prov_state = PROV_FAILED;
      logEvent("Prov: FAILED — %s", failReasonLabel(g_health.fail_reason));
      WiFi.disconnect();
    } else if (elapsed > WIFI_CONNECT_TIMEOUT_MS + 5000) {
      g_health.fail_reason = FAIL_TIMEOUT;
      g_health.prov_state = PROV_FAILED;
      logEvent("Prov: FAILED — timeout");
      WiFi.disconnect();
    }
    break;
  }

  case PROV_DHCP_WAIT: {
    IPAddress ip = WiFi.localIP();
    if (ip != IPAddress(0, 0, 0, 0)) {
      g_health.wifi_ip = ip.toString();
      g_health.wifi_gateway = WiFi.gatewayIP().toString();
      g_health.wifi_rssi = WiFi.RSSI();
      logEvent("Prov: IP obtained %s", g_health.wifi_ip.c_str());
      g_health.prov_state = PROV_INTERNET_CHECK;
      g_provStateEnteredMs = millis();
    } else if (millis() - g_provStateEnteredMs > 10000) {
      g_health.fail_reason = FAIL_DHCP_TIMEOUT;
      g_health.prov_state = PROV_FAILED;
      logEvent("Prov: FAILED — DHCP timeout");
    }
    break;
  }

  case PROV_INTERNET_CHECK: {
    bool ok = checkBackendHealth();
    if (ok) {
      g_health.internet_ok = true;
      g_health.backend_reachable = true;
      g_health.prov_state = PROV_AUTH_CHECK;
      g_provStateEnteredMs = millis();
      logEvent("Prov: Backend reachable");
    } else {
      g_health.fail_reason = FAIL_BACKEND_UNREACHABLE;
      g_health.prov_state = PROV_FAILED;
      logEvent("Prov: FAILED — backend unreachable");
    }
    break;
  }

  case PROV_AUTH_CHECK: {
    bool ok = verifyDeviceAuth();
    if (ok) {
      g_health.authenticated = true;
      g_health.telemetry_ready = true;
      g_health.wifi_ssid = g_pendingSSID;
      g_health.wifi_connected = true;
      g_health.active_iface = IFACE_WIFI;

      saveWiFiToNVS(g_pendingSSID, g_pendingPass);
      g_health.prov_state = PROV_SUCCESS;
      g_wifiConnected = true;
      logEvent("Prov: SUCCESS — device authenticated, telemetry ready");
    } else {
      g_health.fail_reason = FAIL_AUTH_FAILED;
      g_health.prov_state = PROV_FAILED;
      logEvent("Prov: FAILED — authentication rejected");
      WiFi.disconnect();
    }
    break;
  }

  case PROV_SUCCESS:
  case PROV_FAILED:
    // Terminal states — portal handles retry (FAILED) or normal operation
    // (SUCCESS)
    break;
  }
}

// ─────────────────────────────────────────────────────────────
// /status JSON builder
// ─────────────────────────────────────────────────────────────
String buildStatusJSON() {
  JsonDocument doc;

  // Device
  auto dv = doc["device"].to<JsonObject>();
  dv["id"] = DEVICE_ID;
  dv["fw_version"] = FW_VERSION;
  dv["uptime_s"] = millis() / 1000;
  dv["free_heap"] = ESP.getFreeHeap();
  dv["cpu_freq_mhz"] = ESP.getCpuFreqMHz();

  // Provisioning
  auto pv = doc["provisioning"].to<JsonObject>();
  pv["state"] = provStateLabel(g_health.prov_state);
  if (g_health.fail_reason != FAIL_NONE)
    pv["reason"] = failReasonLabel(g_health.fail_reason);
  else
    pv["reason"] = nullptr;

  // Network
  auto nw = doc["network"].to<JsonObject>();
  nw["active_iface"] = ifaceLabel(g_health.active_iface);
  nw["internet"] = g_health.internet_ok;
  nw["backend_reachable"] = g_health.backend_reachable;
  nw["authenticated"] = g_health.authenticated;
  nw["telemetry_ready"] = g_health.telemetry_ready;

  auto wf = nw["wifi"].to<JsonObject>();
  wf["connected"] = g_health.wifi_connected;
  wf["ssid"] = g_health.wifi_ssid;
  wf["ip"] = g_health.wifi_ip;
  wf["gateway"] = g_health.wifi_gateway;
  wf["rssi_dbm"] = g_health.wifi_rssi;

  auto lt = nw["lte"].to<JsonObject>();
  lt["registered"] = g_health.lte_registered;
  lt["operator"] = g_health.lte_operator;
  lt["sim_present"] = g_health.sim_present;

  // GPS
  auto gp = doc["gps"].to<JsonObject>();
  gp["fix"] = g_health.gps_fix;
  gp["satellites"] = g_health.gps_satellites;
  gp["lat"] = g_health.gps_lat;
  gp["lon"] = g_health.gps_lon;
  gp["speed_kmh"] = g_health.gps_speed_kmh;
  gp["accuracy_m"] = g_health.gps_accuracy_m;
  gp["last_fix_ago_s"] =
      g_lastGpsFixMs > 0 ? (millis() - g_lastGpsFixMs) / 1000 : 0;

  // Power
  doc["power"]["battery_pct"] = g_health.battery_pct;
  doc["power"]["battery_v"] = g_health.battery_v;

  // Storage
  doc["storage"]["nvs_buffered"] = flashCount();
  doc["storage"]["nvs_capacity"] = FLASH_MAX_RECORDS;

  // Communication
  auto cm = doc["communication"].to<JsonObject>();
  cm["last_upload_ago_s"] =
      g_lastUploadMs > 0 ? (millis() - g_lastUploadMs) / 1000 : 0;
  cm["consecutive_failures"] = g_consecutiveFailures;
  cm["queue_size"] = uxQueueMessagesWaiting(gpsQueue);

  // Rolling log
  auto log = doc["log"].to<JsonArray>();
  if (xSemaphoreTake(g_logMutex, pdMS_TO_TICKS(50)) == pdTRUE) {
    int start =
        (g_logCount >= LOG_MAX_ENTRIES)
            ? g_logHead
            : (g_logHead - g_logCount + LOG_MAX_ENTRIES) % LOG_MAX_ENTRIES;
    for (int i = 0; i < g_logCount; i++) {
      log.add(g_log[(start + i) % LOG_MAX_ENTRIES]);
    }
    xSemaphoreGive(g_logMutex);
  }

  String out;
  serializeJson(doc, out);
  return out;
}

// ─────────────────────────────────────────────────────────────
// Diagnostics Portal HTTP Handlers
// ─────────────────────────────────────────────────────────────
void handleStatusAPI() {
  // Public — no auth required (read-only telemetry)
  diagServer.send(200, "application/json", buildStatusJSON());
}

void handleLoginPage() {
  if (sessionValid() && requestHasSession()) {
    diagServer.sendHeader("Location", "/", true);
    diagServer.send(302, "text/plain", "");
    return;
  }
  String html = String(FPSTR(HTML_LOGIN));
  html.replace("%ERROR%", "");
  diagServer.send(200, "text/html", html);
}

void handleLoginPost() {
  String user = diagServer.arg("user");
  String pass = diagServer.arg("pass");

  if (user == PORTAL_USER && pass == PORTAL_PASS) {
    generateSessionToken();
    diagServer.sendHeader("Set-Cookie",
                          "session_token=" + g_sessionToken +
                              "; Path=/; HttpOnly; SameSite=Strict");
    diagServer.sendHeader("Location", "/", true);
    diagServer.send(302, "text/plain", "");
    logEvent("Portal: Admin logged in");
  } else {
    String html = String(FPSTR(HTML_LOGIN));
    html.replace("%ERROR%",
                 "<div class=\"err\">Invalid username or password</div>");
    diagServer.send(401, "text/html", html);
    logEvent("Portal: Failed login attempt");
  }
}

void handleLogout() {
  g_sessionToken = "";
  g_sessionExpiry = 0;
  diagServer.sendHeader("Set-Cookie", "session_token=; Path=/; Max-Age=0");
  diagServer.sendHeader("Location", "/login", true);
  diagServer.send(302, "text/plain", "");
}

void handleDashboard() {
  if (!requestHasSession()) {
    diagServer.sendHeader("Location", "/login", true);
    diagServer.send(302, "text/plain", "");
    return;
  }
  refreshSession();
  diagServer.send(200, "text/html", String(FPSTR(HTML_DASHBOARD)));
}

void handleSetupPage() {
  if (!requestHasSession()) {
    diagServer.sendHeader("Location", "/login", true);
    diagServer.send(302, "text/plain", "");
    return;
  }
  refreshSession();
  diagServer.send(200, "text/html", String(FPSTR(HTML_SETUP)));
}

void handleSetupPost() {
  if (!requestHasSession()) {
    diagServer.send(403, "application/json", "{\"error\":\"Unauthorized\"}");
    return;
  }
  refreshSession();

  String newSSID = diagServer.arg("ssid");
  String newPass = diagServer.arg("password");

  if (newSSID.length() == 0) {
    diagServer.send(400, "application/json", "{\"error\":\"SSID required\"}");
    return;
  }

  // Store pending credentials and kick off state machine
  g_pendingSSID = newSSID;
  g_pendingPass = newPass;
  g_health.prov_target_ssid = newSSID;
  g_health.fail_reason = FAIL_NONE;
  g_health.internet_ok = false;
  g_health.backend_reachable = false;
  g_health.authenticated = false;

  // Begin connection — AP stays active (WIFI_AP_STA mode already set)
  WiFi.begin(newSSID.c_str(), newPass.c_str());
  g_health.prov_state = PROV_CONNECTING;
  g_provStateEnteredMs = millis();

  logEvent("Prov: Attempting connection to %s", newSSID.c_str());
  diagServer.send(202, "application/json", "{\"status\":\"connecting\"}");
}

void handleResetPost() {
  if (!requestHasSession()) {
    diagServer.send(403, "application/json", "{\"error\":\"Unauthorized\"}");
    return;
  }
  WiFi.disconnect();
  g_health.prov_state = PROV_IDLE;
  g_health.fail_reason = FAIL_NONE;
  g_health.internet_ok = false;
  g_health.backend_reachable = false;
  g_health.authenticated = false;
  g_pendingSSID = "";
  g_pendingPass = "";
  logEvent("Prov: Reset to IDLE by portal");
  diagServer.send(200, "application/json", "{\"status\":\"reset\"}");
}

void handleRebootPost() {
  if (!requestHasSession()) {
    diagServer.send(403, "application/json", "{\"error\":\"Unauthorized\"}");
    return;
  }
  diagServer.send(200, "application/json", "{\"status\":\"rebooting\"}");
  logEvent("Portal: Reboot requested by admin");
  delay(500);
  esp_restart();
}

void handleNotFound() {
  // Captive portal probe catcher: redirect all unknown requests to the portal
  diagServer.sendHeader("Location", "http://" DIAG_AP_IP "/login", true);
  diagServer.send(302, "text/plain", "");
}

// ─────────────────────────────────────────────────────────────
// Diagnostics Server Initialiser
// ─────────────────────────────────────────────────────────────
void setupDiagnosticServer() {
  // Collect Cookie header for session validation
  const char *headers[] = {"Cookie"};
  diagServer.collectHeaders(headers, 1);

  diagServer.on("/", HTTP_GET, handleDashboard);
  diagServer.on("/login", HTTP_GET, handleLoginPage);
  diagServer.on("/login", HTTP_POST, handleLoginPost);
  diagServer.on("/logout", HTTP_GET, handleLogout);
  diagServer.on("/setup", HTTP_GET, handleSetupPage);
  diagServer.on("/setup", HTTP_POST, handleSetupPost);
  diagServer.on("/status", HTTP_GET, handleStatusAPI);
  diagServer.on("/reset", HTTP_POST, handleResetPost);
  diagServer.on("/reboot", HTTP_POST, handleRebootPost);
  diagServer.onNotFound(handleNotFound);

  diagServer.begin();
  logEvent("Diag portal live at http://" DIAG_AP_IP);
}

// ─────────────────────────────────────────────────────────────
// Upload: build JSON payload
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
  obj["hdop"] = r.accuracy_m;
  obj["satellites"] = r.satellites;
  obj["battery_pct"] = r.battery_pct;
  obj["gps_fix"] = r.gps_fix;
  obj["wifi_connected"] = r.wifi_connected;

  String payload;
  serializeJson(doc, payload);
  return payload;
}

bool uploadViaWiFi(GPSRecord &r) {
  if (WiFi.status() != WL_CONNECTED)
    return false;
  r.wifi_connected = true;
  String payload = buildPayload(r);

  WiFiClientSecure wc;
  wc.setInsecure();
  HTTPClient http;
  String url = String("https://") + SUPABASE_HOST + "/functions/v1/ingest";
  http.begin(wc, url);
  http.addHeader("Authorization", String("Bearer ") + SUPABASE_ANON_KEY);
  http.addHeader("apikey", SUPABASE_ANON_KEY);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-Device-ID", DEVICE_ID);
  http.addHeader("X-API-Key", DEVICE_API_KEY);
  int code = http.POST(payload);
  http.end();

  logEvent("Upload WiFi: HTTP %d", code);
  return (code == 200 || code == 201);
}

bool uploadViaLTE(GPSRecord &r) {
  r.wifi_connected = false;
  String payload = buildPayload(r);

  if (!lteSecureClient.connect(SUPABASE_HOST, 443)) {
    logEvent("Upload LTE: TCP connect failed");
    return false;
  }

  lteSecureClient.println("POST /functions/v1/ingest HTTP/1.1");
  lteSecureClient.println("Host: " + String(SUPABASE_HOST));
  lteSecureClient.println("Content-Type: application/json");
  lteSecureClient.println("Authorization: Bearer " SUPABASE_ANON_KEY);
  lteSecureClient.println("apikey: " SUPABASE_ANON_KEY);
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
  logEvent("Upload LTE: %s", status.c_str());
  return status.indexOf("200") >= 0 || status.indexOf("201") >= 0;
}

bool uploadRecord(GPSRecord &r) {
  if (g_wifiConnected) {
    if (uploadViaWiFi(r))
      return true;
    logEvent("Upload: WiFi failed — falling back to LTE");
  }
  return uploadViaLTE(r);
}

// ─────────────────────────────────────────────────────────────
// Flash Queue — NVS-backed persistent ring buffer
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
}

bool flashLoad(GPSRecord &out) {
  if (prefs.getInt(FLASH_KEY_COUNT, 0) == 0)
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
// Task: LED State Machine
// Reads g_health.prov_state and g_wifiConnected.
// Runs on Core 0 with low priority.
// ─────────────────────────────────────────────────────────────
void TaskLED(void *pvParameters) {
  pinMode(LED_PIN, OUTPUT);
  digitalWrite(LED_PIN, LOW);

  for (;;) {
    ProvState ps = g_health.prov_state;

    if (ps == PROV_IDLE) {
      // Slow blink: 2s ON / 2s OFF — waiting for credentials
      digitalWrite(LED_PIN, HIGH);
      vTaskDelay(pdMS_TO_TICKS(2000));
      digitalWrite(LED_PIN, LOW);
      vTaskDelay(pdMS_TO_TICKS(2000));

    } else if (ps == PROV_CONNECTING || ps == PROV_DHCP_WAIT ||
               ps == PROV_INTERNET_CHECK || ps == PROV_AUTH_CHECK) {
      // Fast blink: 200ms — connecting
      digitalWrite(LED_PIN, !digitalRead(LED_PIN));
      vTaskDelay(pdMS_TO_TICKS(200));

    } else if (ps == PROV_FAILED) {
      // Triple blink, 2s pause — error
      for (int i = 0; i < 3; i++) {
        digitalWrite(LED_PIN, HIGH);
        vTaskDelay(pdMS_TO_TICKS(150));
        digitalWrite(LED_PIN, LOW);
        vTaskDelay(pdMS_TO_TICKS(150));
      }
      vTaskDelay(pdMS_TO_TICKS(2000));

    } else {
      // PROV_SUCCESS — Solid ON when tracking normally
      if (g_consecutiveFailures > 3) {
        // Double blink: upload errors
        for (int i = 0; i < 2; i++) {
          digitalWrite(LED_PIN, HIGH);
          vTaskDelay(pdMS_TO_TICKS(120));
          digitalWrite(LED_PIN, LOW);
          vTaskDelay(pdMS_TO_TICKS(120));
        }
        vTaskDelay(pdMS_TO_TICKS(1500));
      } else {
        digitalWrite(LED_PIN, HIGH);
        vTaskDelay(pdMS_TO_TICKS(1000));
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────
// Task: Portal & Provisioning State Machine
// Runs on Core 0 — handles DNS, HTTP, and state transitions.
// ─────────────────────────────────────────────────────────────
void TaskPortal(void *pvParameters) {
  esp_task_wdt_add(NULL);

  for (;;) {
    esp_task_wdt_reset();
    dnsServer.processNextRequest();
    diagServer.handleClient();
    advanceProvStateMachine();
    vTaskDelay(pdMS_TO_TICKS(10));
  }
}

// ─────────────────────────────────────────────────────────────
// Task: GPS Manager (Core 1)
// ─────────────────────────────────────────────────────────────
void TaskGPS(void *pvParameters) {
  esp_task_wdt_add(NULL);
  vTaskDelay(pdMS_TO_TICKS(8000)); // Let modem fully initialize

  logEvent("GPS: Enabling integrated GNSS...");
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
      rec.heading_deg = 0;
      rec.accuracy_m = acc;
      rec.satellites = usat;
      rec.battery_pct = readBatteryPct();
      rec.gps_fix = fix && (lat != 0.0f) && (lon != 0.0f);

      // Update shared health state
      g_health.gps_fix = rec.gps_fix;
      g_health.gps_satellites = usat;
      g_health.gps_lat = lat;
      g_health.gps_lon = lon;
      g_health.gps_speed_kmh = speed;
      g_health.gps_accuracy_m = acc;
      g_health.battery_pct = rec.battery_pct;

      if (rec.gps_fix) {
        g_lastGpsFixMs = millis();
        logEvent("GPS: Fix %.5f,%.5f %.1fkm/h bat:%d%% sats:%d", lat, lon,
                 speed, rec.battery_pct, usat);
      }

      if (xQueueSend(gpsQueue, &rec, 0) != pdPASS) {
        logEvent("GPS: RAM queue full — saving to flash");
        flashSave(rec);
      }
      lastPoll = xTaskGetTickCount();
    }
    vTaskDelay(pdMS_TO_TICKS(1000));
  }
}

// ─────────────────────────────────────────────────────────────
// Task: Upload Manager (Core 1)
// ─────────────────────────────────────────────────────────────
void TaskUpload(void *pvParameters) {
  esp_task_wdt_add(NULL);
  lteSecureClient.setInsecure();

  // Fetch device configuration once at boot
  fetchDeviceConfig();

  int backoffMs = 5000;
  const int maxMs = 120000;

  for (;;) {
    esp_task_wdt_reset();

    if (!g_wifiConnected && !ensureLTE()) {
      logEvent("Upload: No network — retry in %ds", backoffMs / 1000);
      vTaskDelay(pdMS_TO_TICKS(backoffMs));
      backoffMs = min(backoffMs * 2, maxMs);
      continue;
    }
    backoffMs = 5000;

    // Drain flash buffer first
    GPSRecord rec;
    bool uploaded = false;
    while (flashCount() > 0) {
      esp_task_wdt_reset();
      if (!flashLoad(rec))
        break;
      logEvent("Upload: Flash record (%d remaining) via %s", flashCount(),
               g_wifiConnected ? "WiFi" : "LTE");
      if (uploadRecord(rec)) {
        flashPop();
        g_consecutiveFailures = 0;
        g_lastUploadMs = millis();
        uploaded = true;
      } else {
        g_consecutiveFailures++;
        if (g_consecutiveFailures >= UPLOAD_FAIL_REBOOT_LIMIT) {
          logEvent("Upload: %d consecutive failures — rebooting",
                   UPLOAD_FAIL_REBOOT_LIMIT);
          esp_restart();
        }
        break;
      }
      vTaskDelay(pdMS_TO_TICKS(500));
    }

    // Drain live queue
    if (xQueueReceive(gpsQueue, &rec, pdMS_TO_TICKS(uploaded ? 100 : 5000)) ==
        pdPASS) {
      if (uploadRecord(rec)) {
        g_consecutiveFailures = 0;
        g_lastUploadMs = millis();
      } else {
        g_consecutiveFailures++;
        logEvent("Upload: Failed — saving to flash");
        flashSave(rec);
        if (g_consecutiveFailures >= UPLOAD_FAIL_REBOOT_LIMIT) {
          logEvent("Upload: %d consecutive failures — rebooting",
                   UPLOAD_FAIL_REBOOT_LIMIT);
          esp_restart();
        }
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────
// Task: WiFi Monitor (Core 0)
// ─────────────────────────────────────────────────────────────
void TaskWiFi(void *pvParameters) {
  esp_task_wdt_add(NULL);

  g_wifiConnected = tryConnectWiFi();
  if (g_wifiConnected) {
    g_health.wifi_connected = true;
    g_health.active_iface = IFACE_WIFI;
    // Run backend/auth checks if WiFi connected at boot
    if (g_health.prov_state == PROV_IDLE) {
      g_health.prov_state = PROV_INTERNET_CHECK;
    }
  } else {
    logEvent("WiFi: No WiFi — running LTE-only mode");
  }

  unsigned long lastReconnect = 0;

  for (;;) {
    esp_task_wdt_reset();

    if (g_wifiConnected) {
      if (WiFi.status() != WL_CONNECTED) {
        logEvent("WiFi: Connection lost — will retry");
        WiFi.disconnect();
        g_wifiConnected = false;
        g_health.wifi_connected = false;
        g_health.active_iface = IFACE_NONE;
        lastReconnect = millis();
      } else {
        // Keep health state updated
        g_health.wifi_rssi = WiFi.RSSI();
      }
    } else {
      if (millis() - lastReconnect > WIFI_RECONNECT_INTERVAL_MS) {
        lastReconnect = millis();
        logEvent("WiFi: Attempting reconnect...");
        g_wifiConnected = tryConnectWiFi();
        if (g_wifiConnected) {
          g_health.wifi_connected = true;
          g_health.active_iface = IFACE_WIFI;
        }
      }
    }
    vTaskDelay(pdMS_TO_TICKS(1000));
  }
}

// ─────────────────────────────────────────────────────────────
// Setup
// ─────────────────────────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  delay(50);

  // Init shared state mutexes
  g_logMutex = xSemaphoreCreateMutex();
  g_healthMutex = xSemaphoreCreateMutex();

  logEvent("GarbageTrack GPS v%s — Starting", FW_VERSION);

  // Watchdog
  esp_task_wdt_init(WDT_TIMEOUT_S, true);
  esp_task_wdt_add(NULL);

  // NVS
  prefs.begin(FLASH_NS, false);
  wifiPrefs.begin(WIFI_NS, false);

  int savedGps = flashCount();
  if (savedGps > 0)
    logEvent("Flash queue: %d records from prev session", savedGps);

  // ── Start Permanent Service AP (WPA2) ─────────────────────
  // AP stays active indefinitely regardless of STA state.
  WiFi.persistent(false); // Prevent NVS corruption issues
  WiFi.disconnect(true, true);
  delay(100);
  WiFi.mode(WIFI_AP_STA);
  WiFi.setHostname(WIFI_HOSTNAME);

  // Use simpler initialization (defaults to channel 1, max 4, not hidden)
  WiFi.softAP(DIAG_AP_SSID, DIAG_AP_PASS);

  IPAddress apIP(192, 168, 4, 1);
  WiFi.softAPConfig(apIP, apIP, IPAddress(255, 255, 255, 0));

  // DNS redirect for captive portal probe requests
  dnsServer.start(53, "*", apIP);

  logEvent("Service AP started: SSID=%s IP=%s", DIAG_AP_SSID, DIAG_AP_IP);

  // If no saved networks, portal starts in IDLE for provisioning
  String ssids[WIFI_MAX_NETWORKS], passes[WIFI_MAX_NETWORKS];
  int storedCount = loadWiFiFromNVS(ssids, passes, WIFI_MAX_NETWORKS);
  if (storedCount == 0) {
    logEvent("No saved WiFi — entering provisioning mode");
    g_health.prov_state = PROV_IDLE;
  }

  // Setup persistent diagnostics portal
  setupDiagnosticServer();

  // GPS queue
  gpsQueue = xQueueCreate(20, sizeof(GPSRecord));
  if (!gpsQueue) {
    logEvent("FATAL: Queue creation failed");
    esp_restart();
  }

  // Modem
  SerialAT.begin(115200, SERIAL_8N1, MODEM_RX, MODEM_TX);
  modemPowerOn();
  esp_task_wdt_reset();

  // ── FreeRTOS Tasks ────────────────────────────────────────
  // Core 0: Portal + DNS + LED (light tasks, no LTE contention)
  // Core 1: GPS + Upload (time-critical, LTE-heavy)
  xTaskCreatePinnedToCore(TaskPortal, "Portal", 8192, NULL, 1, NULL, 0);
  xTaskCreatePinnedToCore(TaskLED, "LED", 2048, NULL, 1, NULL, 0);
  xTaskCreatePinnedToCore(TaskWiFi, "WiFi", 4096, NULL, 1, NULL, 0);
  xTaskCreatePinnedToCore(TaskGPS, "GPS", 4096, NULL, 1, NULL, 1);
  xTaskCreatePinnedToCore(TaskUpload, "Upload", 10240, NULL, 2, NULL, 1);

  esp_task_wdt_delete(NULL);
}

void loop() {
  // All work is done in FreeRTOS tasks.
  // loop() is deliberately empty — vTaskDelay keeps idle task fed.
  vTaskDelay(pdMS_TO_TICKS(10000));
}
