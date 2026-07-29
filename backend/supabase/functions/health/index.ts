// ─────────────────────────────────────────────────────────────
// GarbageTrack – Backend Health Endpoint
// Called by the ESP32 firmware to verify the backend is reachable
// and that the service is operational.
//
// Intentionally lightweight: no DB queries, no auth required.
// Purpose: let the device distinguish "internet up" from "backend up".
// ─────────────────────────────────────────────────────────────

Deno.serve((_req) => {
  return new Response(
    JSON.stringify({
      status: 'ok',
      service: 'garbagetrack-backend',
      ts: new Date().toISOString(),
    }),
    {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      },
    }
  )
})
