import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabaseUrl = Deno.env.get('SUPABASE_URL')!
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const supabase = createClient(supabaseUrl, supabaseServiceKey)

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 })
  }

  // ── Auth: Accept both header formats ──────────────────────
  // Primary:  X-Device-ID + X-API-Key  (device pre-shared key)
  // Fallback: X-Device-ID + Authorization: Bearer <service_key>
  //           (legacy firmware — will be removed in production)
  // ──────────────────────────────────────────────────────────
  const deviceIdHeader = req.headers.get('X-Device-ID')
  const apiKeyHeader   = req.headers.get('X-API-Key')
  const authHeader     = req.headers.get('Authorization')

  if (!deviceIdHeader) {
    return new Response(
      JSON.stringify({ error: 'Missing X-Device-ID header' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    )
  }

  // Service-role bearer bypass (firmware transition period)
  const bearerToken = authHeader?.startsWith('Bearer ')
    ? authHeader.slice(7)
    : null
  const isServiceRoleBypass = bearerToken === supabaseServiceKey

  let device: { id: string; api_key: string; is_active: boolean } | null = null

  if (!isServiceRoleBypass) {
    // Normal path: validate device-specific API key
    if (!apiKeyHeader) {
      return new Response(
        JSON.stringify({ error: 'Missing X-API-Key header' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const { data, error: deviceError } = await supabase
      .from('devices')
      .select('id, api_key, is_active')
      .eq('device_id', deviceIdHeader)
      .single()

    if (deviceError || !data) {
      return new Response(
        JSON.stringify({ error: 'Device not registered' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      )
    }

    if (!data.is_active) {
      return new Response(
        JSON.stringify({ error: 'Device is inactive' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      )
    }

    if (data.api_key !== apiKeyHeader) {
      return new Response(
        JSON.stringify({ error: 'Invalid API key' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      )
    }

    device = data
  } else {
    // Service-role bypass: just look up the device UUID
    const { data } = await supabase
      .from('devices')
      .select('id, api_key, is_active')
      .eq('device_id', deviceIdHeader)
      .single()
    device = data
    if (!device) {
      return new Response(
        JSON.stringify({ error: 'Device not registered (service-role bypass)' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      )
    }
  }

  // ── Parse body ────────────────────────────────────────────
  let records: Record<string, unknown>[] = []
  try {
    const body = await req.json()
    // Accept both { records: [...] } and a bare array [...]
    records = Array.isArray(body) ? body : (body.records ?? [])
  } catch {
    return new Response(
      JSON.stringify({ error: 'Invalid JSON payload' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    )
  }

  if (records.length === 0) {
    return new Response(
      JSON.stringify({ error: 'No records provided' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    )
  }

  // ── Map and insert ─────────────────────────────────────────
  const formattedRecords = records.map((record) => ({
    ...record,
    device_id: device!.id,
    // Build PostGIS point if lat/lon are present
    location: record.lat && record.lon
      ? `SRID=4326;POINT(${record.lon} ${record.lat})`
      : undefined,
    // Track which data path the device used (WiFi=true / LTE=false)
    wifi_connected: record.wifi_connected === true,
  }))

  const { error: insertError } = await supabase
    .from('gps_records')
    .insert(formattedRecords)

  if (insertError) {
    console.error('Insert error:', insertError)
    return new Response(
      JSON.stringify({ error: 'Failed to insert records', detail: insertError.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }

  return new Response(
    JSON.stringify({
      status: 'ok',
      accepted: formattedRecords.length,
      server_time: new Date().toISOString(),
    }),
    { headers: { 'Content-Type': 'application/json' }, status: 200 }
  )
})
