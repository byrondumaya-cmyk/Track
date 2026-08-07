import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabaseUrl        = Deno.env.get('SUPABASE_URL')!
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const supabase           = createClient(supabaseUrl, supabaseServiceKey)

// ─────────────────────────────────────────────────────────────
// GET /functions/v1/device-config
//
// Called by the ESP32 on every boot (via LTE) to fetch its
// cloud-stored WiFi credential list and any remote config.
//
// Auth: X-Device-ID + X-API-Key  (same as ingest)
// Returns:
//   { wifi_networks: [{ssid, password}], fw_version_latest, device_name }
// ─────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method !== 'GET') {
    return new Response('Method Not Allowed', { status: 405 })
  }

  const deviceIdHeader = req.headers.get('X-Device-ID')
  const apiKeyHeader   = req.headers.get('X-API-Key')

  if (!deviceIdHeader) {
    return json({ error: 'Missing X-Device-ID header' }, 401)
  }
  if (!apiKeyHeader) {
    return json({ error: 'Missing X-API-Key header' }, 401)
  }

  // Validate device
  const { data, error } = await supabase
    .from('devices')
    .select('id, api_key, is_active, name, wifi_networks, apn, track_history_enabled, track_events_enabled')
    .eq('device_id', deviceIdHeader)
    .single()

  if (error || !data) {
    return json({ error: 'Device not registered' }, 401)
  }
  if (!data.is_active) {
    return json({ error: 'Device is inactive' }, 403)
  }
  if (data.api_key !== apiKeyHeader) {
    return json({ error: 'Invalid API key' }, 401)
  }

  // Strip passwords before returning — send only ssid list for the config check,
  // but firmware needs the passwords to connect.
  // SECURITY NOTE: passwords are transmitted over TLS only.
  const wifiNetworks = (data.wifi_networks ?? []).map((n: Record<string, string>) => ({
    ssid:     n.ssid     ?? '',
    password: n.password ?? '',
  }))

  return json({
    wifi_networks:      wifiNetworks,
    device_name:        data.name,
    apn:                data.apn,
    track_history_enabled: data.track_history_enabled !== false,
    track_events_enabled:  data.track_events_enabled !== false,
    fw_version_latest:  '1.3.0',   // bumped version for TrackerLocator
    config_fetched_at:  new Date().toISOString(),
  }, 200)
})

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
