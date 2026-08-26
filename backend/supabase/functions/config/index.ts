import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabaseUrl = Deno.env.get('SUPABASE_URL')!
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const supabase = createClient(supabaseUrl, supabaseServiceKey)

Deno.serve(async (req) => {
  if (req.method !== 'GET') {
    return new Response('Method Not Allowed', { status: 405 })
  }

  const deviceIdHeader = req.headers.get('X-Device-ID')
  const apiKeyHeader = req.headers.get('X-API-Key')

  if (!deviceIdHeader || !apiKeyHeader) {
    return new Response(JSON.stringify({ error: 'Missing authentication headers' }), { 
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    })
  }

  // Validate device
  const { data: device, error: deviceError } = await supabase
    .from('devices')
    .select('id, api_key, is_active, recording_interval_s')
    .eq('device_id', deviceIdHeader)
    .single()

  if (deviceError || !device || !device.is_active || device.api_key !== apiKeyHeader) {
    return new Response(JSON.stringify({ error: 'Unauthorized or inactive device' }), { 
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    })
  }

  // Return configuration details (could be fetched from a config table in the future)
  const config = {
    interval_moving_sec: device.recording_interval_s || 5,
    interval_stopped_sec: 60,
    interval_low_battery_sec: 300,
    gps_accuracy_threshold_hdop: 2.5,
    server_time: new Date().toISOString()
  }

  return new Response(JSON.stringify(config), {
    headers: { 'Content-Type': 'application/json' },
    status: 200,
  })
})
