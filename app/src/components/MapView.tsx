import * as maplibregl from 'maplibre-gl'
import type { GeoJSONSource, Map, Marker } from 'maplibre-gl'
import { useEffect, useRef, useState } from 'react'
import type { DayPlan, Place } from '../data/types'
import 'maplibre-gl/dist/maplibre-gl.css'

const STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty'
const BUILDING_SOURCE = 'openfreemap-buildings'
const ROUTE_SOURCE = 'day-route'
const TERRAIN_SOURCE = 'terrain-dem'

type Props = {
  day: DayPlan
  place: Place | null
  placeIndex: number
  mode3d: boolean
  orbit: boolean
  fitRouteKey: number
  focusToken: number
  onSelectPlace: (index: number) => void
  onStatus: (s: 'loading' | 'ready' | 'error', message?: string) => void
  reduceMotion: boolean
}

function lineGeoJSON(places: Place[]) {
  return {
    type: 'Feature' as const,
    properties: {},
    geometry: {
      type: 'LineString' as const,
      coordinates: places.map((p) => [p.lng, p.lat]),
    },
  }
}

function applyBuildingStyle(map: Map) {
  if (map.getLayer('3d-buildings')) return
  if (!map.getSource(BUILDING_SOURCE)) {
    map.addSource(BUILDING_SOURCE, {
      type: 'vector',
      url: 'https://tiles.openfreemap.org/planet',
    })
  }
  const layers = map.getStyle().layers ?? []
  let beforeId: string | undefined
  for (const layer of layers) {
    if (layer.type === 'symbol' && layer.layout && 'text-field' in layer.layout) {
      beforeId = layer.id
      break
    }
  }
  for (const layer of layers) {
    if (layer.type === 'symbol' && /poi|housenumber/i.test(layer.id)) {
      try {
        map.setLayoutProperty(layer.id, 'visibility', 'none')
      } catch {
        /* ignore */
      }
    }
  }
  map.addLayer(
    {
      id: '3d-buildings',
      source: BUILDING_SOURCE,
      'source-layer': 'building',
      type: 'fill-extrusion',
      minzoom: 14,
      filter: ['!=', ['get', 'hide_3d'], true],
      paint: {
        'fill-extrusion-color': [
          'interpolate',
          ['linear'],
          ['coalesce', ['get', 'render_height'], 10],
          0,
          '#E8E0D4',
          25,
          '#D9D0C2',
          60,
          '#C9BDB0',
          120,
          '#B7A99A',
        ],
        'fill-extrusion-height': [
          'interpolate',
          ['linear'],
          ['zoom'],
          14,
          0,
          15.2,
          ['coalesce', ['get', 'render_height'], 8],
        ],
        'fill-extrusion-base': [
          'case',
          ['>=', ['zoom'], 15],
          ['coalesce', ['get', 'render_min_height'], 0],
          0,
        ],
        'fill-extrusion-opacity': 0.92,
        'fill-extrusion-vertical-gradient': true,
      },
    },
    beforeId,
  )
}

function setTerrain(map: Map, on: boolean) {
  if (on) {
    if (!map.getSource(TERRAIN_SOURCE)) {
      map.addSource(TERRAIN_SOURCE, {
        type: 'raster-dem',
        tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
        encoding: 'terrarium',
        tileSize: 256,
        maxzoom: 15,
      })
    }
    map.setTerrain({ source: TERRAIN_SOURCE, exaggeration: 1.35 })
  } else {
    map.setTerrain(null)
  }
}

function flyToPlace(map: Map, place: Place, mode3d: boolean, reduceMotion: boolean) {
  map.flyTo({
    center: [place.lng, place.lat],
    zoom: 16.2,
    pitch: mode3d ? 58 : 0,
    bearing: mode3d ? -18 : map.getBearing(),
    duration: reduceMotion ? 0 : 1400,
    essential: true,
  })
}

function fitDay(map: Map, day: DayPlan, mode3d: boolean, reduceMotion: boolean) {
  if (day.places.length === 0) return
  if (day.places.length === 1) {
    flyToPlace(map, day.places[0], mode3d, reduceMotion)
    return
  }
  const b = new maplibregl.LngLatBounds(
    [day.places[0].lng, day.places[0].lat],
    [day.places[0].lng, day.places[0].lat],
  )
  day.places.forEach((p) => b.extend([p.lng, p.lat]))
  map.fitBounds(b, {
    padding: { top: 72, bottom: 72, left: 72, right: 72 },
    pitch: mode3d ? 52 : 0,
    bearing: mode3d ? -12 : 0,
    duration: reduceMotion ? 0 : 1200,
    maxZoom: 15.5,
  })
}

export function MapView({
  day,
  place,
  placeIndex,
  mode3d,
  orbit,
  fitRouteKey,
  focusToken,
  onSelectPlace,
  onStatus,
  reduceMotion,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<Map | null>(null)
  const markersRef = useRef<Marker[]>([])
  const orbitRef = useRef<number | null>(null)
  const readyRef = useRef(false)
  const [retry, setRetry] = useState(0)
  const onSelectRef = useRef(onSelectPlace)
  onSelectRef.current = onSelectPlace

  useEffect(() => {
    if (!containerRef.current) return
    let cancelled = false
    readyRef.current = false
    onStatus('loading')

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: STYLE_URL,
      center: [139.77, 35.68],
      zoom: 14.5,
      pitch: 55,
      bearing: -15,
      maxPitch: 85,
      canvasContextAttributes: { antialias: true },
    })
    mapRef.current = map
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right')

    const onLoad = () => {
      if (cancelled) return
      try {
        applyBuildingStyle(map)
        map.addSource(ROUTE_SOURCE, {
          type: 'geojson',
          data: lineGeoJSON([]),
        })
        map.addLayer({
          id: 'day-route-line',
          type: 'line',
          source: ROUTE_SOURCE,
          paint: {
            'line-color': '#AF402A',
            'line-width': 3.5,
            'line-opacity': 0.85,
            'line-dasharray': [1.2, 1.2],
          },
        })
        readyRef.current = true
        onStatus('ready')
      } catch (e) {
        onStatus('error', e instanceof Error ? e.message : '지도 레이어 오류')
      }
    }

    map.on('load', onLoad)
    map.on('error', () => {
      if (!cancelled) onStatus('error', '지도 타일을 불러오지 못했습니다. 다시 시도해 주세요.')
    })

    return () => {
      cancelled = true
      if (orbitRef.current) cancelAnimationFrame(orbitRef.current)
      markersRef.current.forEach((m) => m.remove())
      markersRef.current = []
      map.remove()
      mapRef.current = null
      readyRef.current = false
    }
  }, [retry, onStatus])

  // day route + markers
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    const sync = () => {
      if (!readyRef.current && !map.isStyleLoaded()) return
      const src = map.getSource(ROUTE_SOURCE) as GeoJSONSource | undefined
      if (src) src.setData(lineGeoJSON(day.places))
      setTerrain(map, !!day.terrain)

      markersRef.current.forEach((m) => m.remove())
      markersRef.current = day.places.map((p, i) => {
        const el = document.createElement('button')
        el.type = 'button'
        el.className = 'map-marker' + (p.eat ? ' is-eat' : '')
        el.innerHTML = `<span>${i + 1}</span>`
        el.setAttribute('aria-label', `${i + 1}. ${p.name}`)
        el.addEventListener('click', (ev) => {
          ev.stopPropagation()
          onSelectRef.current(i)
        })
        return new maplibregl.Marker({ element: el, anchor: 'bottom' })
          .setLngLat([p.lng, p.lat])
          .addTo(map)
      })
    }

    if (map.isStyleLoaded()) sync()
    else map.once('load', sync)
  }, [day])

  // active marker class
  useEffect(() => {
    markersRef.current.forEach((m, i) => {
      m.getElement().classList.toggle('is-active', i === placeIndex)
    })
  }, [placeIndex, day])

  // camera focus when day/place/token changes
  useEffect(() => {
    const map = mapRef.current
    if (!map || !place) return
    const run = () => flyToPlace(map, place, mode3d, reduceMotion)
    if (map.isStyleLoaded()) run()
    else map.once('load', run)
  }, [focusToken, place, mode3d, reduceMotion])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    map.easeTo({ pitch: mode3d ? 58 : 0, duration: reduceMotion ? 0 : 700 })
  }, [mode3d, reduceMotion])

  useEffect(() => {
    if (fitRouteKey === 0) return
    const map = mapRef.current
    if (!map) return
    fitDay(map, day, mode3d, reduceMotion)
  }, [fitRouteKey, day, mode3d, reduceMotion])

  useEffect(() => {
    const map = mapRef.current
    if (orbitRef.current) {
      cancelAnimationFrame(orbitRef.current)
      orbitRef.current = null
    }
    if (!orbit || !map || reduceMotion) return
    const tick = () => {
      map.setBearing(map.getBearing() + 0.08)
      orbitRef.current = requestAnimationFrame(tick)
    }
    orbitRef.current = requestAnimationFrame(tick)
    return () => {
      if (orbitRef.current) cancelAnimationFrame(orbitRef.current)
    }
  }, [orbit, reduceMotion, placeIndex])

  return (
    <div className="map-shell">
      <div ref={containerRef} className="map-canvas" role="application" aria-label="도쿄 3D 지도" />
      <p className="map-disclaimer">
        연결선은 방문 순서이며 실제 도로 경로가 아닙니다. 건물은 OpenFreeMap 높이 기반
        입체(fill-extrusion)로, 실사 3D 메쉬가 아닙니다.
      </p>
      <button type="button" className="map-retry" onClick={() => setRetry((n) => n + 1)}>
        지도 다시 불러오기
      </button>
    </div>
  )
}
