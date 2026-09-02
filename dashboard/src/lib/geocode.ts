// ─────────────────────────────────────────────────────────────
// Reverse Geocoding — Nominatim (OpenStreetMap, free, no key)
// Cached by rounded coord (3 dp ≈ 111m) to minimise API calls.
// ─────────────────────────────────────────────────────────────
export interface GeocodeResult {
  location: string;
  landmark: string | null;
}

const geocodeCache = new Map<string, GeocodeResult>()

export async function reverseGeocode(lat: number, lon: number): Promise<GeocodeResult> {
  const key = `${lat.toFixed(3)},${lon.toFixed(3)}`
  if (geocodeCache.has(key)) return geocodeCache.get(key)!
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&zoom=18`,
      { headers: { 'User-Agent': 'GarbageTrackDashboard/1.0' } }
    )
    if (!res.ok) throw new Error('Geocode failed')
    const data = await res.json()
    const addr = data.address ?? {}
    const place  = addr.village ?? addr.town ?? addr.city_district ?? addr.city ?? addr.county ?? ''
    const region = addr.state ?? addr.province ?? ''
    const location = [place, region].filter(Boolean).join(', ') || 'Unknown location'
    const landmark = addr.amenity ?? addr.shop ?? addr.tourism ?? addr.leisure ?? addr.building ?? addr.historic ?? addr.mall ?? addr.commercial ?? addr.office ?? null
    
    const result = { location, landmark }
    geocodeCache.set(key, result)
    return result
  } catch {
    const fallback = { location: `${lat.toFixed(3)}°N, ${lon.toFixed(3)}°E`, landmark: null }
    geocodeCache.set(key, fallback)
    return fallback
  }
}
