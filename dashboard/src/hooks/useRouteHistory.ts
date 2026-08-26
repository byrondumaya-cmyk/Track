import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

export interface GpsRecord {
  id: number
  lat: number
  lon: number
  speed_kmh: number
  battery_pct: number
  timestamp: string
}

export function useRouteHistory(dateStr: string, deviceId: string, triggerRefetch = 0) {
  const [route, setRoute] = useState<GpsRecord[]>([])
  const [loadingRoute, setLoadingRoute] = useState(false)
  
  useEffect(() => {
    const fetchRoute = async () => {
      setLoadingRoute(true)
      const start = new Date(dateStr)
      start.setHours(0, 0, 0, 0)
      const end = new Date(dateStr)
      end.setHours(23, 59, 59, 999)

      let routeQuery = supabase.from('gps_records')
        .select('id, lat, lon, speed_kmh, battery_pct, timestamp')
        .gte('timestamp', start.toISOString())
        .lte('timestamp', end.toISOString())
        .order('timestamp', { ascending: true })

      if (deviceId && deviceId !== 'all') {
        routeQuery = routeQuery.eq('device_id', deviceId)
      }

      const { data } = await routeQuery
      if (data) setRoute(data as GpsRecord[])
      else setRoute([])
      setLoadingRoute(false)
    }

    if (dateStr) {
      fetchRoute()
    }
  }, [dateStr, deviceId, triggerRefetch])

  return { route, setRoute, loadingRoute }
}
