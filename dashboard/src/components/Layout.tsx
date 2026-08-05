import { Outlet, Link, useLocation } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useEffect, useState } from 'react'

const MapIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21"/>
    <line x1="9" y1="3" x2="9" y2="18"/>
    <line x1="15" y1="6" x2="15" y2="21"/>
  </svg>
)
const HistoryIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 3v5h5"/>
    <path d="M3.05 13A9 9 0 1 0 6 5.3L3 8"/>
    <polyline points="12 7 12 12 16 14"/>
  </svg>
)
const EventsIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
  </svg>
)
const CheckpointIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10"/>
    <circle cx="12" cy="12" r="3"/>
  </svg>
)
const DeviceConfigIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M5 12.55a11 11 0 0 1 14.08 0"/>
    <path d="M1.42 9a16 16 0 0 1 21.16 0"/>
    <path d="M8.53 16.11a6 6 0 0 1 6.95 0"/>
    <circle cx="12" cy="20" r="1" fill="currentColor"/>
  </svg>
)
const LogoutIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
    <polyline points="16 17 21 12 16 7"/>
    <line x1="21" y1="12" x2="9" y2="12"/>
  </svg>
)

const navigation = [
  { name: 'Live Map',      href: '/',             Icon: MapIcon,          desc: 'Real-time tracking' },
  { name: 'Route History', href: '/history',       Icon: HistoryIcon,      desc: 'Daily route replay' },
  { name: 'Checkpoints',  href: '/checkpoints',   Icon: CheckpointIcon,   desc: 'Route compliance' },
  { name: 'Event Log',    href: '/events',        Icon: EventsIcon,       desc: 'System telemetry' },
  { name: 'Device Config',href: '/device-config', Icon: DeviceConfigIcon, desc: 'WiFi & OTA settings' },
]

export default function Layout() {
  const location = useLocation()
  const [isOnline, setIsOnline] = useState(false)

  useEffect(() => {
    // Check initial status
    supabase.from('device_status').select('status').limit(1).single().then(({ data }) => {
      setIsOnline(data?.status === 'online')
    })
    
    // Listen for live connection changes
    const channel = supabase.channel('sidebar_status')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'device_status' }, (payload) => {
        // @ts-ignore
        setIsOnline(payload.new?.status === 'online')
      })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [])

  const handleLogout = async () => {
    await supabase.auth.signOut()
  }

  return (
    <div style={{
      display: 'flex', height: '100vh',
      background: 'var(--bg-base)',
      fontFamily: "'Inter', sans-serif",
    }}>
      {/* ── Sidebar ── */}
      <aside style={{
        width: '224px', flexShrink: 0,
        background: 'var(--bg-surface)',
        borderRight: '1px solid var(--border)',
        display: 'flex', flexDirection: 'column',
      }} className="anim-slide-left">

        {/* Logo */}
        <div style={{
          padding: '20px 20px 18px',
          borderBottom: '1px solid var(--border)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{
              width: '32px', height: '32px',
              background: 'linear-gradient(135deg, #00d4aa, #00a87c)',
              borderRadius: '8px',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 0 20px rgba(0,212,170,0.3)', flexShrink: 0,
            }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#001a14" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 12h-4l-3 9L9 3l-3 9H2"/>
              </svg>
            </div>
            <div>
              <div style={{ color: 'var(--text-primary)', fontSize: '13px', fontWeight: 700, letterSpacing: '-0.01em' }}>TrackLocator</div>
              <div style={{ color: 'var(--text-muted)', fontSize: '10px', letterSpacing: '0.05em' }}>COMMAND CENTER</div>
            </div>
          </div>
        </div>

        {/* Nav label */}
        <div style={{ padding: '18px 20px 8px' }}>
          <span style={{ color: 'var(--text-muted)', fontSize: '10px', fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
            Navigation
          </span>
        </div>

        {/* Nav items */}
        <nav style={{ flex: 1, padding: '0 12px', display: 'flex', flexDirection: 'column', gap: '2px' }}>
          {navigation.map(({ name, href, Icon, desc }, i) => {
            const isActive = location.pathname === href
            return (
              <Link
                key={name}
                to={href}
                className={`anim-fade-up delay-${i + 1}`}
                style={{
                  display: 'flex', alignItems: 'center', gap: '10px',
                  padding: '9px 12px', borderRadius: 'var(--radius-sm)',
                  textDecoration: 'none',
                  background: isActive ? 'rgba(0,212,170,0.1)' : 'transparent',
                  border: `1px solid ${isActive ? 'rgba(0,212,170,0.25)' : 'transparent'}`,
                  transition: 'all 0.15s ease',
                  position: 'relative',
                }}
              >
                <span style={{
                  color: isActive ? 'var(--accent)' : 'var(--text-muted)',
                  transition: 'color 0.15s',
                  display: 'flex',
                }}>
                  <Icon />
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
                    fontSize: '13px', fontWeight: isActive ? 600 : 400,
                    transition: 'color 0.15s',
                  }}>
                    {name}
                  </div>
                  <div style={{ color: 'var(--text-muted)', fontSize: '10px', marginTop: '1px' }}>
                    {desc}
                  </div>
                </div>
                {isActive && (
                  <div style={{
                    width: '5px', height: '5px', borderRadius: '50%',
                    background: 'var(--accent)',
                    boxShadow: '0 0 8px var(--accent)',
                    flexShrink: 0,
                  }} />
                )}
              </Link>
            )
          })}
        </nav>

        {/* System status */}
        <div style={{
          margin: '0 12px 12px',
          background: 'var(--bg-card)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-md)',
          padding: '12px 14px',
        }}>
          <div style={{ color: 'var(--text-muted)', fontSize: '10px', fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: '8px' }}>
            Fleet Status
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div style={{ position: 'relative', display: 'flex' }}>
              <div style={{
                width: '8px', height: '8px', borderRadius: '50%',
                background: isOnline ? 'var(--accent)' : '#ef4444',
                boxShadow: isOnline ? '0 0 6px var(--accent)' : '0 0 6px #ef4444',
              }} className={isOnline ? "anim-blink" : ""} />
            </div>
            <span style={{ color: isOnline ? 'var(--text-secondary)' : '#ef4444', fontSize: '12px' }}>
              {isOnline ? 'Tracker Online' : 'Tracker Offline'}
            </span>
          </div>
        </div>

        {/* Logout */}
        <div style={{ padding: '0 12px 16px' }}>
          <button
            onClick={handleLogout}
            style={{
              width: '100%', display: 'flex', alignItems: 'center', gap: '10px',
              padding: '9px 12px', borderRadius: 'var(--radius-sm)',
              border: '1px solid transparent', background: 'transparent',
              color: 'var(--text-muted)', fontSize: '13px',
              cursor: 'pointer', transition: 'all 0.15s',
            }}
            onMouseEnter={e => {
              const el = e.currentTarget
              el.style.background = 'rgba(239,68,68,0.08)'
              el.style.borderColor = 'rgba(239,68,68,0.2)'
              el.style.color = '#f87171'
            }}
            onMouseLeave={e => {
              const el = e.currentTarget
              el.style.background = 'transparent'
              el.style.borderColor = 'transparent'
              el.style.color = 'var(--text-muted)'
            }}
          >
            <LogoutIcon />
            <span>Sign Out</span>
          </button>
        </div>
      </aside>

      {/* ── Main content ── */}
      <main style={{
        flex: 1, overflow: 'hidden',
        display: 'flex', flexDirection: 'column',
      }}>
        <Outlet />
      </main>
    </div>
  )
}
