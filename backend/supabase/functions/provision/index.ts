import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabaseUrl        = Deno.env.get('SUPABASE_URL')!
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const supabase           = createClient(supabaseUrl, supabaseServiceKey)

// ─────────────────────────────────────────────────────────────
// POST /functions/v1/provision
//
// Called by the ESP32's captive portal form submission after a
// user connects to the GarbageTrack-Setup AP and enters their
// WiFi credentials. The ESP POSTs these to Supabase (via LTE)
// so they are stored in the cloud and synced to the device list.
//
// Auth:    X-Device-ID + X-API-Key
// Body:    { "ssid": "HomeWiFi", "password": "secret123" }
// Returns: { status: "ok", message: "..." }
// ─────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 })
  }

  const deviceIdHeader = req.headers.get('X-Device-ID')
  const apiKeyHeader   = req.headers.get('X-API-Key')

  if (!deviceIdHeader) return json({ error: 'Missing X-Device-ID header' }, 401)
  if (!apiKeyHeader)   return json({ error: 'Missing X-API-Key header' }, 401)

  // Validate device
  const { data: device, error: deviceErr } = await supabase
    .from('devices')
    .select('id, api_key, is_active')
    .eq('device_id', deviceIdHeader)
    .single()

  if (deviceErr || !device) return json({ error: 'Device not registered' }, 401)
  if (!device.is_active)    return json({ error: 'Device is inactive' }, 403)
  if (device.api_key !== apiKeyHeader) return json({ error: 'Invalid API key' }, 401)

  // Parse body
  let ssid = '', password = ''
  try {
    const body = await req.json()
    ssid     = (body.ssid     ?? '').trim()
    password = (body.password ?? '').trim()
  } catch {
    return json({ error: 'Invalid JSON payload' }, 400)
  }

  if (!ssid) return json({ error: 'ssid is required' }, 400)
  // Password can be empty (open networks)

  // Call the DB helper function to upsert the credential
  const { error: rpcErr } = await supabase.rpc('upsert_device_wifi', {
    p_device_uuid: device.id,
    p_ssid:        ssid,
    p_password:    password,
  })

  if (rpcErr) {
    console.error('upsert_device_wifi error:', rpcErr)
    return json({ error: 'Failed to save WiFi credential', detail: rpcErr.message }, 500)
  }

  // Log the provisioning event
  await supabase.from('system_events').insert({
    device_id:  device.id,
    event_type: 'wifi_provisioned',
    payload:    { ssid },   // do NOT log password
  })

  return json({
    status:  'ok',
    message: `WiFi network "${ssid}" saved. Device will connect on next boot.`,
  }, 200)
})

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
