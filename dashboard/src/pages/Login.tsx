import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

const SignalIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2 20h.01M7 20v-4M12 20v-8M17 20V8M22 4v16"/>
  </svg>
)

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [isMobile, setIsMobile] = useState(false)

  useEffect(() => {
    const updateViewport = () => {
      setIsMobile(window.innerWidth <= 980)
    }

    updateViewport()
    window.addEventListener('resize', updateViewport)
    return () => { window.removeEventListener('resize', updateViewport) }
  }, [])

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setErrorMsg(null)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      setErrorMsg(error.message)
      setLoading(false)
    }
    // On success, App.tsx auth state listener handles redirect automatically
  }

  return (
    <div style={{
      minHeight: '100dvh', display: 'flex',
      flexDirection: isMobile ? 'column' : 'row',
      background: 'var(--bg-base)',
      fontFamily: "'Inter', sans-serif",
      overflowX: 'hidden',
      overflowY: 'auto',
      position: 'relative',
    }}>
      {/* Animated background mesh */}
      <div style={{
        position: 'fixed', inset: 0, zIndex: 0,
        background: 'radial-gradient(ellipse 80% 60% at 10% 40%, rgba(0,212,170,0.06) 0%, transparent 60%), radial-gradient(ellipse 60% 80% at 90% 60%, rgba(59,130,246,0.06) 0%, transparent 60%)',
        pointerEvents: 'none',
      }} />

      {/* Grid overlay */}
      <div style={{
        position: 'fixed', inset: 0, zIndex: 0, opacity: 0.025,
        backgroundImage: `
          linear-gradient(rgba(255,255,255,0.5) 1px, transparent 1px),
          linear-gradient(90deg, rgba(255,255,255,0.5) 1px, transparent 1px)`,
        backgroundSize: '48px 48px',
        pointerEvents: 'none',
      }} />

      {/* Left panel — branding */}
      <div
        className="anim-fade-in"
        style={{
          flex: isMobile ? '0 0 auto' : 1,
          display: 'flex', flexDirection: 'column',
          justifyContent: 'center', padding: '64px',
          position: 'relative', zIndex: 1,
          paddingBottom: isMobile ? '14px' : '64px',
          paddingTop: isMobile ? '34px' : '64px',
          paddingInline: isMobile ? '22px' : '64px',
        }}
      >
        {/* Logo mark */}
        <div className="anim-float" style={{ marginBottom: isMobile ? '24px' : '48px' }}>
          <div style={{
            width: '56px', height: '56px',
            background: 'linear-gradient(135deg, #00d4aa, #00a87c)',
            borderRadius: '14px',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 0 40px rgba(0,212,170,0.35)',
            marginBottom: '24px',
          }}>
            <SignalIcon />
          </div>
          <div style={{ color: 'var(--accent)', fontSize: '11px', letterSpacing: '0.2em', fontWeight: 600, textTransform: 'uppercase', marginBottom: '10px' }}>
            Fleet Intelligence Platform
          </div>
          <h1 style={{ color: 'var(--text-primary)', fontSize: isMobile ? '30px' : '40px', fontWeight: 800, lineHeight: 1.15, margin: 0, letterSpacing: '-0.02em' }}>
            GarbageTrack<br />
            <span style={{ color: 'var(--accent)' }}>Command</span>
          </h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '15px', marginTop: '16px', lineHeight: 1.6, maxWidth: '380px' }}>
            Real-time GPS monitoring, route analytics, and telemetry for the Aliaga Municipal Waste Management fleet.
          </p>
        </div>

        {/* Feature list */}
        <div className="anim-fade-up delay-2" style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {[
            { label: 'Live GPS Tracking', desc: '30s position updates via LTE' },
            { label: 'Route History', desc: 'Full daily route replay with analytics' },
            { label: 'System Events', desc: 'Real-time telemetry & alert log' },
          ].map(({ label, desc }) => (
            <div key={label} style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <div style={{
                width: '6px', height: '6px', borderRadius: '50%',
                background: 'var(--accent)', flexShrink: 0,
                boxShadow: '0 0 6px var(--accent)',
              }} />
              <div>
                <span style={{ color: 'var(--text-primary)', fontSize: '13px', fontWeight: 500 }}>{label} </span>
                <span style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>— {desc}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Divider */}
      {!isMobile && (
      <div style={{
        width: '1px',
        background: 'linear-gradient(to bottom, transparent, var(--border), transparent)',
        flexShrink: 0, zIndex: 1,
      }} />
      )}

      {/* Right panel — form */}
      <div style={{
        width: isMobile ? '100%' : '480px', flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: isMobile ? '18px 22px 28px' : '48px', zIndex: 1,
      }}>
        <div className="anim-slide-left" style={{ width: '100%', maxWidth: isMobile ? '520px' : 'none' }}>
          <div style={{ marginBottom: '36px' }}>
            <h2 style={{ color: 'var(--text-primary)', fontSize: '22px', fontWeight: 700, margin: '0 0 6px', letterSpacing: '-0.01em' }}>
              Authorized Access
            </h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: '13px', margin: 0 }}>
              Sign in with your administrator credentials
            </p>
          </div>

          {errorMsg && (
            <div className="anim-fade-in" style={{
              background: 'rgba(239,68,68,0.08)',
              border: '1px solid rgba(239,68,68,0.25)',
              borderRadius: 'var(--radius-md)',
              padding: '12px 16px',
              color: '#f87171', fontSize: '13px',
              marginBottom: '20px',
              display: 'flex', alignItems: 'center', gap: '8px',
            }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>
              {errorMsg}
            </div>
          )}

          <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {/* Email */}
            <div>
              <label style={{
                display: 'block', color: 'var(--text-secondary)', fontSize: '11px',
                fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase',
                marginBottom: '8px',
              }}>
                Email address
              </label>
              <input
                type="email" required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="admin@lgu-aliaga.gov.ph"
                style={{
                  width: '100%', padding: '11px 14px',
                  background: 'var(--bg-card)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-sm)',
                  color: 'var(--text-primary)', fontSize: '14px',
                  outline: 'none', transition: 'border-color 0.2s',
                  boxSizing: 'border-box',
                }}
                onFocus={e => (e.target.style.borderColor = 'var(--accent)')}
                onBlur={e => (e.target.style.borderColor = 'var(--border)')}
              />
            </div>

            {/* Password */}
            <div>
              <label style={{
                display: 'block', color: 'var(--text-secondary)', fontSize: '11px',
                fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase',
                marginBottom: '8px',
              }}>
                Password
              </label>
              <input
                type="password" required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••••••"
                style={{
                  width: '100%', padding: '11px 14px',
                  background: 'var(--bg-card)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-sm)',
                  color: 'var(--text-primary)', fontSize: '14px',
                  outline: 'none', transition: 'border-color 0.2s',
                  boxSizing: 'border-box',
                }}
                onFocus={e => (e.target.style.borderColor = 'var(--accent)')}
                onBlur={e => (e.target.style.borderColor = 'var(--border)')}
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              style={{
                width: '100%', padding: '12px',
                background: loading
                  ? 'rgba(0,212,170,0.3)'
                  : 'linear-gradient(135deg, #00d4aa 0%, #00a87c 100%)',
                border: 'none', borderRadius: 'var(--radius-sm)',
                color: loading ? 'rgba(255,255,255,0.6)' : '#001a14',
                fontSize: '14px', fontWeight: 700,
                cursor: loading ? 'not-allowed' : 'pointer',
                marginTop: '8px',
                boxShadow: loading ? 'none' : '0 4px 24px rgba(0,212,170,0.3)',
                transition: 'all 0.2s',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
              }}
            >
              {loading ? (
                <>
                  <span className="anim-spin" style={{ width: '14px', height: '14px', border: '2px solid rgba(255,255,255,0.3)', borderTopColor: 'white', borderRadius: '50%', display: 'inline-block' }} />
                  Authenticating...
                </>
              ) : (
                'Sign In'
              )}
            </button>
          </form>

          <p style={{ color: 'var(--text-muted)', fontSize: '11px', textAlign: 'center', marginTop: '28px', letterSpacing: '0.04em' }}>
            AUTHORIZED PERSONNEL ONLY · ALIAGA, NUEVA ECIJA
          </p>
        </div>
      </div>
    </div>
  )
}
