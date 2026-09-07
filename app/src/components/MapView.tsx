import {
  GeoJSONSource,
  LngLatBounds,
  Map,
  Marker,
  NavigationControl,
  setWorkerUrl,
} from 'maplibre-gl'
import type { Map as MapLibreMap } from 'maplibre-gl'
import { useEffect, useRef, useState } from 'react'
import type { DayPlan, Place } from '../data/types'
import 'maplibre-gl/dist/maplibre-gl.css'
// Vite must bundle the worker as a self-contained chunk (MapLibre v6).
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'

setWorkerUrl(workerUrl)

const STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty'
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

/** 여행 수첩 팔레트를 지도에 입힌다 — 테라코타·청록·황토·크림 */
function tuneStyle(map: MapLibreMap) {
  const layers = map.getStyle().layers ?? []

  const setPaint = (id: string, prop: string, value: unknown) => {
    try {
      if (map.getLayer(id)) map.setPaintProperty(id, prop as never, value as never)
    } catch {
      /* ignore */
    }
  }
  const hide = (id: string) => {
    try {
      map.setLayoutProperty(id, 'visibility', 'none')
    } catch {
      /* ignore */
    }
  }

  for (const layer of layers) {
    const id = layer.id

    // 스프라이트 없는 POI 아이콘·미국 도로 방패는 숨김 (콘솔 경고 원인)
    if (layer.type === 'symbol' && /poi|housenumber|shield/i.test(id)) {
      hide(id)
      continue
    }

    // 물 — 지중해 청록
    if (id === 'water') setPaint(id, 'fill-color', '#8FC2C4')
    if (/^waterway/.test(id)) setPaint(id, 'line-color', '#7FB5B8')

    // 땅 — 크림
    if (id === 'background') setPaint(id, 'background-color', '#F7F0E1')
    if (id === 'landuse_residential')
      setPaint(id, 'fill-color', 'rgba(238, 227, 208, 0.55)')

    // 초록 — 공원·숲을 또렷하게
    if (id === 'park') setPaint(id, 'fill-color', '#B9D89B')
    if (id === 'park_outline') setPaint(id, 'line-color', 'rgba(151, 185, 118, 0.8)')
    if (id === 'landcover_wood') setPaint(id, 'fill-color', 'rgba(154, 196, 120, 0.75)')
    if (id === 'landcover_grass') setPaint(id, 'fill-color', '#B4D494')
    if (id === 'landcover_sand') setPaint(id, 'fill-color', '#EFE0B4')
    if (/landuse_(pitch|track)/.test(id)) setPaint(id, 'fill-color', '#C9DCAB')
    if (id === 'landuse_school') setPaint(id, 'fill-color', '#EDE6C8')
    if (id === 'landuse_hospital') setPaint(id, 'fill-color', '#F4E0D8')

    // 도로 — 크림 바탕 위 황토 계열
    if (/^(road|bridge|tunnel)_(motorway|trunk_primary)($|_link$)/.test(id))
      setPaint(id, 'line-color', '#EDB878')
    if (/^(road|bridge|tunnel)_secondary_tertiary$/.test(id))
      setPaint(id, 'line-color', '#F2D9A4')
    if (/^(road|bridge|tunnel)_(minor|service_track|link|street)$/.test(id))
      setPaint(id, 'line-color', '#FFFDF6')
    if (/casing$/.test(id)) setPaint(id, 'line-color', '#DCCDB4')
    if (/rail/.test(id)) setPaint(id, 'line-color', '#C9BCA8')
  }

  if (map.getLayer('building')) hide('building')

  // 건물 — 밝은 석재 + 테라코타 기운, 높을수록 진하게
  if (map.getLayer('building-3d')) {
    setPaint('building-3d', 'fill-extrusion-color', [
      'interpolate',
      ['linear'],
      ['coalesce', ['get', 'render_height'], 10],
      0,
      '#F1E4CE',
      20,
      '#E7D2B4',
      50,
      '#D9B995',
      100,
      '#C69B78',
      200,
      '#B08560',
    ])
    setPaint('building-3d', 'fill-extrusion-opacity', 0.95)
  }
}

function setTerrain(map: MapLibreMap, on: boolean) {
  try {
    if (on) {
      if (!map.getSource(TERRAIN_SOURCE)) {
        map.addSource(TERRAIN_SOURCE, {
          type: 'raster-dem',
          tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
          encoding: 'terrarium',
          tileSize: 256,
          maxzoom: 12,
        })
      }
      map.setTerrain({ source: TERRAIN_SOURCE, exaggeration: 1.2 })
    } else if (map.getTerrain()) {
      map.setTerrain(null)
    }
  } catch {
    /* DEM optional */
  }
}

function jumpToPlace(map: MapLibreMap, place: Place, mode3d: boolean) {
  map.jumpTo({
    center: [place.lng, place.lat],
    zoom: 15.6,
    pitch: mode3d ? 52 : 0,
    bearing: mode3d ? -16 : 0,
  })
}

function flyToPlace(map: MapLibreMap, place: Place, mode3d: boolean, reduceMotion: boolean) {
  if (reduceMotion) {
    jumpToPlace(map, place, mode3d)
    return
  }
  map.flyTo({
    center: [place.lng, place.lat],
    zoom: 15.8,
    pitch: mode3d ? 52 : 0,
    bearing: mode3d ? -16 : map.getBearing(),
    duration: 700,
    essential: true,
  })
}

function fitDay(map: MapLibreMap, day: DayPlan, mode3d: boolean, reduceMotion: boolean) {
  if (day.places.length === 0) return
  if (day.places.length === 1) {
    flyToPlace(map, day.places[0], mode3d, reduceMotion)
    return
  }
  const b = new LngLatBounds(
    [day.places[0].lng, day.places[0].lat],
    [day.places[0].lng, day.places[0].lat],
  )
  day.places.forEach((p) => b.extend([p.lng, p.lat]))
  map.fitBounds(b, {
    padding: { top: 64, bottom: 64, left: 64, right: 64 },
    pitch: mode3d ? 48 : 0,
    bearing: mode3d ? -10 : 0,
    duration: reduceMotion ? 0 : 650,
    maxZoom: 15.2,
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
  const mapRef = useRef<MapLibreMap | null>(null)
  const markersRef = useRef<Marker[]>([])
  const orbitRef = useRef<number | null>(null)
  const readyRef = useRef(false)
  const dayRef = useRef(day)
  const placeRef = useRef(place)
  const mode3dRef = useRef(mode3d)
  dayRef.current = day
  placeRef.current = place
  mode3dRef.current = mode3d

  const [retry, setRetry] = useState(0)
  const [mapEpoch, setMapEpoch] = useState(0)
  const onSelectRef = useRef(onSelectPlace)
  onSelectRef.current = onSelectPlace
  const onStatusRef = useRef(onStatus)
  onStatusRef.current = onStatus

  useEffect(() => {
    if (!containerRef.current) return
    let cancelled = false
    readyRef.current = false
    onStatusRef.current('loading')

    const start = placeRef.current ?? dayRef.current.places[0]
    const map = new Map({
      container: containerRef.current,
      style: STYLE_URL,
      center: start ? [start.lng, start.lat] : [139.77, 35.68],
      zoom: 15.2,
      pitch: mode3dRef.current ? 52 : 0,
      bearing: -16,
      maxPitch: 80,
      fadeDuration: 0,
      canvasContextAttributes: { antialias: false, powerPreference: 'high-performance' },
    })
    mapRef.current = map
    map.addControl(new NavigationControl({ visualizePitch: true }), 'top-right')

    const finishReady = () => {
      if (cancelled || readyRef.current) return
      readyRef.current = true
      map.resize()
      onStatusRef.current('ready')
      setMapEpoch((n) => n + 1)
    }

    const onLoad = () => {
      if (cancelled) return
      try {
        map.resize()
        tuneStyle(map)
        if (!map.getSource(ROUTE_SOURCE)) {
          map.addSource(ROUTE_SOURCE, {
            type: 'geojson',
            data: lineGeoJSON(dayRef.current.places),
          })
          // 아래: 크림색 헤일로 / 위: 테라코타 점선
          map.addLayer({
            id: 'day-route-halo',
            type: 'line',
            source: ROUTE_SOURCE,
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: {
              'line-color': 'rgba(250, 246, 236, 0.9)',
              'line-width': 7,
            },
          })
          map.addLayer({
            id: 'day-route-line',
            type: 'line',
            source: ROUTE_SOURCE,
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: {
              'line-color': '#AF402A',
              'line-width': 3.2,
              'line-opacity': 0.9,
              'line-dasharray': [0.2, 1.8],
            },
          })
        }
        finishReady()
        if (dayRef.current.terrain) {
          map.once('idle', () => {
            if (!cancelled) setTerrain(map, true)
          })
        }
      } catch (e) {
        onStatusRef.current('error', e instanceof Error ? e.message : '지도 레이어 오류')
      }
    }

    map.on('load', onLoad)
    map.once('idle', finishReady)

    const bootTimer = window.setTimeout(() => {
      if (!cancelled && map.isStyleLoaded()) finishReady()
      else if (!cancelled && !readyRef.current) {
        onStatusRef.current(
          'error',
          '지도 엔진(워커) 연결이 지연되고 있습니다. 다시 불러오기를 눌러 주세요.',
        )
      }
    }, 8000)

    const ro = new ResizeObserver(() => {
      if (!cancelled) map.resize()
    })
    ro.observe(containerRef.current)

    map.on('error', (e) => {
      if (cancelled || readyRef.current) return
      const msg = e.error?.message ?? ''
      if (/Failed to fetch|style|CORS|network|worker/i.test(msg)) {
        onStatusRef.current('error', '지도를 불러오지 못했습니다. 다시 시도해 주세요.')
      }
    })

    return () => {
      cancelled = true
      window.clearTimeout(bootTimer)
      ro.disconnect()
      if (orbitRef.current) cancelAnimationFrame(orbitRef.current)
      markersRef.current.forEach((m) => m.remove())
      markersRef.current = []
      map.remove()
      mapRef.current = null
      readyRef.current = false
    }
  }, [retry])

  // Sync route/markers whenever day changes OR map becomes ready
  useEffect(() => {
    const map = mapRef.current
    if (!map || !readyRef.current) return

    const src = map.getSource(ROUTE_SOURCE) as GeoJSONSource | undefined
    if (src) src.setData(lineGeoJSON(day.places))

    markersRef.current.forEach((m) => m.remove())
    markersRef.current = day.places.map((p, i) => {
      const el = document.createElement('button')
      el.type = 'button'
      el.className = 'map-marker' + (p.eat ? ' is-eat' : '') + (i === placeIndex ? ' is-active' : '')
      el.innerHTML = `<span>${i + 1}</span>`
      el.setAttribute('aria-label', `${i + 1}. ${p.name}`)
      el.addEventListener('click', (ev) => {
        ev.stopPropagation()
        onSelectRef.current(i)
      })
      return new Marker({ element: el, anchor: 'bottom' }).setLngLat([p.lng, p.lat]).addTo(map)
    })

    requestAnimationFrame(() => {
      if (mapRef.current === map) setTerrain(map, !!day.terrain)
    })
  }, [day, mapEpoch, placeIndex])

  useEffect(() => {
    markersRef.current.forEach((m, i) => {
      m.getElement().classList.toggle('is-active', i === placeIndex)
    })
  }, [placeIndex])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !readyRef.current || !place) return
    flyToPlace(map, place, mode3d, reduceMotion)
  }, [focusToken, place, mode3d, reduceMotion, mapEpoch])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !readyRef.current) return
    map.easeTo({ pitch: mode3d ? 52 : 0, duration: reduceMotion ? 0 : 400 })
  }, [mode3d, reduceMotion, mapEpoch])

  useEffect(() => {
    if (fitRouteKey === 0) return
    const map = mapRef.current
    if (!map || !readyRef.current) return
    fitDay(map, day, mode3d, reduceMotion)
  }, [fitRouteKey, day, mode3d, reduceMotion, mapEpoch])

  useEffect(() => {
    const map = mapRef.current
    if (orbitRef.current) {
      cancelAnimationFrame(orbitRef.current)
      orbitRef.current = null
    }
    if (!orbit || !map || !readyRef.current || reduceMotion) return
    const tick = () => {
      map.setBearing(map.getBearing() + 0.08)
      orbitRef.current = requestAnimationFrame(tick)
    }
    orbitRef.current = requestAnimationFrame(tick)
    return () => {
      if (orbitRef.current) cancelAnimationFrame(orbitRef.current)
    }
  }, [orbit, reduceMotion, placeIndex, mapEpoch])

  return (
    <div className="map-shell">
      <div ref={containerRef} className="map-canvas" role="application" aria-label="도쿄 3D 지도" />
      <p className="map-disclaimer">
        연결선은 방문 순서이며 실제 도로 경로가 아닙니다. 건물은 OpenFreeMap 높이 기반
        입체(fill-extrusion)로, 실사 3D 메쉬가 아닙니다. 별도 API 키는 필요 없습니다.
      </p>
      <button type="button" className="map-retry" onClick={() => setRetry((n) => n + 1)}>
        지도 다시 불러오기
      </button>
    </div>
  )
}
