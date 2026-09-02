import { useState, useEffect } from 'react'
import { MapContainer, TileLayer, Polyline, Marker, Popup, CircleMarker } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import { supabase } from '../lib/supabase'
import L from 'leaflet'
import { useRouteHistory } from '../hooks/useRouteHistory'

delete (L.Icon.Default.prototype as unknown as Record<string, unknown>)._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
})

const makePin = (color: string, label: string) => L.divIcon({
  html: `<div style="width:28px;height:28px;border-radius:50%;background:${color};display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:white;border:2px solid rgba(255,255,255,0.2);box-shadow:0 4px 12px rgba(0,0,0,0.5);font-family:Inter,sans-serif">${label}</div>`,
  className: '', iconSize: [28, 28], iconAnchor: [14, 14],
})

interface GpsRecord {
  id: number; lat: number; lon: number
  speed_kmh: number; battery_pct: number; timestamp: string
}


interface DeviceControl {
  id: string
  device_id: string
  name: string
  track_history_enabled: boolean
}

function shiftDate(dateStr: string, days: number): string {
  const d = new Date(dateStr)
  d.setDate(d.getDate() + days)
  return d.toISOString().split('T')[0]
}

function calcDistance(records: GpsRecord[]): number {
  if (records.length < 2) return 0
  return records.reduce((acc, r, i) => {
    if (i === 0) return 0
    const prev = records[i - 1]
    const R = 6371
    const dLat = (r.lat - prev.lat) * Math.PI / 180
    const dLon = (r.lon - prev.lon) * Math.PI / 180
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(prev.lat * Math.PI / 180) * Math.cos(r.lat * Math.PI / 180) * Math.sin(dLon / 2) ** 2
    return acc + R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  }, 0)
}

export default function History() {
  const [date, setDate] = useState(new Date().toISOString().split('T')[0])
  const [devices, setDevices] = useState<DeviceControl[]>([])
  const [selectedDeviceId, setSelectedDeviceId] = useState('all')
  const [changingTracking, setChangingTracking] = useState(false)
  const [deletingHistory, setDeletingHistory] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const [loadingCompliance, setLoadingCompliance] = useState(false)
  const [isMobile, setIsMobile] = useState(false)
  const [statsExpanded, setStatsExpanded] = useState(true)
  
  const { route, loadingRoute } = useRouteHistory(date, selectedDeviceId, reloadKey)
  const loading = loadingRoute || loadingCompliance

  const defaultCenter: [number, number] = [15.4912, 120.8321]

  useEffect(() => {
    const updateViewport = () => {
      const mobile = window.innerWidth <= 900
      setIsMobile(mobile)
      if (!mobile) setStatsExpanded(true)
      else setStatsExpanded(false)
    }
    updateViewport()
    window.addEventListener('resize', updateViewport)
    return () => window.removeEventListener('resize', updateViewport)
  }, [])

  useEffect(() => {
    const fetchDevices = async () => {
      const { data } = await supabase
        .from('devices')
        .select('id, device_id, name, track_history_enabled')
        .order('name', { ascending: true })

      if (!data) return
      const nextDevices = data as DeviceControl[]
      setDevices(nextDevices)

      if (selectedDeviceId === 'all' && nextDevices.length > 0) {
        setSelectedDeviceId(nextDevices[0].id)
      }
    }
    fetchDevices()
  }, [])


  const activeDevice = devices.find((d) => d.id === selectedDeviceId) ?? null

  const handleToggleTracking = async () => {
    if (!activeDevice || changingTracking) return

    const nextValue = !activeDevice.track_history_enabled
    const actionWord = nextValue ? 'continue' : 'stop'
    if (!confirm(`Do you want to ${actionWord} route history tracking for ${activeDevice.name}?`)) return

    setChangingTracking(true)
    const { error } = await supabase
      .from('devices')
      .update({ track_history_enabled: nextValue })
      .eq('id', activeDevice.id)

    if (error) {
      alert(`Failed to update tracking status: ${error.message}`)
      setChangingTracking(false)
      return
    }

    setDevices((prev) => prev.map((d) => (
      d.id === activeDevice.id ? { ...d, track_history_enabled: nextValue } : d
    )))
    setChangingTracking(false)
  }

  const handleDeleteHistory = async (scope: 'day' | 'all') => {
    if (!activeDevice || deletingHistory) return

    const start = new Date(date); start.setHours(0, 0, 0, 0)
    const end = new Date(date); end.setHours(23, 59, 59, 999)
    const target = scope === 'day' ? `history for ${date}` : 'all history'

    if (!confirm(`Delete ${target} for ${activeDevice.name}? This cannot be undone.`)) return

    setDeletingHistory(true)

    const gpsDelete = supabase
      .from('gps_records')
      .delete()
      .eq('device_id', activeDevice.id)

    const finalGpsDelete = scope === 'day'
      ? gpsDelete.gte('timestamp', start.toISOString()).lte('timestamp', end.toISOString())
      : gpsDelete

    const { error: gpsErr } = await finalGpsDelete
    if (gpsErr) {
      alert(`Failed to delete route history: ${gpsErr.message}`)
      setDeletingHistory(false)
      return
    }

    setReloadKey((k) => k + 1)
    setDeletingHistory(false)
  }

  const positions: [number, number][] = route.map(r => [r.lat, r.lon])
  const distance = calcDistance(route)
  const avgSpeed = route.length > 0 ? route.reduce((s, r) => s + (r.speed_kmh || 0), 0) / route.length : 0
  const duration = route.length > 1
    ? Math.floor((new Date(route[route.length - 1].timestamp).getTime() - new Date(route[0].timestamp).getTime()) / 60000)
    : 0

  const stats = [
    {
      label: 'Data Points',
      value: route.length.toString(),
      icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83"/></svg>,
      accent: '#3b82f6',
    },
    {
      label: 'Distance',
      value: `${distance.toFixed(2)} km`,
      icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#00d4aa" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12h18M3 6h18M3 18h18"/></svg>,
      accent: '#00d4aa',
    },
    {
      label: 'Avg Speed',
      value: `${avgSpeed.toFixed(1)} km/h`,
      icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#a78bfa" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>,
      accent: '#a78bfa',
    },
    {
      label: 'Duration',
      value: duration > 0 ? `${Math.floor(duration / 60)}h ${duration % 60}m` : '—',
      icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>,
      accent: '#f59e0b',
    },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg-base)' }}>
      {/* Header */}
      <div style={{
        padding: '16px 24px', background: 'var(--bg-surface)',
        borderBottom: '1px solid var(--border)', flexShrink: 0,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <h2 style={{ color: 'var(--text-primary)', fontSize: '16px', fontWeight: 700, margin: 0, letterSpacing: '-0.01em' }}>
                Route History
              </h2>
              {isMobile && (
                <button
                  onClick={() => setStatsExpanded(!statsExpanded)}
                  style={{
                    background: 'var(--bg-card)', border: '1px solid var(--border)',
                    borderRadius: '4px', width: '24px', height: '24px',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    cursor: 'pointer', color: 'var(--text-secondary)'
                  }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ transform: statsExpanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>
                    <polyline points="6 9 12 15 18 9"></polyline>
                  </svg>
                </button>
              )}
            </div>
            <p style={{ color: 'var(--text-muted)', fontSize: '11px', margin: '3px 0 0' }}>
              {route.length > 0 ? `${route.length} points recorded` : 'Select a date to load route'}
            </p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <label style={{ color: 'var(--text-muted)', fontSize: '11px', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
              Device
            </label>
            <select
              value={selectedDeviceId}
              onChange={(e) => setSelectedDeviceId(e.target.value)}
              style={{
                padding: '7px 10px',
                background: 'var(--bg-card)', border: '1px solid var(--border)',
                borderRadius: 'var(--radius-sm)', color: 'var(--text-primary)',
                fontSize: '12px', outline: 'none', cursor: 'pointer',
                fontFamily: "'Inter', sans-serif",
              }}
            >
              {devices.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
            <button
              onClick={handleToggleTracking}
              disabled={!activeDevice || changingTracking}
              style={{
                padding: '7px 11px',
                borderRadius: '6px',
                border: `1px solid ${activeDevice?.track_history_enabled ? 'rgba(239,68,68,0.25)' : 'rgba(0,212,170,0.28)'}`,
                background: 'transparent',
                color: activeDevice?.track_history_enabled ? '#ef4444' : '#00d4aa',
                fontSize: '10px',
                fontWeight: 700,
                letterSpacing: '0.06em',
                cursor: !activeDevice || changingTracking ? 'not-allowed' : 'pointer',
                opacity: !activeDevice || changingTracking ? 0.6 : 1,
              }}
            >
              {changingTracking ? 'UPDATING...' : (activeDevice?.track_history_enabled ? 'STOP TRACKING' : 'CONTINUE TRACKING')}
            </button>
            <button
              onClick={() => handleDeleteHistory('day')}
              disabled={!activeDevice || deletingHistory}
              style={{
                padding: '7px 11px',
                borderRadius: '6px',
                border: '1px solid rgba(245,158,11,0.3)',
                background: 'transparent',
                color: '#f59e0b',
                fontSize: '10px',
                fontWeight: 700,
                letterSpacing: '0.06em',
                cursor: !activeDevice || deletingHistory ? 'not-allowed' : 'pointer',
                opacity: !activeDevice || deletingHistory ? 0.6 : 1,
              }}
            >
              {deletingHistory ? 'DELETING...' : 'DELETE DAY'}
            </button>
            <button
              onClick={() => handleDeleteHistory('all')}
              disabled={!activeDevice || deletingHistory}
              style={{
                padding: '7px 11px',
                borderRadius: '6px',
                border: '1px solid rgba(239,68,68,0.25)',
                background: 'transparent',
                color: '#ef4444',
                fontSize: '10px',
                fontWeight: 700,
                letterSpacing: '0.06em',
                cursor: !activeDevice || deletingHistory ? 'not-allowed' : 'pointer',
                opacity: !activeDevice || deletingHistory ? 0.6 : 1,
              }}
            >
              {deletingHistory ? 'DELETING...' : 'DELETE ALL'}
            </button>
            <label style={{ color: 'var(--text-muted)', fontSize: '11px', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
              Date
            </label>
            <button
              onClick={() => setDate((prev) => shiftDate(prev, -1))}
              style={{
                padding: '7px 10px',
                borderRadius: '6px',
                border: '1px solid var(--border)',
                background: 'var(--bg-card)',
                color: 'var(--text-primary)',
                fontSize: '12px',
                cursor: 'pointer',
              }}
            >
              Prev
            </button>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              style={{
                padding: '7px 12px',
                background: 'var(--bg-card)', border: '1px solid var(--border)',
                borderRadius: 'var(--radius-sm)', color: 'var(--text-primary)',
                fontSize: '13px', outline: 'none', cursor: 'pointer',
                fontFamily: "'Inter', sans-serif",
              }}
            />
            <button
              onClick={() => setDate((prev) => shiftDate(prev, 1))}
              style={{
                padding: '7px 10px',
                borderRadius: '6px',
                border: '1px solid var(--border)',
                background: 'var(--bg-card)',
                color: 'var(--text-primary)',
                fontSize: '12px',
                cursor: 'pointer',
              }}
            >
              Next
            </button>
          </div>
        </div>

        {/* Stats */}
        {statsExpanded && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '10px' }}>
            {stats.map(({ label, value, icon, accent }) => (
              <div key={label} className="anim-fade-up" style={{
                background: 'var(--bg-card)', border: '1px solid var(--border)',
                borderRadius: 'var(--radius-md)', padding: '12px 14px',
                position: 'relative', overflow: 'hidden',
              }}>
                <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '2px', background: accent }} />
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
                  {icon}
                  <span style={{ color: 'var(--text-muted)', fontSize: '10px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase' }}>{label}</span>
                </div>
                <div style={{ color: 'var(--text-primary)', fontSize: '18px', fontWeight: 700, letterSpacing: '-0.02em' }}>{value}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Map */}
      <div style={{ flex: 1, position: 'relative' }}>
        {loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: '14px' }}>
            <div className="anim-spin" style={{ width: '32px', height: '32px', border: '2px solid var(--border)', borderTopColor: 'var(--accent)', borderRadius: '50%' }} />
            <span style={{ color: 'var(--text-muted)', fontSize: '13px' }}>Loading route...</span>
          </div>
        ) : (
          <MapContainer
            center={positions.length > 0 ? positions[0] : defaultCenter}
            zoom={14}
            style={{ height: '100%', width: '100%' }}
            zoomControl={false}
          >
            <TileLayer
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              attribution='&copy; <a href="https://openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            />
            {positions.length > 0 && (
                <>
                  <Polyline
                    positions={positions}
                    pathOptions={{ color: '#00d4aa', weight: 3, opacity: 0.85 }}
                  />
                  {positions.map((pos, idx) => (
                    <CircleMarker
                      key={idx}
                      center={pos}
                      radius={4}
                      pathOptions={{ color: '#00d4aa', fillColor: 'var(--bg-card)', fillOpacity: 1, weight: 2 }}
                    />
                  ))}
                  <Marker position={positions[0]} icon={makePin('#3b82f6', 'A')}>
                    <Popup><div style={{ fontFamily: 'Inter,sans-serif', color: 'var(--text-primary)', fontSize: '12px' }}><strong>Start</strong><br />{new Date(route[0].timestamp).toLocaleTimeString()}</div></Popup>
                  </Marker>
                  <Marker position={positions[positions.length - 1]} icon={makePin('#ef4444', 'B')}>
                    <Popup><div style={{ fontFamily: 'Inter,sans-serif', color: 'var(--text-primary)', fontSize: '12px' }}><strong>End</strong><br />{new Date(route[route.length - 1].timestamp).toLocaleTimeString()}</div></Popup>
                  </Marker>
                </>
            )}
          </MapContainer>
        )}

        {!loading && positions.length === 0 && (
          <div style={{
            position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
            zIndex: 999, background: 'var(--bg-card)',
            border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)',
            padding: '28px 36px', textAlign: 'center',
          }}>
            <div style={{ color: 'var(--text-muted)', fontSize: '13px' }}>No route data for this date</div>
          </div>
        )}
      </div>
    </div>
  )
}
