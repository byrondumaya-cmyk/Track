import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Layout from './components/Layout'
import LiveMap from './pages/LiveMap'
import History from './pages/History'
import Events from './pages/Events'
import Checkpoints from './pages/Checkpoints'
import DeviceConfig from './pages/DeviceConfig'
import Login from './pages/Login'
import { useEffect, useState } from 'react'
import { supabase } from './lib/supabase'
import type { Session } from '@supabase/supabase-js'

function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
    })

    return () => { subscription.unsubscribe() }
  }, [])

  if (loading) {
    return (
      <div style={{
        minHeight: '100vh', display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        background: 'var(--bg-base)', gap: '16px',
      }}>
        <div style={{
          width: '40px', height: '40px',
          border: '2px solid var(--border)',
          borderTopColor: 'var(--accent)',
          borderRadius: '50%',
        }} className="anim-spin" />
        <p style={{ color: 'var(--text-secondary)', fontSize: '13px', margin: 0 }}>
          Initializing system...
        </p>
      </div>
    )
  }

  if (!session) {
    return <Login />
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<LiveMap />} />
          <Route path="history" element={<History />} />
          <Route path="events" element={<Events />} />
          <Route path="checkpoints" element={<Checkpoints />} />
          <Route path="device-config" element={<DeviceConfig />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}

export default App
