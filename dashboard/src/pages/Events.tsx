import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

interface SystemEvent {
  id: string | number
  device_id: string
  event_type: string
  payload: Record<string, unknown>
  timestamp: string
}

interface DeviceControl {
  id: string
  name: string
  track_events_enabled: boolean
}

const EVENT_META: Record<string, { color: string; bg: string; label: string }> = {
  boot:              { color: '#38bdf8', bg: 'rgba(56,189,248,0.08)',  label: 'Boot' },
  gps_fix:           { color: '#00d4aa', bg: 'rgba(0,212,170,0.08)',   label: 'GPS Fix' },
  lte_connected:     { color: '#a78bfa', bg: 'rgba(167,139,250,0.08)', label: 'LTE Up' },
  lte_disconnected:  { color: '#ef4444', bg: 'rgba(239,68,68,0.08)',   label: 'LTE Down' },
  battery_low:       { color: '#f59e0b', bg: 'rgba(245,158,11,0.08)',  label: 'Bat. Low' },
  upload_fail:       { color: '#ef4444', bg: 'rgba(239,68,68,0.08)',   label: 'Upload Fail' },
  upload_success:    { color: '#00d4aa', bg: 'rgba(0,212,170,0.08)',   label: 'Location Saved' },
  checkpoint_visit:  { color: '#22c55e', bg: 'rgba(34,197,94,0.08)',   label: 'Checkpoint' },
  wifi_provisioned:  { color: '#60a5fa', bg: 'rgba(96,165,250,0.08)',  label: 'Wi-Fi Set Up' },
}
const DEFAULT_META = { color: '#64748b', bg: 'rgba(100,116,139,0.08)', label: 'Event' }

function getMeta(type: string) { return EVENT_META[type] ?? DEFAULT_META }

// ─────────────────────────────────────────────────────────────
// Reverse Geocoding — Nominatim (OpenStreetMap, free, no key)
// Cached by rounded coord (3 dp ≈ 111m) to minimise API calls.
// ─────────────────────────────────────────────────────────────
const geocodeCache = new Map<string, string>()

async function reverseGeocode(lat: number, lon: number): Promise<string> {
  const key = `${lat.toFixed(3)},${lon.toFixed(3)}`
  if (geocodeCache.has(key)) return geocodeCache.get(key)!
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&zoom=14`,
      { headers: { 'User-Agent': 'GarbageTrackDashboard/1.0' } }
    )
    if (!res.ok) throw new Error('Geocode failed')
    const data = await res.json()
    const addr = data.address ?? {}
    const place  = addr.village ?? addr.town ?? addr.city_district ?? addr.city ?? addr.county ?? ''
    const region = addr.state ?? addr.province ?? ''
    const result = [place, region].filter(Boolean).join(', ') || 'Unknown location'
    geocodeCache.set(key, result)
    return result
  } catch {
    const fallback = `${lat.toFixed(3)}°N, ${lon.toFixed(3)}°E`
    geocodeCache.set(key, fallback)
    return fallback
  }
}

// ─────────────────────────────────────────────────────────────
// Human-readable event summaries
// ─────────────────────────────────────────────────────────────
interface EventSummary { line1: string; line2?: string }

function formatEventSummary(
  event_type: string,
  payload: Record<string, unknown>
): EventSummary | null {
  if (!payload || Object.keys(payload).length === 0) return null

  switch (event_type) {
    case 'upload_success': {
      const accepted  = Number(payload.accepted ?? 0)
      const fixCount  = Number(payload.gps_fix_count ?? 0)
      const wifiCount = Number(payload.wifi_count ?? 0)
      const lteCount  = Number(payload.lte_count ?? 0)
      const latest    = payload.latest_record as Record<string, unknown> | undefined
      const via = wifiCount > 0 && lteCount === 0 ? 'Wi-Fi'
                : lteCount > 0 && wifiCount === 0 ? 'LTE' : 'Wi-Fi + LTE'
      const gpsLabel = fixCount === accepted ? 'GPS locked'
                     : fixCount === 0        ? 'No GPS fix'
                     : `${fixCount}/${accepted} with GPS`
      const line1 = `📦 ${accepted} location${accepted !== 1 ? 's' : ''} saved via ${via}  ·  ${gpsLabel}`
      if (latest) {
        const speed   = latest.speed_kmh !== undefined ? `${Number(latest.speed_kmh).toFixed(0)} km/h` : null
        const lat     = Number(latest.lat ?? 0)
        const lon     = Number(latest.lon ?? 0)
        const locFallback = lat && lon ? `📍 ${lat.toFixed(3)}°N, ${lon.toFixed(3)}°E` : null
        const extras  = speed ? speed : ''
        const line2   = [locFallback, extras].filter(Boolean).join('  ·  ')
        return { line1, line2: line2 || undefined }
      }
      return { line1 }
    }
    case 'upload_fail': {
      const attempted = payload.attempted ?? payload.count ?? '?'
      const detail    = typeof payload.detail === 'string' ? payload.detail : ''
      return {
        line1: `⚠️ Failed to save ${attempted} location${Number(attempted) !== 1 ? 's' : ''}`,
        line2: detail ? `Reason: ${detail}` : undefined,
      }
    }
    case 'lte_connected': {
      const operator = typeof payload.operator === 'string' ? payload.operator : ''
      const rssi     = payload.rssi ?? payload.rsrp
      const parts    = [operator ? `Connected to ${operator}` : 'LTE connected', rssi !== undefined ? `Signal: ${rssi} dBm` : null].filter(Boolean)
      return { line1: `📶 ${parts.join('  ·  ')}` }
    }
    case 'lte_disconnected':
      return { line1: '📴 LTE signal lost — switching to offline mode' }
    case 'battery_low': {
      const pct = payload.battery_pct ?? payload.battery ?? payload.level
      return { line1: `🔋 Battery low${pct !== undefined ? `: ${pct}%` : ''}`, line2: 'Please charge or check the solar panel soon' }
    }
    case 'boot': {
      const fw = payload.fw_version ?? payload.firmware
      return { line1: `🚀 Device started${fw ? `  ·  Firmware ${fw}` : ''}` }
    }
    case 'gps_fix': {
      const sats = payload.satellites ?? payload.sats
      return { line1: `📡 GPS signal acquired${sats !== undefined ? `  ·  ${sats} satellites` : ''}` }
    }
    case 'wifi_provisioned': {
      const ssid = typeof payload.ssid === 'string' ? payload.ssid : ''
      return { line1: `📶 Wi-Fi configured${ssid ? `: "${ssid}"` : ''}`, line2: 'Device will connect automatically on next boot' }
    }
    case 'checkpoint_visit': {
      const name = typeof payload.checkpoint_name === 'string' ? payload.checkpoint_name : ''
      return { line1: `📍 Arrived at checkpoint${name ? `: ${name}` : ''}` }
    }
    default: {
      const parts: string[] = []
      for (const [k, v] of Object.entries(payload)) {
        if (typeof v === 'object' || k === 'location') continue
        parts.push(`${k.replace(/_/g, ' ')}: ${v}`)
      }
      return parts.length > 0 ? { line1: parts.slice(0, 4).join('  ·  ') } : null
    }
  }
}

// Renders summary lines; swaps placeholder coords for a geocoded place name asynchronously
function EventSummaryView({ event }: { event: SystemEvent }) {
  const summary = formatEventSummary(event.event_type, event.payload)
  const [locationLabel, setLocationLabel] = useState<string | null>(null)

  useEffect(() => {
    if (event.event_type !== 'upload_success') return
    const latest = event.payload.latest_record as Record<string, unknown> | undefined
    if (!latest) return
    const lat = Number(latest.lat ?? 0)
    const lon = Number(latest.lon ?? 0)
    if (!lat || !lon) return
    reverseGeocode(lat, lon).then(place => setLocationLabel(`📍 Near ${place}`))
  }, [event])

  if (!summary) return null

  let line2 = summary.line2
  if (event.event_type === 'upload_success' && locationLabel && line2) {
    line2 = line2.replace(/📍 \S+°N, \S+°E/, locationLabel)
  }

  return (
    <div style={{
      color: 'var(--text-secondary)', fontSize: '12px',
      background: 'rgba(0,0,0,0.05)', borderRadius: '4px',
      padding: '6px 8px', marginTop: '4px', border: '1px solid var(--border)',
      display: 'flex', flexDirection: 'column', gap: '3px',
    }}>
      <span>{summary.line1}</span>
      {line2 && <span style={{ color: 'var(--text-muted)', fontSize: '11px' }}>{line2}</span>}
    </div>
  )
}

function dayBounds(dateStr: string) {
  const start = new Date(dateStr)
  start.setHours(0, 0, 0, 0)
  const end = new Date(dateStr)
  end.setHours(23, 59, 59, 999)
  return { start, end }
}

function shiftDate(dateStr: string, days: number): string {
  const d = new Date(dateStr)
  d.setDate(d.getDate() + days)
  return d.toISOString().split('T')[0]
}

function timeSince(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const sec = Math.floor(diff / 1000)
  if (sec < 60) return `${sec}s ago`
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`
  return new Date(dateStr).toLocaleDateString()
}

// SVG icon for event type
function EventIcon({ type }: { type: string }) {
  const color = getMeta(type).color
  switch (type) {
    case 'boot': return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M23 12a11.05 11.05 0 0 0-22 0zm-5 7a3 3 0 0 1-6 0v-7"/></svg>
    case 'gps_fix': return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
    case 'lte_connected': return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1.46 5a11 11 0 0 1 21.08 0"/><path d="M5 8.3a7 7 0 0 1 14 0"/><path d="M8.53 11.6a3 3 0 0 1 6.95 0"/><circle cx="12" cy="15" r="1"/></svg>
    case 'lte_disconnected': return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="1" y1="1" x2="23" y2="23"/><path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55"/><path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39"/><path d="M10.71 5.05A16 16 0 0 1 22.56 9"/><path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88"/></svg>
    case 'battery_low': return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="1" y="6" width="18" height="12" rx="2"/><path d="M23 13v-2"/></svg>
    default: return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
  }
}

export default function Events() {
  const [events, setEvents] = useState<SystemEvent[]>([])
  const [devices, setDevices] = useState<DeviceControl[]>([])
  const [selectedDeviceId, setSelectedDeviceId] = useState('all')
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')
  const [deleting, setDeleting] = useState(false)
  const [changingTracking, setChangingTracking] = useState(false)

  useEffect(() => {
    const fetchDevices = async () => {
      const { data: deviceData } = await supabase
        .from('devices')
        .select('id, name, track_events_enabled')
        .order('name', { ascending: true })

      if (!deviceData) return
      const nextDevices = deviceData as DeviceControl[]
      setDevices(nextDevices)
      if (nextDevices.length > 0) {
        setSelectedDeviceId((prev) => (prev === 'all' ? nextDevices[0].id : prev))
      }
    }
    fetchDevices()

    const ch = supabase.channel('events_live')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'system_events' }, (payload) => {
        const incoming = payload.new as SystemEvent
        const { start, end } = dayBounds(selectedDate)
        const ts = new Date(incoming.timestamp)
        if (ts < start || ts > end) return
        setEvents(prev => [incoming, ...prev].slice(0, 1000))
      })
      .subscribe()

    return () => { supabase.removeChannel(ch) }
  }, [selectedDate])

  useEffect(() => {
    const fetchEventsByDate = async () => {
      setLoading(true)
      const { start, end } = dayBounds(selectedDate)
      const { data: eventData } = await supabase
        .from('system_events')
        .select('*')
        .gte('timestamp', start.toISOString())
        .lte('timestamp', end.toISOString())
        .order('timestamp', { ascending: false })
        .limit(1000)

      setEvents((eventData ?? []) as SystemEvent[])
      setLoading(false)
    }

    fetchEventsByDate()
  }, [selectedDate])

  const activeDevice = devices.find((d) => d.id === selectedDeviceId) ?? null

  const filteredByDevice = selectedDeviceId === 'all'
    ? events
    : events.filter((e) => e.device_id === selectedDeviceId)
  const types = ['all', ...Array.from(new Set(filteredByDevice.map(e => e.event_type)))]
  const filtered = filter === 'all'
    ? filteredByDevice
    : filteredByDevice.filter((e) => e.event_type === filter)

  const handleToggleTracking = async () => {
    if (!activeDevice || changingTracking) return

    const nextValue = !activeDevice.track_events_enabled
    const actionWord = nextValue ? 'continue' : 'stop'
    if (!confirm(`Do you want to ${actionWord} event logging for ${activeDevice.name}?`)) return

    setChangingTracking(true)
    const { error } = await supabase
      .from('devices')
      .update({ track_events_enabled: nextValue })
      .eq('id', activeDevice.id)

    if (error) {
      alert(`Failed to update event tracking status: ${error.message}`)
      setChangingTracking(false)
      return
    }

    setDevices((prev) => prev.map((d) => (
      d.id === activeDevice.id ? { ...d, track_events_enabled: nextValue } : d
    )))
    setChangingTracking(false)
  }

  const handleDeleteAll = async () => {
    const scope = filter === 'all' ? 'all logs' : `all ${filter} logs`
    if (!confirm(`Delete ${scope}? This cannot be undone.`)) return

    setDeleting(true)
    try {
      let q = supabase.from('system_events').delete()
      if (selectedDeviceId !== 'all') {
        q = q.eq('device_id', selectedDeviceId)
      }

      const { error } = filter === 'all'
        ? await q.not('id', 'is', null)
        : await q.eq('event_type', filter)

      if (error) {
        console.error('Delete logs failed:', error)
        alert(`Delete failed: ${error.message}`)
        return
      }

      setEvents(prev => prev.filter((e) => {
        const matchesDevice = selectedDeviceId === 'all' || e.device_id === selectedDeviceId
        const matchesType = filter === 'all' || e.event_type === filter
        return !(matchesDevice && matchesType)
      }))
    } finally {
      setDeleting(false)
    }
  }

  const handleDeleteOne = async (id: string | number) => {
    if (!confirm('Delete this log entry?')) return

    const { error } = await supabase.from('system_events').delete().eq('id', id)
    if (error) {
      console.error('Delete log entry failed:', error)
      alert(`Delete failed: ${error.message}`)
      return
    }
    setEvents(prev => prev.filter(e => e.id !== id))
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg-base)' }}>

      {/* Header */}
      <div style={{
        padding: '16px 24px', background: 'var(--bg-surface)',
        borderBottom: '1px solid var(--border)', flexShrink: 0,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', gap: '10px' }}>
          <div>
            <h2 style={{ color: 'var(--text-primary)', fontSize: '16px', fontWeight: 700, margin: 0, letterSpacing: '-0.01em' }}>
              Event Log
            </h2>
            <p style={{ color: 'var(--text-muted)', fontSize: '11px', margin: '3px 0 0' }}>
              {filtered.length} events · {selectedDate}
            </p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <button
              onClick={() => setSelectedDate((prev) => shiftDate(prev, -1))}
              style={{
                padding: '5px 9px', borderRadius: '6px',
                border: '1px solid var(--border)', background: 'var(--bg-card)',
                color: 'var(--text-primary)', fontSize: '12px', cursor: 'pointer',
              }}
            >
              Prev
            </button>
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              style={{
                padding: '5px 10px',
                background: 'var(--bg-card)', border: '1px solid var(--border)',
                borderRadius: '6px', color: 'var(--text-primary)',
                fontSize: '11px', outline: 'none', cursor: 'pointer',
                fontFamily: "'Inter', sans-serif",
              }}
            />
            <button
              onClick={() => setSelectedDate((prev) => shiftDate(prev, 1))}
              style={{
                padding: '5px 9px', borderRadius: '6px',
                border: '1px solid var(--border)', background: 'var(--bg-card)',
                color: 'var(--text-primary)', fontSize: '12px', cursor: 'pointer',
              }}
            >
              Next
            </button>
            <label style={{ color: 'var(--text-muted)', fontSize: '11px', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
              Device
            </label>
            <select
              value={selectedDeviceId}
              onChange={(e) => setSelectedDeviceId(e.target.value)}
              style={{
                padding: '5px 10px',
                background: 'var(--bg-card)', border: '1px solid var(--border)',
                borderRadius: '6px', color: 'var(--text-primary)',
                fontSize: '11px', outline: 'none', cursor: 'pointer',
                fontFamily: "'Inter', sans-serif",
              }}
            >
              <option value="all">All Devices</option>
              {devices.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
            <button
              onClick={handleToggleTracking}
              disabled={!activeDevice || changingTracking}
              style={{
                padding: '5px 10px',
                borderRadius: '6px',
                border: `1px solid ${activeDevice?.track_events_enabled ? 'rgba(239,68,68,0.25)' : 'rgba(0,212,170,0.28)'}`,
                background: 'transparent',
                color: activeDevice?.track_events_enabled ? '#ef4444' : '#00d4aa',
                fontSize: '10px',
                fontWeight: 700,
                letterSpacing: '0.08em',
                cursor: !activeDevice || changingTracking ? 'not-allowed' : 'pointer',
                opacity: !activeDevice || changingTracking ? 0.6 : 1,
              }}
            >
              {changingTracking ? 'UPDATING...' : (activeDevice?.track_events_enabled ? 'STOP EVENTS' : 'CONTINUE EVENTS')}
            </button>
            <button
              onClick={handleDeleteAll}
              disabled={deleting || filtered.length === 0}
              style={{
                padding: '5px 10px',
                borderRadius: '6px',
                border: '1px solid rgba(239,68,68,0.25)',
                background: deleting ? 'rgba(239,68,68,0.08)' : 'transparent',
                color: '#ef4444',
                fontSize: '10px',
                fontWeight: 700,
                letterSpacing: '0.08em',
                cursor: deleting || filtered.length === 0 ? 'not-allowed' : 'pointer',
                opacity: deleting || filtered.length === 0 ? 0.6 : 1,
              }}
            >
              {deleting ? 'DELETING...' : (filter === 'all' ? 'DELETE ALL' : `DELETE ${filter.toUpperCase()}`)}
            </button>
            <div className="anim-blink" style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#ef4444', boxShadow: '0 0 6px #ef4444' }} />
            <span style={{ color: '#ef4444', fontSize: '10px', fontWeight: 700, letterSpacing: '0.12em' }}>LIVE</span>
          </div>
        </div>

        {/* Filter chips */}
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
          {types.map(type => {
            const meta = getMeta(type)
            const active = filter === type
            return (
              <button
                key={type}
                onClick={() => setFilter(type)}
                style={{
                  padding: '4px 10px', borderRadius: '100px',
                  fontSize: '11px', fontWeight: 600, letterSpacing: '0.05em',
                  border: `1px solid ${active ? meta.color + '60' : 'var(--border)'}`,
                  background: active ? meta.bg : 'transparent',
                  color: active ? meta.color : 'var(--text-muted)',
                  cursor: 'pointer', transition: 'all 0.15s',
                  display: 'flex', alignItems: 'center', gap: '5px',
                }}
              >
                {type !== 'all' && <EventIcon type={type} />}
                {type === 'all' ? 'All Events' : meta.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* Event stream */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 24px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {loading ? (
          Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className={`skeleton delay-${Math.min(i + 1, 4)}`} style={{ height: '58px' }} />
          ))
        ) : filtered.length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: '12px' }}>
            <div style={{
              width: '48px', height: '48px',
              background: 'var(--bg-card)', border: '1px solid var(--border)',
              borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="1.5"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
            </div>
            <div style={{ color: 'var(--text-muted)', fontSize: '13px' }}>No events recorded</div>
            <div style={{ color: 'var(--text-muted)', fontSize: '11px' }}>Events appear here when the device connects</div>
          </div>
        ) : (
          filtered.map((event, i) => {
            const meta = getMeta(event.event_type)
            return (
              <div
                key={event.id}
                className={`anim-fade-up delay-${Math.min(i % 4 + 1, 4)}`}
                style={{
                  display: 'flex', alignItems: 'flex-start', gap: '12px',
                  background: meta.bg,
                  border: `1px solid ${meta.color}20`,
                  borderRadius: 'var(--radius-md)',
                  padding: '12px 14px',
                }}
              >
                {/* Icon in circle */}
                <div style={{
                  width: '28px', height: '28px', borderRadius: '50%',
                  background: `${meta.color}15`,
                  border: `1px solid ${meta.color}30`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  flexShrink: 0,
                }}>
                  <EventIcon type={event.event_type} />
                </div>

                {/* Content */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                    <span style={{ color: meta.color, fontSize: '12px', fontWeight: 700, letterSpacing: '0.04em' }}>
                      {meta.label}
                    </span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                      <span style={{ color: 'var(--text-secondary)', fontSize: '10px' }}>
                        {new Date(event.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                      </span>
                      <span style={{ color: 'var(--text-muted)', fontSize: '10px', fontFamily: "'JetBrains Mono', monospace" }}>
                        ({timeSince(event.timestamp)})
                      </span>
                      <button
                        onClick={() => handleDeleteOne(event.id)}
                        style={{
                          padding: '2px 6px',
                          borderRadius: '4px',
                          border: '1px solid rgba(239,68,68,0.22)',
                          background: 'transparent',
                          color: '#ef4444',
                          fontSize: '9px',
                          fontWeight: 700,
                          cursor: 'pointer',
                        }}
                      >
                        Del
                      </button>
                    </div>
                  </div>
                  <EventSummaryView event={event} />
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
