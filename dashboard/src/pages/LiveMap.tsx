import { useEffect, useState } from 'react'
import { MapContainer, TileLayer, Marker, Popup, useMap, CircleMarker, Polyline } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import { supabase } from '../lib/supabase'
import L from 'leaflet'
import { useRouteHistory } from '../hooks/useRouteHistory'

// Fix leaflet default icon
delete (L.Icon.Default.prototype as unknown as Record<string, unknown>)._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
})

const truckIcon = L.divIcon({
  html: `
    <div style="position:relative;width:48px;height:48px;display:flex;align-items:center;justify-content:center;">
      <div style="position:absolute;inset:0;border-radius:50%;border:2px solid #00d4aa;animation:pulseRing 2s ease-out infinite;"></div>
      <div style="width:36px;height:36px;border-radius:50%;background:linear-gradient(135deg,#00d4aa,#00a87c);display:flex;align-items:center;justify-content:center;border:2px solid rgba(255,255,255,0.15);box-shadow:0 0 20px rgba(0,212,170,0.5);">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#001a14" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <rect x="1" y="3" width="15" height="13" rx="1"/>
          <path d="M16 8h4l3 5v3h-7V8z"/>
          <circle cx="5.5" cy="18.5" r="2.5"/>
          <circle cx="18.5" cy="18.5" r="2.5"/>
        </svg>
      </div>
    </div>`,
  className: '',
  iconSize: [48, 48],
  iconAnchor: [24, 24],
})

interface DeviceStatus {
  device_id: string
  last_seen: string
  last_lat: number
  last_lon: number
  last_speed: number
  battery_pct: number
  rssi_dbm: number
  lte_connected: boolean
  gps_fix: boolean
  status: string
}

function MapFlyTo({ lat, lon }: { lat: number; lon: number }) {
  const map = useMap()
  useEffect(() => {
    if (lat && lon) map.flyTo([lat, lon], map.getZoom(), { animate: true, duration: 1.8 })
  }, [lat, lon, map])
  return null
}

function MetricCard({ icon, label, value, sub, accent }: {
  icon: React.ReactNode; label: string; value: string; sub?: string; accent?: string
}) {
  return (
    <div className="anim-fade-up" style={{
      background: 'var(--bg-card)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius-md)',
      padding: '14px 16px',
      display: 'flex', flexDirection: 'column', gap: '6px',
      position: 'relative', overflow: 'hidden',
    }}>
      {accent && (
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, height: '2px',
          background: accent,
        }} />
      )}
      <div style={{ color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '6px' }}>
        <span style={{ color: accent ?? 'var(--text-secondary)' }}>{icon}</span>
        <span style={{ fontSize: '10px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase' }}>{label}</span>
      </div>
      <div style={{ color: 'var(--text-primary)', fontSize: '22px', fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1 }}>
        {value}
      </div>
      {sub && <div style={{ color: 'var(--text-muted)', fontSize: '11px' }}>{sub}</div>}
    </div>
  )
}



export default function LiveMap() {
  const [device, setDevice] = useState<DeviceStatus | null>(null)
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null)
  const [elapsed, setElapsed] = useState('—')
  const [isMobile, setIsMobile] = useState(false)
  const [metricsExpanded, setMetricsExpanded] = useState(true)
  const defaultCenter: [number, number] = [15.4912, 120.8321]
  
  const today = new Date().toISOString().split('T')[0]
  const { route } = useRouteHistory(today, device?.device_id || '')
  
  // Historical positions from database
  const historyPositions: [number, number][] = route.map(r => [r.lat, r.lon])

  useEffect(() => {
    const fetch = async () => {
      const { data } = await supabase.from('device_status').select('*').limit(1).single()
      if (data) { setDevice(data as DeviceStatus); setLastUpdate(new Date()) }
    }
    fetch()

    const channel = supabase.channel('device_status_live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'device_status' }, (payload) => {
        setDevice(payload.new as DeviceStatus); setLastUpdate(new Date())
      })
      .subscribe()

    const updateViewport = () => {
      const mobile = window.innerWidth <= 900
      setIsMobile(mobile)
      if (!mobile) setMetricsExpanded(true)
      else setMetricsExpanded(false)
    }
    updateViewport()
    window.addEventListener('resize', updateViewport)

    return () => { 
      supabase.removeChannel(channel)
      window.removeEventListener('resize', updateViewport)
    }
  }, [])

  // Update elapsed time every second
  useEffect(() => {
    if (!lastUpdate) return
    const tick = () => {
      const sec = Math.floor((Date.now() - lastUpdate.getTime()) / 1000)
      if (sec < 60) setElapsed(`${sec}s ago`)
      else setElapsed(`${Math.floor(sec / 60)}m ago`)
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [lastUpdate])

  const isOnline = Boolean(device?.last_seen && (Date.now() - new Date(device.last_seen).getTime() < 3 * 60 * 1000))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg-base)' }}>

      {/* ── Header ── */}
      <div style={{
        padding: '16px 24px',
        background: 'var(--bg-surface)',
        borderBottom: '1px solid var(--border)',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <h2 style={{ color: 'var(--text-primary)', fontSize: '16px', fontWeight: 700, margin: 0, letterSpacing: '-0.01em' }}>
                Live Tracking
              </h2>
              {isMobile && (
                <button
                  onClick={() => setMetricsExpanded(!metricsExpanded)}
                  style={{
                    background: 'var(--bg-card)', border: '1px solid var(--border)',
                    borderRadius: '4px', width: '24px', height: '24px',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    cursor: 'pointer', color: 'var(--text-secondary)'
                  }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ transform: metricsExpanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>
                    <polyline points="6 9 12 15 18 9"></polyline>
                  </svg>
                </button>
              )}
            </div>
            <p style={{ color: 'var(--text-muted)', fontSize: '11px', margin: '3px 0 0' }}>
              {lastUpdate ? `Last update: ${elapsed}` : 'Waiting for tracker...'}
            </p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: '7px',
              padding: '5px 12px',
              background: isOnline ? 'rgba(0,212,170,0.1)' : 'var(--bg-card)',
              border: `1px solid ${isOnline ? 'rgba(0,212,170,0.3)' : 'var(--border)'}`,
              borderRadius: '100px',
            }}>
              <div style={{
                position: 'relative', width: '7px', height: '7px',
                borderRadius: '50%',
                background: isOnline ? 'var(--accent)' : 'var(--text-muted)',
                boxShadow: isOnline ? '0 0 6px var(--accent)' : 'none',
              }} className={isOnline ? 'anim-blink' : ''} />
              <span style={{ color: isOnline ? 'var(--accent)' : 'var(--text-secondary)', fontSize: '11px', fontWeight: 600, letterSpacing: '0.06em' }}>
                {isOnline ? 'ONLINE' : 'OFFLINE'}
              </span>
            </div>
          </div>
        </div>

        {/* Metric cards */}
        {metricsExpanded && (
          device ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '10px' }}>
              <MetricCard
                icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>}
                label="Speed"
                value={`${device.last_speed?.toFixed(1) ?? '0'}`}
                sub="km/h"
                accent="#3b82f6"
              />
              <MetricCard
                icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={device.gps_fix ? '#00d4aa' : '#f59e0b'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>}
                label="GPS Fix"
                value={device.gps_fix ? 'Fixed' : 'Searching'}
                sub={`${device.last_lat?.toFixed(5)}, ${device.last_lon?.toFixed(5)}`}
                accent={device.gps_fix ? '#00d4aa' : '#f59e0b'}
              />
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '10px' }}>
              {[1,2].map(i => (
                <div key={i} className="skeleton" style={{ height: '80px' }} />
              ))}
            </div>
          )
        )}
      </div>

      {/* ── Map ── */}
      <div style={{ flex: 1, position: 'relative' }}>
        <MapContainer
          center={device?.last_lat ? [device.last_lat, device.last_lon] : defaultCenter}
          zoom={16}
          style={{ height: '100%', width: '100%' }}
          zoomControl={false}
        >
          <TileLayer
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution='&copy; <a href="https://openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          />
          {device?.last_lat && device?.last_lon && (
            <>
              <MapFlyTo lat={device.last_lat} lon={device.last_lon} />
              {historyPositions.length > 0 && (
                <Polyline positions={historyPositions} pathOptions={{ color: 'var(--accent)', weight: 3, opacity: 0.6 }} />
              )}
              {historyPositions.map((pos, idx) => (
                <CircleMarker 
                  key={idx} 
                  center={pos} 
                  radius={4} 
                  pathOptions={{ color: 'var(--accent)', fillColor: 'var(--bg-card)', fillOpacity: 1, weight: 2 }} 
                />
              ))}
              <Marker position={[device.last_lat, device.last_lon]} icon={truckIcon}>
                <Popup>
                  <div style={{ fontFamily: "'Inter', sans-serif", minWidth: '180px', background: 'var(--bg-card)', margin: '-14px -20px', padding: '14px 16px' }}>
                    <div style={{ color: 'var(--text-primary)', fontWeight: 700, fontSize: '13px', marginBottom: '8px' }}>Tracker {device.device_id}</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      {[
                        ['Speed', `${device.last_speed?.toFixed(1)} km/h`],
                        ['GPS Fix', device.gps_fix ? 'Active' : 'Searching'],
                        ['Last Seen', new Date(device.last_seen).toLocaleTimeString()],
                      ].map(([k, v]) => (
                        <div key={k} style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span style={{ color: 'var(--text-muted)', fontSize: '12px' }}>{k}</span>
                          <span style={{ color: 'var(--text-secondary)', fontSize: '12px', fontWeight: 500 }}>{v}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </Popup>
              </Marker>
            </>
          )}
        </MapContainer>

        {/* Map overlay — no data state */}
        {!device && (
          <div style={{
            position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
            zIndex: 999,
            background: 'var(--bg-card)', border: '1px solid var(--border)',
            borderRadius: 'var(--radius-lg)', padding: '24px 32px',
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px',
            backdropFilter: 'blur(10px)',
          }}>
            <div className="anim-spin" style={{
              width: '32px', height: '32px',
              border: '2px solid var(--border)',
              borderTopColor: 'var(--accent)', borderRadius: '50%',
            }} />
            <div style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>Waiting for tracker to connect...</div>
          </div>
        )}
      </div>
    </div>
  )
}
