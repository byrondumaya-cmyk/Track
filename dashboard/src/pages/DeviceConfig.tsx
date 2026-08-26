import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────
interface WiFiNetwork {
  ssid: string
  password: string
  added_at?: string
}

interface Device {
  id: string
  device_id: string
  name: string
  is_active: boolean
  wifi_networks: WiFiNetwork[]
  apn: string | null
  sim_number: string | null
  sim_carrier: string | null
  recording_interval_s: number
}

interface DeviceStatus {
  device_id: string
  wifi_connected: boolean
  wifi_ssid: string | null
  fw_version: string | null
  last_seen: string | null
  status: string
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────
const ts = (iso: string | null) => {
  if (!iso) return 'Never'
  return new Date(iso).toLocaleString('en-PH', {
    dateStyle: 'medium', timeStyle: 'short',
  })
}

// ─────────────────────────────────────────────────────────────
// Icons
// ─────────────────────────────────────────────────────────────
const WifiIcon = ({ strength }: { strength?: 'strong' | 'weak' | 'off' }) => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
    stroke={strength === 'off' ? '#ef4444' : strength === 'weak' ? '#f59e0b' : 'currentColor'}
    strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M5 12.55a11 11 0 0 1 14.08 0"/>
    <path d="M1.42 9a16 16 0 0 1 21.16 0"/>
    <path d="M8.53 16.11a6 6 0 0 1 6.95 0"/>
    <circle cx="12" cy="20" r="1" fill="currentColor"/>
  </svg>
)
const LteIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="2" width="20" height="20" rx="2"/>
    <path d="M8 16V8m4 8l3-8 3 8M7 16h4"/>
  </svg>
)
const PlusIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2.5" strokeLinecap="round">
    <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
  </svg>
)
const TrashIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/>
    <path d="M10 11v6m4-6v6"/><path d="M9 6V4h6v2"/>
  </svg>
)
const EyeIcon = ({ visible }: { visible: boolean }) => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    {visible
      ? <><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></>
      : <><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></>
    }
  </svg>
)

// ─────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────
export default function DeviceConfig() {
  const [devices, setDevices]           = useState<Device[]>([])
  const [statuses, setStatuses]         = useState<Record<string, DeviceStatus>>({})
  const [loading, setLoading]           = useState(true)
  const [saving, setSaving]             = useState<string | null>(null)  // deviceId being saved
  const [deleting, setDeleting]         = useState<string | null>(null)
  const [showPassFor, setShowPassFor]   = useState<Record<string, boolean>>({})
  const [simForm, setSimForm]           = useState<Record<string, { apn: string; sim_number: string; sim_carrier: string; recording_interval_s: number; open: boolean }>>({}) 
  const [savingSim, setSavingSim]       = useState<string | null>(null)

  // Add-network form state per device
  const [addForm, setAddForm] = useState<Record<string, { ssid: string; password: string; open: boolean }>>({})

  useEffect(() => {
    fetchData()

    // Realtime: refresh device_status on change
    const channel = supabase.channel('device_config_status')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'device_status' }, () => {
        fetchStatuses()
      })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [])

  const fetchData = async () => {
    setLoading(true)
    await Promise.all([fetchDevices(), fetchStatuses()])
    setLoading(false)
  }

  const fetchDevices = async () => {
    const { data } = await supabase
      .from('devices')
      .select('id, device_id, name, is_active, wifi_networks, apn, sim_number, sim_carrier, recording_interval_s')
      .order('name')
    if (data) setDevices(data as Device[])
  }

  const fetchStatuses = async () => {
    const { data } = await supabase
      .from('device_status')
      .select('device_id, wifi_connected, wifi_ssid, fw_version, last_seen, status')
    if (!data) return
    const map: Record<string, DeviceStatus> = {}
    for (const row of data) map[row.device_id] = row as DeviceStatus
    setStatuses(map)
  }

  const openAddForm = (deviceId: string) => {
    setAddForm(f => ({ ...f, [deviceId]: { ssid: '', password: '', open: true } }))
  }
  const closeAddForm = (deviceId: string) => {
    setAddForm(f => ({ ...f, [deviceId]: { ...(f[deviceId] || {}), open: false, ssid: '', password: '' } }))
  }

  const openSimForm = (device: Device) => {
    setSimForm(f => ({
      ...f,
      [device.id]: {
        apn: device.apn ?? 'internet',
        sim_number: device.sim_number ?? '',
        sim_carrier: device.sim_carrier ?? 'Smart PH',
        recording_interval_s: device.recording_interval_s ?? 5,
        open: true,
      },
    }))
  }
  const closeSimForm = (deviceId: string) => {
    setSimForm(f => ({ ...f, [deviceId]: { ...(f[deviceId] || {}), open: false } }))
  }

  const handleSaveSim = async (device: Device) => {
    const form = simForm[device.id]
    if (!form) return
    setSavingSim(device.id)
    const { error } = await supabase
      .from('devices')
      .update({
        apn: form.apn.trim() || 'internet',
        sim_number: form.sim_number.trim() || null,
        sim_carrier: form.sim_carrier.trim() || null,
        recording_interval_s: Number(form.recording_interval_s) || 5,
      })
      .eq('id', device.id)
    if (!error) {
      closeSimForm(device.id)
      await fetchDevices()
    } else {
      console.error('Failed to save SIM config:', error)
    }
    setSavingSim(null)
  }

  const handleAddNetwork = async (device: Device) => {
    const form = addForm[device.id]
    if (!form?.ssid.trim()) return

    setSaving(device.id)

    // Build updated wifi_networks array
    const existing: WiFiNetwork[] = device.wifi_networks ?? []
    const filtered = existing.filter(n => n.ssid !== form.ssid.trim())
    const updated: WiFiNetwork[] = [
      ...filtered,
      { ssid: form.ssid.trim(), password: form.password, added_at: new Date().toISOString() },
    ]

    const { error } = await supabase
      .from('devices')
      .update({ wifi_networks: updated })
      .eq('id', device.id)

    if (!error) {
      closeAddForm(device.id)
      await fetchDevices()
    } else {
      console.error('Failed to save WiFi network:', error)
    }
    setSaving(null)
  }

  const handleRemoveNetwork = async (device: Device, ssid: string) => {
    setDeleting(`${device.id}::${ssid}`)
    const updated = (device.wifi_networks ?? []).filter(n => n.ssid !== ssid)

    const { error } = await supabase
      .from('devices')
      .update({ wifi_networks: updated })
      .eq('id', device.id)

    if (!error) await fetchDevices()
    else console.error('Failed to remove network:', error)
    setDeleting(null)
  }

  const toggleShowPass = (key: string) => {
    setShowPassFor(p => ({ ...p, [key]: !p[key] }))
  }

  if (loading) {
    return (
      <div style={{ padding: '32px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {[1, 2].map(i => (
          <div key={i} className="skeleton" style={{ height: '160px', borderRadius: '12px' }} />
        ))}
      </div>
    )
  }

  return (
    <div style={{
      height: '100%', overflowY: 'auto',
      background: 'var(--bg-base)', padding: '24px',
    }}>
      {/* ── Page Header ── */}
      <div style={{ marginBottom: '24px' }}>
        <h1 style={{
          color: 'var(--text-primary)', fontSize: '18px', fontWeight: 700,
          letterSpacing: '-0.02em', margin: '0 0 4px',
        }}>
          Device Configuration
        </h1>
        <p style={{ color: 'var(--text-muted)', fontSize: '12px', margin: 0 }}>
          Manage cloud-stored WiFi credentials, SIM/APN config, and monitor connection paths per device.
          The tracker fetches these on every boot via LTE and auto-connects to the strongest known network.
        </p>
      </div>

      {devices.length === 0 && (
        <div style={{
          padding: '48px', textAlign: 'center',
          color: 'var(--text-muted)', fontSize: '13px',
          background: 'var(--bg-surface)', borderRadius: '12px',
          border: '1px solid var(--border)',
        }}>
          No devices registered yet.
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {devices.map(device => {
          const status  = statuses[device.id]
          const isOnline = status?.status === 'online'
          const networks = device.wifi_networks ?? []
          const form     = addForm[device.id]
          const isSaving = saving === device.id

          return (
            <div key={device.id} style={{
              background: 'var(--bg-surface)',
              border: '1px solid var(--border)',
              borderRadius: '12px',
              overflow: 'hidden',
            }} className="anim-fade-up">

              {/* Device header row */}
              <div style={{
                padding: '16px 20px',
                borderBottom: '1px solid var(--border)',
                display: 'flex', alignItems: 'center', gap: '12px',
              }}>
                {/* Status dot */}
                <div style={{
                  width: '8px', height: '8px', borderRadius: '50%', flexShrink: 0,
                  background: isOnline ? 'var(--accent)' : '#ef4444',
                  boxShadow: isOnline ? '0 0 8px var(--accent)' : '0 0 6px #ef4444',
                }} className={isOnline ? 'anim-blink' : ''} />

                <div style={{ flex: 1 }}>
                  <div style={{ color: 'var(--text-primary)', fontSize: '14px', fontWeight: 600 }}>
                    {device.name}
                    <span style={{
                      marginLeft: '8px', fontSize: '10px', fontWeight: 500,
                      color: 'var(--text-muted)', fontFamily: "'JetBrains Mono', monospace",
                    }}>
                      {device.device_id}
                    </span>
                  </div>
                  <div style={{ color: 'var(--text-muted)', fontSize: '11px', marginTop: '2px' }}>
                    Last seen: {ts(status?.last_seen ?? null)}
                    {status?.fw_version && (
                      <span style={{ marginLeft: '12px', color: 'var(--accent)' }}>
                        FW {status.fw_version}
                      </span>
                    )}
                  </div>
                </div>

                {/* Current connection path badge */}
                <div style={{
                  display: 'flex', alignItems: 'center', gap: '6px',
                  padding: '4px 10px', borderRadius: '100px',
                  background: status?.wifi_connected
                    ? 'rgba(0,212,170,0.1)' : 'rgba(59,130,246,0.1)',
                  border: `1px solid ${status?.wifi_connected
                    ? 'rgba(0,212,170,0.25)' : 'rgba(59,130,246,0.25)'}`,
                  fontSize: '11px', fontWeight: 600,
                  color: status?.wifi_connected ? 'var(--accent)' : '#60a5fa',
                }}>
                  {status?.wifi_connected
                    ? <><WifiIcon strength="strong" />{status?.wifi_ssid ?? 'WiFi'}</>
                    : <><LteIcon />LTE</>
                  }
                </div>
              </div>

              {/* ── SIM / APN section ── */}
              {(() => {
                const sf = simForm[device.id]
                const isSavingSim = savingSim === device.id
                const simCarriers = ['Smart PH', 'Globe PH', 'DITO PH', 'Other']
                const apnDefaults: Record<string, string> = {
                  'Smart PH': 'internet', 'Globe PH': 'internet.globe.com.ph',
                  'DITO PH': 'internet', 'Other': 'internet',
                }
                return (
                  <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)' }}>
                    <div style={{
                      color: 'var(--text-muted)', fontSize: '10px', fontWeight: 600,
                      letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: '10px',
                    }}>
                      SIM / APN Configuration
                    </div>

                    {sf?.open ? (
                      <div className="anim-fade-up" style={{
                        background: 'var(--bg-card)', borderRadius: '8px',
                        border: '1px solid rgba(59,130,246,0.25)', padding: '14px',
                      }}>
                        <div style={{
                          color: '#60a5fa', fontSize: '10px', fontWeight: 700,
                          letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: '10px',
                        }}>Edit SIM / APN</div>
                        {/* Carrier selector */}
                        <div style={{ marginBottom: '8px' }}>
                          <label style={{ color: 'var(--text-muted)', fontSize: '10px', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', display: 'block', marginBottom: '4px' }}>Carrier</label>
                          <select
                            value={sf.sim_carrier}
                            onChange={e => {
                              const carrier = e.target.value
                              setSimForm(f => ({
                                ...f, [device.id]: {
                                  ...f[device.id],
                                  sim_carrier: carrier,
                                  apn: apnDefaults[carrier] ?? 'internet',
                                },
                              }))
                            }}
                            style={{
                              width: '100%', padding: '7px 10px', boxSizing: 'border-box',
                              background: 'var(--bg-elevated)', border: '1px solid var(--border)',
                              borderRadius: '6px', color: 'var(--text-primary)', fontSize: '13px',
                              outline: 'none', fontFamily: "'Inter', sans-serif",
                            }}
                          >
                            {simCarriers.map(c => <option key={c} value={c}>{c}</option>)}
                          </select>
                        </div>
                        {/* SIM Number */}
                        {[
                          { label: 'SIM Number', key: 'sim_number', type: 'text', placeholder: 'e.g. 09613556081' },
                          { label: 'APN', key: 'apn', type: 'text', placeholder: 'e.g. internet' },
                        ].map(({ label, key, type, placeholder }) => (
                          <div key={key} style={{ marginBottom: '8px' }}>
                            <label style={{ color: 'var(--text-muted)', fontSize: '10px', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', display: 'block', marginBottom: '4px' }}>{label}</label>
                            <input
                              type={type}
                              placeholder={placeholder}
                              value={(sf as any)[key] ?? ''}
                              onChange={e => setSimForm(f => ({ ...f, [device.id]: { ...f[device.id], [key]: e.target.value } }))}
                              style={{
                                width: '100%', padding: '7px 10px', boxSizing: 'border-box',
                                background: 'var(--bg-elevated)', border: '1px solid var(--border)',
                                borderRadius: '6px', color: 'var(--text-primary)', fontSize: '13px',
                                outline: 'none', fontFamily: "'JetBrains Mono', monospace",
                              }}
                            />
                          </div>
                        ))}
                        {/* Recording Interval */}
                        <div style={{ marginBottom: '8px' }}>
                          <label style={{ color: 'var(--text-muted)', fontSize: '10px', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', display: 'block', marginBottom: '4px' }}>GPS Recording Interval (Seconds)</label>
                          <input
                            type="number"
                            min="5"
                            placeholder="e.g. 5"
                            value={sf.recording_interval_s ?? 5}
                            onChange={e => setSimForm(f => ({ ...f, [device.id]: { ...f[device.id], recording_interval_s: parseInt(e.target.value, 10) } }))}
                            style={{
                              width: '100%', padding: '7px 10px', boxSizing: 'border-box',
                              background: 'var(--bg-elevated)', border: '1px solid var(--border)',
                              borderRadius: '6px', color: 'var(--text-primary)', fontSize: '13px',
                              outline: 'none', fontFamily: "'JetBrains Mono', monospace",
                            }}
                          />
                        </div>
                        <div style={{ display: 'flex', gap: '6px', marginTop: '8px' }}>
                          <button
                            onClick={() => handleSaveSim(device)}
                            disabled={isSavingSim}
                            style={{
                              flex: 1, padding: '8px', borderRadius: '6px',
                              background: isSavingSim ? 'rgba(59,130,246,0.3)' : 'linear-gradient(135deg,#3b82f6,#2563eb)',
                              border: 'none', color: '#fff', fontWeight: 700, fontSize: '12px',
                              cursor: isSavingSim ? 'not-allowed' : 'pointer',
                            }}
                          >
                            {isSavingSim ? 'Saving...' : 'Save SIM Config'}
                          </button>
                          <button
                            onClick={() => closeSimForm(device.id)}
                            style={{
                              padding: '8px 12px', borderRadius: '6px',
                              border: '1px solid var(--border)', background: 'transparent',
                              color: 'var(--text-secondary)', fontSize: '12px', cursor: 'pointer',
                            }}
                          >Cancel</button>
                        </div>
                      </div>
                    ) : (
                      <div style={{
                        display: 'flex', alignItems: 'center', gap: '10px',
                        padding: '10px 12px', borderRadius: '8px',
                        background: 'var(--bg-card)', border: '1px solid var(--border)',
                      }}>
                        <LteIcon />
                        <div style={{ flex: 1 }}>
                          <div style={{ color: 'var(--text-primary)', fontSize: '13px', fontWeight: 600 }}>
                            {device.sim_carrier ?? 'Smart PH'}
                            {device.sim_number && (
                              <span style={{
                                marginLeft: '8px', fontSize: '11px', fontWeight: 500,
                                color: 'var(--text-muted)', fontFamily: "'JetBrains Mono', monospace",
                              }}>{device.sim_number}</span>
                            )}
                          </div>
                          <div style={{ color: 'var(--text-muted)', fontSize: '11px', marginTop: '2px', fontFamily: "'JetBrains Mono', monospace" }}>
                            APN: {device.apn ?? 'internet'} • Interval: {device.recording_interval_s ?? 5}s
                          </div>
                        </div>
                        <button
                          onClick={() => openSimForm(device)}
                          style={{
                            padding: '4px 10px', borderRadius: '6px',
                            border: '1px solid rgba(59,130,246,0.25)', background: 'transparent',
                            color: '#60a5fa', fontSize: '11px', fontWeight: 600, cursor: 'pointer',
                          }}
                        >Edit</button>
                      </div>
                    )}
                  </div>
                )
              })()}

              {/* WiFi networks section */}
              <div style={{ padding: '16px 20px' }}>
                <div style={{
                  color: 'var(--text-muted)', fontSize: '10px', fontWeight: 600,
                  letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: '10px',
                }}>
                  Saved WiFi Networks ({networks.length})
                </div>


                {networks.length === 0 ? (
                  <div style={{
                    padding: '16px', background: 'var(--bg-card)',
                    borderRadius: '8px', border: '1px solid var(--border)',
                    color: 'var(--text-muted)', fontSize: '12px', textAlign: 'center',
                  }}>
                    No networks saved. Add one below or use the on-device provisioning AP.
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {networks.map((net, i) => {
                      const showPassKey = `${device.id}::${net.ssid}`
                      const isCurrentWifi = status?.wifi_connected && status?.wifi_ssid === net.ssid
                      const isDeleting   = deleting === `${device.id}::${net.ssid}`

                      return (
                        <div key={i} style={{
                          display: 'flex', alignItems: 'center', gap: '10px',
                          padding: '10px 12px', borderRadius: '8px',
                          background: isCurrentWifi ? 'rgba(0,212,170,0.05)' : 'var(--bg-card)',
                          border: `1px solid ${isCurrentWifi ? 'rgba(0,212,170,0.2)' : 'var(--border)'}`,
                        }}>
                          <span style={{ color: isCurrentWifi ? 'var(--accent)' : 'var(--text-muted)', display: 'flex' }}>
                            <WifiIcon strength={isCurrentWifi ? 'strong' : undefined} />
                          </span>

                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{
                              color: 'var(--text-primary)', fontSize: '13px', fontWeight: 600,
                              display: 'flex', alignItems: 'center', gap: '6px',
                            }}>
                              {net.ssid}
                              {isCurrentWifi && (
                                <span style={{
                                  fontSize: '9px', fontWeight: 700, color: 'var(--accent)',
                                  background: 'rgba(0,212,170,0.1)', padding: '1px 5px', borderRadius: '4px',
                                  letterSpacing: '0.05em',
                                }}>
                                  ACTIVE
                                </span>
                              )}
                            </div>
                            <div style={{
                              color: 'var(--text-muted)', fontSize: '11px',
                              fontFamily: "'JetBrains Mono', monospace",
                              display: 'flex', alignItems: 'center', gap: '6px', marginTop: '2px',
                            }}>
                              {showPassFor[showPassKey] ? net.password || '(open)' : '••••••••'}
                              <button
                                onClick={() => toggleShowPass(showPassKey)}
                                style={{
                                  background: 'none', border: 'none',
                                  color: 'var(--text-muted)', cursor: 'pointer',
                                  display: 'flex', padding: '0',
                                }}
                              >
                                <EyeIcon visible={!!showPassFor[showPassKey]} />
                              </button>
                            </div>
                          </div>

                          {net.added_at && (
                            <span style={{ color: 'var(--text-muted)', fontSize: '10px', flexShrink: 0 }}>
                              {ts(net.added_at)}
                            </span>
                          )}

                          <button
                            onClick={() => handleRemoveNetwork(device, net.ssid)}
                            disabled={!!isDeleting}
                            style={{
                              display: 'flex', alignItems: 'center', gap: '4px',
                              padding: '4px 8px', borderRadius: '6px',
                              border: '1px solid rgba(239,68,68,0.2)', background: 'transparent',
                              color: isDeleting ? 'var(--text-muted)' : '#ef4444',
                              fontSize: '11px', cursor: isDeleting ? 'not-allowed' : 'pointer',
                            }}
                          >
                            <TrashIcon />
                          </button>
                        </div>
                      )
                    })}
                  </div>
                )}

                {/* Add network form */}
                {form?.open ? (
                  <div className="anim-fade-up" style={{
                    marginTop: '10px', padding: '14px',
                    background: 'var(--bg-card)', borderRadius: '8px',
                    border: '1px solid rgba(0,212,170,0.2)',
                  }}>
                    <div style={{
                      color: 'var(--accent)', fontSize: '10px', fontWeight: 700,
                      letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: '10px',
                    }}>
                      Add WiFi Network
                    </div>
                    {[
                      { label: 'Network Name (SSID)', key: 'ssid', type: 'text', placeholder: 'e.g. HomeWiFi' },
                      { label: 'Password', key: 'password', type: 'password', placeholder: 'Leave blank for open networks' },
                    ].map(({ label, key, type, placeholder }) => (
                      <div key={key} style={{ marginBottom: '8px' }}>
                        <label style={{
                          color: 'var(--text-muted)', fontSize: '10px', fontWeight: 600,
                          letterSpacing: '0.06em', textTransform: 'uppercase', display: 'block', marginBottom: '4px',
                        }}>{label}</label>
                        <input
                          type={type}
                          placeholder={placeholder}
                          value={((form as any)[key] as string) ?? ''}
                          onChange={e => setAddForm(f => ({
                            ...f, [device.id]: { ...f[device.id], [key]: e.target.value },
                          }))}
                          style={{
                            width: '100%', padding: '7px 10px', boxSizing: 'border-box',
                            background: 'var(--bg-elevated)', border: '1px solid var(--border)',
                            borderRadius: '6px', color: 'var(--text-primary)', fontSize: '13px', outline: 'none',
                            fontFamily: "'Inter', sans-serif",
                          }}
                        />
                      </div>
                    ))}
                    <div style={{ display: 'flex', gap: '6px', marginTop: '8px' }}>
                      <button
                        onClick={() => handleAddNetwork(device)}
                        disabled={isSaving || !form.ssid.trim()}
                        style={{
                          flex: 1, padding: '8px', borderRadius: '6px',
                          background: isSaving ? 'rgba(0,212,170,0.3)' : 'linear-gradient(135deg,#00d4aa,#00a87c)',
                          border: 'none', color: '#001a14', fontWeight: 700, fontSize: '12px',
                          cursor: isSaving ? 'not-allowed' : 'pointer',
                        }}
                      >
                        {isSaving ? 'Saving...' : 'Save to Cloud'}
                      </button>
                      <button
                        onClick={() => closeAddForm(device.id)}
                        style={{
                          padding: '8px 12px', borderRadius: '6px',
                          border: '1px solid var(--border)', background: 'transparent',
                          color: 'var(--text-secondary)', fontSize: '12px', cursor: 'pointer',
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => openAddForm(device.id)}
                    style={{
                      marginTop: '10px', width: '100%', padding: '8px',
                      borderRadius: '8px', border: '1px dashed rgba(0,212,170,0.25)',
                      background: 'transparent', color: 'var(--accent)',
                      fontSize: '12px', fontWeight: 600, cursor: 'pointer',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
                    }}
                  >
                    <PlusIcon /> Add WiFi Network
                  </button>
                )}

                {/* Provisioning info */}
                <div style={{
                  marginTop: '14px', padding: '10px 14px',
                  background: 'var(--bg-elevated)',
                  borderRadius: '8px', border: '1px solid var(--border)',
                  display: 'flex', alignItems: 'flex-start', gap: '10px',
                }}>
                  <span style={{ fontSize: '16px', lineHeight: 1 }}>📡</span>
                  <div>
                    <div style={{ color: 'var(--text-secondary)', fontSize: '12px', fontWeight: 600, marginBottom: '2px' }}>
                      On-Device Provisioning AP
                    </div>
                    <div style={{ color: 'var(--text-muted)', fontSize: '11px', lineHeight: '1.5' }}>
                      Hold the <strong style={{ color: 'var(--text-secondary)' }}>BOOT button for 3 seconds</strong> at power-on to start the{' '}
                      <code style={{ fontFamily: "'JetBrains Mono', monospace", color: 'var(--accent)', background: 'rgba(0,212,170,0.08)', padding: '1px 5px', borderRadius: '3px' }}>
                        TrackLocator-Setup
                      </code>{' '}
                      AP. Connect your phone, open a browser, and enter WiFi credentials — they will sync here automatically.
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
