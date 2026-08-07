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

  let device: {
    id: string
    api_key: string
    is_active: boolean
    track_history_enabled: boolean
    track_events_enabled: boolean
  } | null = null

  if (!isServiceRoleBypass) {
    // Normal path: validate device-specific API key
    if (!apiKeyHeader) {
      console.error('Ingest auth failed: Missing X-API-Key header')
      return new Response(
        JSON.stringify({ error: 'Missing X-API-Key header' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const { data, error: deviceError } = await supabase
      .from('devices')
      .select('id, api_key, is_active, track_history_enabled, track_events_enabled')
      .eq('device_id', deviceIdHeader)
      .single()

    if (deviceError || !data) {
      console.error('Ingest auth failed: Device not registered for ID', deviceIdHeader)
      return new Response(
        JSON.stringify({ error: 'Device not registered' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      )
    }

    if (!data.is_active) {
      console.error('Ingest auth failed: Device is inactive for ID', deviceIdHeader)
      return new Response(
        JSON.stringify({ error: 'Device is inactive' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      )
    }

    if (data.api_key !== apiKeyHeader) {
      console.error('Ingest auth failed: Invalid API key for ID', deviceIdHeader)
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
      .select('id, api_key, is_active, track_history_enabled, track_events_enabled')
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

  const shouldTrackHistory = device!.track_history_enabled !== false
  const shouldTrackEvents = device!.track_events_enabled !== false

  let insertError: { message: string } | null = null
  if (shouldTrackHistory) {
    const insertResult = await supabase
      .from('gps_records')
      .insert(formattedRecords)
    insertError = insertResult.error
  }

  if (insertError) {
    console.error('Insert error:', insertError)
    // Best-effort event log for observability; do not mask the primary error.
    if (shouldTrackEvents) {
      await supabase.from('system_events').insert({
        device_id: device!.id,
        event_type: 'upload_fail',
        payload: {
          attempted: formattedRecords.length,
          detail: insertError.message,
        },
      })
    }

    return new Response(
      JSON.stringify({ error: 'Failed to insert records', detail: insertError.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }

  // Emit one event per successful upload batch.
  const acceptedCount = shouldTrackHistory ? formattedRecords.length : 0

  if (shouldTrackEvents) {
    const gpsFixCount = formattedRecords.filter((r) => r.gps_fix === true).length
    const wifiCount = formattedRecords.filter((r) => r.wifi_connected === true).length
    const latest = formattedRecords[formattedRecords.length - 1] ?? null

    await supabase.from('system_events').insert({
      device_id: device!.id,
      event_type: 'upload_success',
      payload: {
        accepted: acceptedCount,
        gps_fix_count: gpsFixCount,
        wifi_count: wifiCount,
        lte_count: formattedRecords.length - wifiCount,
        latest_record: latest,
        history_recording: shouldTrackHistory,
      },
    })
  }

  return new Response(
    JSON.stringify({
      status: 'ok',
      accepted: acceptedCount,
      history_recording: shouldTrackHistory,
      event_recording: shouldTrackEvents,
      server_time: new Date().toISOString(),
    }),
    { headers: { 'Content-Type': 'application/json' }, status: 200 }
  )
})
