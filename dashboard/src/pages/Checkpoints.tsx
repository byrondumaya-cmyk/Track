import { useEffect, useState } from 'react'
import { MapContainer, TileLayer, Circle, Marker, Popup, useMapEvents } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import { supabase } from '../lib/supabase'
import L from 'leaflet'

delete (L.Icon.Default.prototype as unknown as Record<string, unknown>)._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
})

interface Checkpoint {
  id?: string
  name: string
  lat: number
  lon: number
  radius_m: number
  route_order: number | null
  is_active: boolean
}

const defaultCenter: [number, number] = [15.4912, 120.8321]

// Invisible click layer — adds a checkpoint on map click (when in add mode)
function MapClickHandler({
  enabled,
  onPlace,
}: {
  enabled: boolean
  onPlace: (lat: number, lon: number) => void
}) {
  useMapEvents({
    click(e) {
      if (enabled) onPlace(e.latlng.lat, e.latlng.lng)
    },
  })
  return null
}

const CHECKPOINT_COLORS = [
  '#00d4aa', '#3b82f6', '#a78bfa', '#f59e0b', '#ef4444',
  '#38bdf8', '#34d399', '#fb7185', '#fbbf24', '#818cf8',
]

export default function Checkpoints() {
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([])
  const [loading, setLoading] = useState(true)
  const [addMode, setAddMode] = useState(false)
  const [editTarget, setEditTarget] = useState<Checkpoint | null>(null)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState<Checkpoint>({
    name: '', lat: 0, lon: 0, radius_m: 75, route_order: null, is_active: true,
  })

  useEffect(() => {
    fetchCheckpoints()
  }, [])

  const fetchCheckpoints = async () => {
    setLoading(true)
    const { data } = await supabase
      .from('checkpoints')
      .select('id,name,lat,lon,radius_m,route_order,is_active')
      .order('route_order', { ascending: true })
    if (data) setCheckpoints(data as Checkpoint[])
    setLoading(false)
  }

  const handleMapPlace = (lat: number, lon: number) => {
    setForm(f => ({ ...f, lat: +lat.toFixed(7), lon: +lon.toFixed(7) }))
    setAddMode(false)
  }

  const openAdd = () => {
    setEditTarget(null)
    setForm({ name: '', lat: 0, lon: 0, radius_m: 75, route_order: null, is_active: true })
    setAddMode(true)
  }

  const openEdit = (cp: Checkpoint) => {
    setEditTarget(cp)
    setForm({ ...cp })
    setAddMode(false)
  }

  const handleSave = async () => {
    if (!form.name.trim() || !form.lat || !form.lon) return
    setSaving(true)
    if (editTarget?.id) {
      await supabase.from('checkpoints').update({
        name: form.name, lat: form.lat, lon: form.lon,
        radius_m: form.radius_m, route_order: form.route_order, is_active: form.is_active,
      }).eq('id', editTarget.id)
    } else {
      await supabase.from('checkpoints').insert([{
        name: form.name, lat: form.lat, lon: form.lon,
        radius_m: form.radius_m, route_order: form.route_order, is_active: form.is_active,
      }])
    }
    setSaving(false)
    setEditTarget(null)
    setForm({ name: '', lat: 0, lon: 0, radius_m: 75, route_order: null, is_active: true })
    fetchCheckpoints()
  }

  const handleDelete = async (id: string) => {
    await supabase.from('checkpoints').delete().eq('id', id)
    fetchCheckpoints()
  }

  const handleToggle = async (cp: Checkpoint) => {
    await supabase.from('checkpoints').update({ is_active: !cp.is_active }).eq('id', cp.id!)
    fetchCheckpoints()
  }

  const isEditing = !!editTarget || (form.lat !== 0 && !editTarget)

  return (
    <div style={{ display: 'flex', height: '100%', background: 'var(--bg-base)' }}>

      {/* ── Sidebar ── */}
      <div style={{
        width: '320px', flexShrink: 0,
        background: 'var(--bg-surface)', borderRight: '1px solid var(--border)',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
          <h2 style={{ color: 'var(--text-primary)', fontSize: '16px', fontWeight: 700, margin: '0 0 4px', letterSpacing: '-0.01em' }}>
            Route Checkpoints
          </h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '11px', margin: 0 }}>
            {checkpoints.filter(c => c.is_active).length} active checkpoint{checkpoints.filter(c => c.is_active).length !== 1 ? 's' : ''}
          </p>
        </div>

        {/* Form */}
        {(isEditing || editTarget) && (
          <div className="anim-fade-up" style={{
            padding: '14px 16px', borderBottom: '1px solid var(--border)',
            background: 'var(--bg-card)',
          }}>
            <div style={{ color: 'var(--accent)', fontSize: '10px', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: '10px' }}>
              {editTarget ? 'Edit Checkpoint' : 'New Checkpoint'}
            </div>

            {[
              { label: 'Name', key: 'name', type: 'text', placeholder: 'e.g. Brgy. Poblacion' },
              { label: 'Latitude',  key: 'lat',  type: 'number', placeholder: '15.4912' },
              { label: 'Longitude', key: 'lon',  type: 'number', placeholder: '120.8321' },
              { label: 'Radius (m)', key: 'radius_m', type: 'number', placeholder: '75' },
              { label: 'Order', key: 'route_order', type: 'number', placeholder: '1' },
            ].map(({ label, key, type, placeholder }) => (
              <div key={key} style={{ marginBottom: '8px' }}>
                <label style={{ color: 'var(--text-muted)', fontSize: '10px', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', display: 'block', marginBottom: '4px' }}>
                  {label}
                </label>
                <input
                  type={type}
                  placeholder={placeholder}
                  value={(form as unknown as Record<string, unknown>)[key] as string ?? ''}
                  onChange={e => setForm(f => ({ ...f, [key]: type === 'number' ? +e.target.value : e.target.value }))}
                  style={{
                    width: '100%', padding: '7px 10px', boxSizing: 'border-box',
                    background: 'var(--bg-elevated)', border: '1px solid var(--border)',
                    borderRadius: '6px', color: 'var(--text-primary)', fontSize: '13px', outline: 'none',
                    fontFamily: "'Inter', sans-serif",
                  }}
                />
              </div>
            ))}

            {!editTarget && (
              <p style={{ color: 'var(--text-muted)', fontSize: '11px', margin: '4px 0 8px' }}>
                {form.lat && form.lon ? `📍 ${form.lat.toFixed(5)}, ${form.lon.toFixed(5)}` : 'Or click the map to set coordinates'}
              </p>
            )}

            <div style={{ display: 'flex', gap: '6px', marginTop: '8px' }}>
              <button
                onClick={handleSave}
                disabled={saving || !form.name.trim()}
                style={{
                  flex: 1, padding: '8px', borderRadius: '6px',
                  background: saving ? 'rgba(0,212,170,0.3)' : 'linear-gradient(135deg,#00d4aa,#00a87c)',
                  border: 'none', color: '#001a14', fontWeight: 700, fontSize: '12px',
                  cursor: saving ? 'not-allowed' : 'pointer',
                }}
              >
                {saving ? 'Saving...' : 'Save'}
              </button>
              <button
                onClick={() => { setEditTarget(null); setForm({ name: '', lat: 0, lon: 0, radius_m: 75, route_order: null, is_active: true }) }}
                style={{
                  padding: '8px 12px', borderRadius: '6px', border: '1px solid var(--border)',
                  background: 'transparent', color: 'var(--text-secondary)', fontSize: '12px', cursor: 'pointer',
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Add button */}
        {!isEditing && !editTarget && (
          <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
            <button
              onClick={openAdd}
              style={{
                width: '100%', padding: '9px', borderRadius: '8px',
                background: addMode ? 'rgba(0,212,170,0.15)' : 'rgba(0,212,170,0.08)',
                border: `1px solid ${addMode ? 'rgba(0,212,170,0.4)' : 'rgba(0,212,170,0.2)'}`,
                color: 'var(--accent)', fontSize: '12px', fontWeight: 600,
                cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
              }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              {addMode ? 'Click map to place...' : 'Add Checkpoint'}
            </button>
          </div>
        )}

        {/* Checkpoint list */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 12px' }}>
          {loading ? (
            [1,2,3].map(i => <div key={i} className="skeleton" style={{ height: '60px', marginBottom: '6px' }} />)
          ) : checkpoints.length === 0 ? (
            <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '12px' }}>
              No checkpoints yet. Click "Add Checkpoint" to start.
            </div>
          ) : (
            checkpoints.map((cp, i) => (
              <div
                key={cp.id}
                className="anim-fade-up"
                style={{
                  padding: '10px 12px', borderRadius: '8px', marginBottom: '4px',
                  background: editTarget?.id === cp.id ? 'rgba(0,212,170,0.06)' : 'var(--bg-card)',
                  border: `1px solid ${editTarget?.id === cp.id ? 'rgba(0,212,170,0.2)' : 'var(--border)'}`,
                  opacity: cp.is_active ? 1 : 0.5,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                  <div style={{
                    width: '20px', height: '20px', borderRadius: '50%', flexShrink: 0,
                    background: CHECKPOINT_COLORS[i % CHECKPOINT_COLORS.length],
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '9px', fontWeight: 700, color: 'white',
                  }}>
                    {cp.route_order ?? '—'}
                  </div>
                  <span style={{ color: 'var(--text-primary)', fontSize: '13px', fontWeight: 600, flex: 1 }}>
                    {cp.name}
                  </span>
                  <span style={{ color: 'var(--text-muted)', fontSize: '10px' }}>{cp.radius_m}m</span>
                </div>
                <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: "'JetBrains Mono', monospace", marginBottom: '6px', marginLeft: '28px' }}>
                  {cp.lat.toFixed(5)}, {cp.lon.toFixed(5)}
                </div>
                <div style={{ display: 'flex', gap: '4px', marginLeft: '28px' }}>
                  <button onClick={() => openEdit(cp)} style={{ padding: '3px 8px', borderRadius: '4px', border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-secondary)', fontSize: '10px', cursor: 'pointer' }}>Edit</button>
                  <button onClick={() => handleToggle(cp)} style={{ padding: '3px 8px', borderRadius: '4px', border: '1px solid var(--border)', background: 'transparent', color: cp.is_active ? '#f59e0b' : 'var(--accent)', fontSize: '10px', cursor: 'pointer' }}>
                    {cp.is_active ? 'Disable' : 'Enable'}
                  </button>
                  <button onClick={() => handleDelete(cp.id!)} style={{ padding: '3px 8px', borderRadius: '4px', border: '1px solid rgba(239,68,68,0.2)', background: 'transparent', color: '#ef4444', fontSize: '10px', cursor: 'pointer' }}>Del</button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* ── Map ── */}
      <div style={{ flex: 1, position: 'relative', cursor: addMode ? 'crosshair' : 'default' }}>
        {addMode && (
          <div className="anim-fade-in" style={{
            position: 'absolute', top: '16px', left: '50%', transform: 'translateX(-50%)',
            zIndex: 999, background: 'rgba(0,212,170,0.15)',
            border: '1px solid rgba(0,212,170,0.4)', borderRadius: '100px',
            padding: '6px 16px', color: 'var(--accent)', fontSize: '12px', fontWeight: 600,
            backdropFilter: 'blur(8px)',
          }}>
            Click anywhere on the map to place checkpoint
          </div>
        )}
        <MapContainer center={defaultCenter} zoom={14} style={{ height: '100%', width: '100%' }} zoomControl={false}>
          <TileLayer
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution='&copy; <a href="https://openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          />
          <MapClickHandler enabled={addMode} onPlace={handleMapPlace} />
          {checkpoints.filter(cp => cp.is_active).map((cp, i) => {
            const color = CHECKPOINT_COLORS[i % CHECKPOINT_COLORS.length]
            return (
              <div key={cp.id}>
                <Circle
                  center={[cp.lat, cp.lon]}
                  radius={cp.radius_m}
                  pathOptions={{ color, fillColor: color, fillOpacity: 0.12, weight: 2 }}
                />
                <Marker
                  position={[cp.lat, cp.lon]}
                  icon={L.divIcon({
                    html: `<div style="width:28px;height:28px;border-radius:50%;background:${color};display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:white;border:2px solid rgba(255,255,255,0.2);box-shadow:0 4px 12px rgba(0,0,0,0.5);font-family:Inter,sans-serif">${cp.route_order ?? '?'}</div>`,
                    className: '', iconSize: [28, 28], iconAnchor: [14, 14],
                  })}
                >
                  <Popup>
                    <div style={{ fontFamily: 'Inter,sans-serif', fontSize: '12px', color: 'var(--text-primary)', minWidth: '160px' }}>
                      <strong style={{ color }}>{cp.name}</strong><br />
                      <span style={{ color: 'var(--text-muted)' }}>Radius: {cp.radius_m}m · Order: {cp.route_order ?? '—'}</span>
                    </div>
                  </Popup>
                </Marker>
              </div>
            )
          })}
          {/* Preview marker while placing */}
          {form.lat !== 0 && form.lon !== 0 && !editTarget && (
            <Circle
              center={[form.lat, form.lon]}
              radius={form.radius_m || 75}
              pathOptions={{ color: '#00d4aa', fillColor: '#00d4aa', fillOpacity: 0.2, weight: 2, dashArray: '6 4' }}
            />
          )}
        </MapContainer>
      </div>
    </div>
  )
}
