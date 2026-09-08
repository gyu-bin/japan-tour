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
const SAT_SOURCE = 'esri-world-imagery'
const SAT_LAYER = 'basemap-satellite'

/** Esri World Imagery — 키 없이 사용 가능 (출처 표기 필요) */
const SAT_TILES = [
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
]

export type BasemapMode = 'map' | 'satellite'

type Props = {
  day: DayPlan
  place: Place | null
  placeIndex: number
  mode3d: boolean
  basemap: BasemapMode
  orbit: boolean
  fitRouteKey: number
  focusToken: number
  /** 투어 모드: 더 긴 시네마틱 비행 */
  cinematic?: boolean
  onSelectPlace: (index: number) => void
  onStatus: (s: 'loading' | 'ready' | 'error', message?: string) => void
  reduceMotion: boolean
}

function lineGeoJSON(places: Place[], upToInclusive?: number) {
  const slice =
    typeof upToInclusive === 'number'
      ? places.slice(0, Math.max(1, upToInclusive + 1))
      : places
  const coords =
    slice.length === 1
      ? [
          [slice[0].lng, slice[0].lat],
          [slice[0].lng + 0.00001, slice[0].lat],
        ]
      : slice.map((p) => [p.lng, p.lat])
  return {
    type: 'Feature' as const,
    properties: {},
    geometry: {
      type: 'LineString' as const,
      coordinates: coords,
    },
  }
}

function ensureSatelliteSource(map: MapLibreMap) {
  if (map.getSource(SAT_SOURCE)) return
  map.addSource(SAT_SOURCE, {
    type: 'raster',
    tiles: SAT_TILES,
    tileSize: 256,
    maxzoom: 19,
    attribution:
      'Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community',
  })
}

/** 일반 지도 색 보정 (네이버 일반지도 톤) */
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

    // 물 — 연한 파랑 (네이버 지도 톤)
    if (id === 'water') setPaint(id, 'fill-color', '#A9CEE8')
    if (/^waterway/.test(id)) setPaint(id, 'line-color', '#A9CEE8')

    // 땅 — 밝은 회백색
    if (id === 'background') setPaint(id, 'background-color', '#F5F5F1')
    if (id === 'landuse_residential')
      setPaint(id, 'fill-color', 'rgba(235, 235, 230, 0.6)')

    // 초록 — 공원·숲은 연녹색
    if (id === 'park') setPaint(id, 'fill-color', '#CBE5AE')
    if (id === 'park_outline') setPaint(id, 'line-color', 'rgba(178, 210, 141, 0.7)')
    if (id === 'landcover_wood') setPaint(id, 'fill-color', 'rgba(184, 218, 147, 0.8)')
    if (id === 'landcover_grass') setPaint(id, 'fill-color', '#C8E3AB')
    if (id === 'landcover_sand') setPaint(id, 'fill-color', '#EEEADA')
    if (/landuse_(pitch|track)/.test(id)) setPaint(id, 'fill-color', '#D4E7BC')
    if (id === 'landuse_school') setPaint(id, 'fill-color', '#EDEEE4')
    if (id === 'landuse_hospital') setPaint(id, 'fill-color', '#F3E9E7')

    // 도로 — 흰 도로 + 연회색 외곽선, 고속도로만 노랑
    if (/^(road|bridge|tunnel)_(motorway|trunk_primary)($|_link$)/.test(id))
      setPaint(id, 'line-color', '#FCD265')
    if (/^(road|bridge|tunnel)_secondary_tertiary$/.test(id))
      setPaint(id, 'line-color', '#FFFFFF')
    if (/^(road|bridge|tunnel)_(minor|service_track|link|street)$/.test(id))
      setPaint(id, 'line-color', '#FFFFFF')
    if (/(motorway|trunk_primary).*casing$/.test(id))
      setPaint(id, 'line-color', '#E8B94F')
    else if (/casing$/.test(id)) setPaint(id, 'line-color', '#D9DBD6')
    if (/rail/.test(id)) setPaint(id, 'line-color', '#C5C8C4')
  }

  if (map.getLayer('building')) hide('building')

  // 건물 — 중립적인 연회색, 높을수록 진하게
  if (map.getLayer('building-3d')) {
    setPaint('building-3d', 'fill-extrusion-color', [
      'interpolate',
      ['linear'],
      ['coalesce', ['get', 'render_height'], 10],
      0,
      '#E9E9E5',
      20,
      '#DDDDD8',
      50,
      '#CDCEC9',
      100,
      '#BCBEBA',
      200,
      '#A9ACA9',
    ])
    setPaint('building-3d', 'fill-extrusion-opacity', 0.95)
  }
}

/** 지면·수면 등 위성 위를 가리는 벡터 레이어 */
function isGroundCoverLayer(id: string) {
  return (
    id === 'background' ||
    id === 'water' ||
    /^landcover_/.test(id) ||
    /^landuse_/.test(id) ||
    id === 'park' ||
    id === 'park_outline' ||
    /^aeroway_/.test(id) ||
    /^waterway/.test(id)
  )
}

function setLayerVisible(map: MapLibreMap, id: string, visible: boolean) {
  try {
    if (map.getLayer(id)) {
      map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none')
    }
  } catch {
    /* ignore */
  }
}

function applyBasemap(map: MapLibreMap, mode: BasemapMode) {
  ensureSatelliteSource(map)

  const layers = map.getStyle().layers ?? []
  const firstId = layers[0]?.id

  if (!map.getLayer(SAT_LAYER)) {
    map.addLayer(
      {
        id: SAT_LAYER,
        type: 'raster',
        source: SAT_SOURCE,
        paint: { 'raster-opacity': 1, 'raster-fade-duration': 0 },
      },
      firstId,
    )
  }

  const satellite = mode === 'satellite'
  setLayerVisible(map, SAT_LAYER, satellite)

  for (const layer of layers) {
    if (layer.id === SAT_LAYER) continue
    if (isGroundCoverLayer(layer.id)) {
      setLayerVisible(map, layer.id, !satellite)
    }
  }

  // 위성일 때 도로는 얇게만, 건물은 살짝 투명하게
  try {
    if (map.getLayer('building-3d')) {
      map.setPaintProperty(
        'building-3d',
        'fill-extrusion-opacity',
        satellite ? 0.72 : 0.95,
      )
      if (satellite) {
        map.setPaintProperty('building-3d', 'fill-extrusion-color', [
          'interpolate',
          ['linear'],
          ['coalesce', ['get', 'render_height'], 10],
          0,
          '#E8E4DC',
          40,
          '#D4CFC6',
          100,
          '#C2BDB4',
          200,
          '#AFAAA2',
        ])
      }
    }
  } catch {
    /* ignore */
  }

  if (!satellite) tuneStyle(map)

  // 동선 헤일로: 위성에서는 어두운 테두리로
  try {
    if (map.getLayer('day-route-halo')) {
      map.setPaintProperty(
        'day-route-halo',
        'line-color',
        satellite ? 'rgba(0, 0, 0, 0.55)' : 'rgba(255, 255, 255, 0.9)',
      )
    }
  } catch {
    /* ignore */
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

function flyToPlace(
  map: MapLibreMap,
  place: Place,
  mode3d: boolean,
  reduceMotion: boolean,
  opts?: { cinematic?: boolean; index?: number },
) {
  if (reduceMotion) {
    jumpToPlace(map, place, mode3d)
    return
  }
  const i = opts?.index ?? 0
  const cinematic = !!opts?.cinematic
  map.flyTo({
    center: [place.lng, place.lat],
    zoom: cinematic ? 16.35 : 15.8,
    pitch: mode3d ? (cinematic ? 58 : 52) : 0,
    bearing: mode3d ? -18 + (i % 5) * 14 : map.getBearing(),
    duration: cinematic ? 1600 : 750,
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
  basemap,
  orbit,
  fitRouteKey,
  focusToken,
  cinematic = false,
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
  const basemapRef = useRef(basemap)
  dayRef.current = day
  placeRef.current = place
  mode3dRef.current = mode3d
  basemapRef.current = basemap

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
        applyBasemap(map, basemapRef.current)
        if (!map.getSource(ROUTE_SOURCE)) {
          map.addSource(ROUTE_SOURCE, {
            type: 'geojson',
            data: lineGeoJSON(dayRef.current.places, 0),
          })
          map.addLayer({
            id: 'day-route-halo',
            type: 'line',
            source: ROUTE_SOURCE,
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: {
              'line-color': 'rgba(255, 255, 255, 0.9)',
              'line-width': 8,
              'line-opacity': 0.85,
            },
          })
          map.addLayer({
            id: 'day-route-line',
            type: 'line',
            source: ROUTE_SOURCE,
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: {
              'line-color': '#AF402A',
              'line-width': 3.6,
              'line-opacity': 0.95,
              'line-dasharray': [0.15, 1.6],
            },
          })
          map.addLayer({
            id: 'day-route-glow',
            type: 'line',
            source: ROUTE_SOURCE,
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: {
              'line-color': '#ff6b4a',
              'line-width': 12,
              'line-opacity': 0.22,
              'line-blur': 4,
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
    if (src) src.setData(lineGeoJSON(day.places, placeIndex))

    markersRef.current.forEach((m) => m.remove())
    markersRef.current = day.places.map((p, i) => {
      const el = document.createElement('button')
      el.type = 'button'
      const visited = i < placeIndex
      el.className =
        'map-marker' +
        (p.eat ? ' is-eat' : '') +
        (i === placeIndex ? ' is-active' : '') +
        (visited ? ' is-visited' : '')
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
    const map = mapRef.current
    if (!map || !readyRef.current) return
    applyBasemap(map, basemap)
  }, [basemap, mapEpoch])

  useEffect(() => {
    markersRef.current.forEach((m, i) => {
      const el = m.getElement()
      el.classList.toggle('is-active', i === placeIndex)
      el.classList.toggle('is-visited', i < placeIndex)
    })
  }, [placeIndex])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !readyRef.current || !place) return
    flyToPlace(map, place, mode3d, reduceMotion, {
      cinematic,
      index: placeIndex,
    })
  }, [focusToken, place, mode3d, reduceMotion, mapEpoch, cinematic, placeIndex])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !readyRef.current) return
    map.easeTo({ pitch: mode3d ? 52 : 0, duration: reduceMotion ? 0 : 400 })
  }, [mode3d, reduceMotion, mapEpoch])

  useEffect(() => {
    if (fitRouteKey === 0) return
    const map = mapRef.current
    if (!map || !readyRef.current) return
    const src = map.getSource(ROUTE_SOURCE) as GeoJSONSource | undefined
    if (src) src.setData(lineGeoJSON(day.places))
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
        연결선은 방문 순서이며 실제 도로 경로가 아닙니다. 위성은 Esri World Imagery,
        건물은 OpenFreeMap 높이 입체(실사 3D 메쉬 아님)입니다. 별도 API 키는 필요 없습니다.
      </p>
      <button type="button" className="map-retry" onClick={() => setRetry((n) => n + 1)}>
        지도 다시 불러오기
      </button>
    </div>
  )
}
