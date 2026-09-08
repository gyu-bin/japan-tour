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
  /** 뷰포트 관찰 없이 즉시 로드 (풀스크린 맵) */
  eager?: boolean
  /** Astra식 다크 미니어처 톤 */
  darkTheme?: boolean
  zoomCmd?: { n: number; dir: 1 | -1 }
  fitPadding?: { top?: number; bottom?: number; left?: number; right?: number }
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
    maxzoom: 18,
    attribution:
      'Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community',
  })
}

/** 일반 지도 색 보정 */
function tuneStyle(map: MapLibreMap, dark = false) {
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

    if (layer.type === 'symbol' && /poi|housenumber|shield/i.test(id)) {
      hide(id)
      continue
    }

    if (dark) {
      if (id === 'water') setPaint(id, 'fill-color', '#4a6d7c')
      if (/^waterway/.test(id)) setPaint(id, 'line-color', '#4a6d7c')
      if (id === 'background') setPaint(id, 'background-color', '#1c222b')
      if (id === 'landuse_residential') setPaint(id, 'fill-color', 'rgba(40, 46, 56, 0.7)')
      if (id === 'park') setPaint(id, 'fill-color', '#3d5240')
      if (id === 'park_outline') setPaint(id, 'line-color', 'rgba(70, 100, 78, 0.6)')
      if (id === 'landcover_wood') setPaint(id, 'fill-color', 'rgba(55, 78, 58, 0.85)')
      if (id === 'landcover_grass') setPaint(id, 'fill-color', '#445844')
      if (id === 'landcover_sand') setPaint(id, 'fill-color', '#4a463e')
      if (/landuse_(pitch|track)/.test(id)) setPaint(id, 'fill-color', '#3f4f3f')
      if (id === 'landuse_school') setPaint(id, 'fill-color', '#323842')
      if (id === 'landuse_hospital') setPaint(id, 'fill-color', '#3a3234')
      if (/^(road|bridge|tunnel)_(motorway|trunk_primary)($|_link$)/.test(id))
        setPaint(id, 'line-color', '#c4a05a')
      if (/^(road|bridge|tunnel)_secondary_tertiary$/.test(id))
        setPaint(id, 'line-color', '#6a7382')
      if (/^(road|bridge|tunnel)_(minor|service_track|link|street)$/.test(id))
        setPaint(id, 'line-color', '#5a6472')
      if (/(motorway|trunk_primary).*casing$/.test(id))
        setPaint(id, 'line-color', '#8a7040')
      else if (/casing$/.test(id)) setPaint(id, 'line-color', '#3a424e')
      if (/rail/.test(id)) setPaint(id, 'line-color', '#4a5260')
      if (layer.type === 'symbol') {
        try {
          map.setPaintProperty(id, 'text-color', '#a8b0bc' as never)
          map.setPaintProperty(id, 'text-halo-color', 'rgba(20, 24, 30, 0.85)' as never)
        } catch {
          /* ignore */
        }
      }
    } else {
      if (id === 'water') setPaint(id, 'fill-color', '#A9CEE8')
      if (/^waterway/.test(id)) setPaint(id, 'line-color', '#A9CEE8')
      if (id === 'background') setPaint(id, 'background-color', '#F5F5F1')
      if (id === 'landuse_residential')
        setPaint(id, 'fill-color', 'rgba(235, 235, 230, 0.6)')
      if (id === 'park') setPaint(id, 'fill-color', '#CBE5AE')
      if (id === 'park_outline') setPaint(id, 'line-color', 'rgba(178, 210, 141, 0.7)')
      if (id === 'landcover_wood') setPaint(id, 'fill-color', 'rgba(184, 218, 147, 0.8)')
      if (id === 'landcover_grass') setPaint(id, 'fill-color', '#C8E3AB')
      if (id === 'landcover_sand') setPaint(id, 'fill-color', '#EEEADA')
      if (/landuse_(pitch|track)/.test(id)) setPaint(id, 'fill-color', '#D4E7BC')
      if (id === 'landuse_school') setPaint(id, 'fill-color', '#EDEEE4')
      if (id === 'landuse_hospital') setPaint(id, 'fill-color', '#F3E9E7')
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
  }

  if (map.getLayer('building')) hide('building')

  if (map.getLayer('building-3d')) {
    if (dark) {
      setPaint('building-3d', 'fill-extrusion-color', [
        'interpolate',
        ['linear'],
        ['coalesce', ['get', 'render_height'], 10],
        0, '#c8cdd4', 20, '#b4bac4', 50, '#9aa3b0', 100, '#838c9a', 200, '#6c7584',
      ])
      setPaint('building-3d', 'fill-extrusion-opacity', 0.92)
    } else {
      setPaint('building-3d', 'fill-extrusion-color', [
        'interpolate',
        ['linear'],
        ['coalesce', ['get', 'render_height'], 10],
        0, '#E9E9E5', 20, '#DDDDD8', 50, '#CDCEC9', 100, '#BCBEBA', 200, '#A9ACA9',
      ])
      setPaint('building-3d', 'fill-extrusion-opacity', 0.95)
    }
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

function applyBasemap(map: MapLibreMap, mode: BasemapMode, dark = false) {
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

  if (!satellite) tuneStyle(map, dark)

  // 동선 헤일로: 위성에서는 어두운 테두리로
  try {
    if (map.getLayer('day-route-halo')) {
      map.setPaintProperty(
        'day-route-halo',
        'line-color',
        satellite || dark ? 'rgba(0, 0, 0, 0.55)' : 'rgba(255, 255, 255, 0.9)',
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
  // 이전 비행·타일 요청을 끊고 짧게 이동 (끊김 완화)
  try {
    map.stop()
  } catch {
    /* ignore */
  }
  const i = opts?.index ?? 0
  const cinematic = !!opts?.cinematic
  const center = map.getCenter()
  const dist =
    Math.hypot(center.lng - place.lng, center.lat - place.lat) * 111_000 // ~meters
  const duration = cinematic
    ? 850
    : Math.round(Math.min(620, Math.max(280, dist * 0.08)))
  map.easeTo({
    center: [place.lng, place.lat],
    zoom: cinematic ? 16.1 : 15.6,
    pitch: mode3d ? (cinematic ? 52 : 48) : 0,
    bearing: mode3d ? -12 + (i % 4) * 8 : map.getBearing(),
    duration,
    essential: true,
    easing: (t) => 1 - Math.pow(1 - t, 2.2),
  })
}

function fitDay(
  map: MapLibreMap,
  day: DayPlan,
  mode3d: boolean,
  reduceMotion: boolean,
  padding?: { top?: number; bottom?: number; left?: number; right?: number },
) {
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
    padding: {
      top: padding?.top ?? 64,
      bottom: padding?.bottom ?? 64,
      left: padding?.left ?? 64,
      right: padding?.right ?? 64,
    },
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
  eager = false,
  darkTheme = false,
  zoomCmd,
  fitPadding,
}: Props) {
  const shellRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const markersRef = useRef<Marker[]>([])
  const orbitRef = useRef<number | null>(null)
  const readyRef = useRef(false)
  const dayRef = useRef(day)
  const placeRef = useRef(place)
  const mode3dRef = useRef(mode3d)
  const basemapRef = useRef(basemap)
  const cinematicRef = useRef(cinematic)
  dayRef.current = day
  placeRef.current = place
  mode3dRef.current = mode3d
  basemapRef.current = basemap
  cinematicRef.current = cinematic

  const [retry, setRetry] = useState(0)
  const [mapEpoch, setMapEpoch] = useState(0)
  const [nearViewport, setNearViewport] = useState(eager)
  const darkRef = useRef(darkTheme)
  darkRef.current = darkTheme
  const fitPadRef = useRef(fitPadding)
  fitPadRef.current = fitPadding
  const onSelectRef = useRef(onSelectPlace)
  onSelectRef.current = onSelectPlace
  const onStatusRef = useRef(onStatus)
  onStatusRef.current = onStatus

  // 지도 섹션이 가까워질 때만 엔진 기동 (eager면 즉시)
  useEffect(() => {
    if (eager) {
      setNearViewport(true)
      return
    }
    const el = shellRef.current
    if (!el) return
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setNearViewport(true)
          io.disconnect()
        }
      },
      { rootMargin: '280px 0px', threshold: 0.01 },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [eager])

  useEffect(() => {
    if (!nearViewport) {
      onStatusRef.current('loading', '지도 준비 중…')
      return
    }
    if (!containerRef.current) return
    let cancelled = false
    readyRef.current = false
    onStatusRef.current('loading')

    const start = placeRef.current ?? dayRef.current.places[0]
    const map = new Map({
      container: containerRef.current,
      style: STYLE_URL,
      center: start ? [start.lng, start.lat] : [139.77, 35.68],
      zoom: 14.8,
      pitch: mode3dRef.current ? 48 : 0,
      bearing: -12,
      maxPitch: 65,
      fadeDuration: 0,
      maxTileCacheSize: 80,
      refreshExpiredTiles: false,
      cancelPendingTileRequestsWhileZooming: true,
      localIdeographFontFamily: '"Noto Sans KR", "Apple SD Gothic Neo", sans-serif',
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
        tuneStyle(map, darkRef.current)
        // 위성은 사용자가 켤 때만 소스 추가
        if (basemapRef.current === 'satellite') applyBasemap(map, 'satellite', darkRef.current)
        else applyBasemap(map, 'map', darkRef.current)
        if (!map.getSource(ROUTE_SOURCE)) {
          map.addSource(ROUTE_SOURCE, {
            type: 'geojson',
            data: lineGeoJSON(dayRef.current.places, 0),
          })
          const dark = darkRef.current
          map.addLayer({
            id: 'day-route-halo',
            type: 'line',
            source: ROUTE_SOURCE,
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: {
              'line-color': dark ? 'rgba(0, 0, 0, 0.45)' : 'rgba(255, 255, 255, 0.85)',
              'line-width': dark ? 10 : 6,
              'line-opacity': 0.8,
            },
          })
          map.addLayer({
            id: 'day-route-line',
            type: 'line',
            source: ROUTE_SOURCE,
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: {
              'line-color': '#e07a5f',
              'line-width': dark ? 4.5 : 3.2,
              'line-opacity': 0.95,
              ...(dark ? {} : { 'line-dasharray': [0.2, 1.6] }),
            },
          })
        }
        finishReady()
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
    }, 10000)

    let resizeQueued = false
    const ro = new ResizeObserver(() => {
      if (cancelled || resizeQueued) return
      resizeQueued = true
      requestAnimationFrame(() => {
        resizeQueued = false
        if (!cancelled) map.resize()
      })
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
  }, [retry, nearViewport])

  // 날짜가 바뀔 때만 마커 재생성
  useEffect(() => {
    const map = mapRef.current
    if (!map || !readyRef.current) return

    markersRef.current.forEach((m) => m.remove())
    markersRef.current = day.places.map((p, i) => {
      const el = document.createElement('button')
      el.type = 'button'
      el.className =
        'map-marker' +
        (p.eat ? ' is-eat' : '') +
        (i === placeIndex ? ' is-active' : '') +
        (i < placeIndex ? ' is-visited' : '')
      el.innerHTML = `<span>${i + 1}</span>`
      el.setAttribute('aria-label', `${i + 1}. ${p.name}`)
      el.addEventListener('click', (ev) => {
        ev.stopPropagation()
        onSelectRef.current(i)
      })
      return new Marker({ element: el, anchor: 'bottom' }).setLngLat([p.lng, p.lat]).addTo(map)
    })

    // 지형은 후지 일정만, 투어 중이 아닐 때 idle 후 적용
    if (day.terrain && !cinematicRef.current) {
      map.once('idle', () => {
        if (mapRef.current === map && !cinematicRef.current) setTerrain(map, true)
      })
    } else {
      setTerrain(map, false)
    }
  }, [day, mapEpoch])

  // 동선·마커 상태만 가볍게 갱신
  useEffect(() => {
    const map = mapRef.current
    if (!map || !readyRef.current) return
    const src = map.getSource(ROUTE_SOURCE) as GeoJSONSource | undefined
    if (src) src.setData(lineGeoJSON(day.places, placeIndex))
    markersRef.current.forEach((m, i) => {
      const el = m.getElement()
      el.classList.toggle('is-active', i === placeIndex)
      el.classList.toggle('is-visited', i < placeIndex)
    })
  }, [day, placeIndex, mapEpoch])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !readyRef.current) return
    applyBasemap(map, basemap, darkTheme)
  }, [basemap, mapEpoch, darkTheme])

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
    map.easeTo({ pitch: mode3d ? 48 : 0, duration: reduceMotion ? 0 : 280 })
  }, [mode3d, reduceMotion, mapEpoch])

  useEffect(() => {
    if (fitRouteKey === 0) return
    const map = mapRef.current
    if (!map || !readyRef.current) return
    const src = map.getSource(ROUTE_SOURCE) as GeoJSONSource | undefined
    if (src) src.setData(lineGeoJSON(day.places))
    fitDay(map, day, mode3d, reduceMotion, fitPadRef.current)
  }, [fitRouteKey, day, mode3d, reduceMotion, mapEpoch])

  useEffect(() => {
    const map = mapRef.current
    if (orbitRef.current) {
      cancelAnimationFrame(orbitRef.current)
      orbitRef.current = null
    }
    if (!orbit || !map || !readyRef.current || reduceMotion) return
    let frame = 0
    const tick = () => {
      frame += 1
      // 2프레임에 한 번만 회전 → GPU/타일 부담 감소
      if (frame % 2 === 0) map.setBearing(map.getBearing() + 0.1)
      orbitRef.current = requestAnimationFrame(tick)
    }
    orbitRef.current = requestAnimationFrame(tick)
    return () => {
      if (orbitRef.current) cancelAnimationFrame(orbitRef.current)
    }
  }, [orbit, reduceMotion, mapEpoch])

  useEffect(() => {
    if (!zoomCmd || zoomCmd.n === 0) return
    const map = mapRef.current
    if (!map || !readyRef.current) return
    const z = map.getZoom() + zoomCmd.dir * 0.7
    map.easeTo({ zoom: Math.max(10, Math.min(18, z)), duration: reduceMotion ? 0 : 220 })
  }, [zoomCmd, reduceMotion])

    // 투어 중에는 지형 끄기 (끊김 원인)
  useEffect(() => {
    const map = mapRef.current
    if (!map || !readyRef.current) return
    if (cinematic) setTerrain(map, false)
    else if (day.terrain) {
      map.once('idle', () => {
        if (mapRef.current === map && !cinematicRef.current) setTerrain(map, true)
      })
    }
  }, [cinematic, day.terrain, mapEpoch])

  return (
    <div className="map-shell" ref={shellRef}>
      {!nearViewport ? (
        <div className="map-shell-fallback">
          <p>지도는 이 근처로 스크롤하면 불러옵니다</p>
        </div>
      ) : (
        <div ref={containerRef} className="map-canvas" role="application" aria-label="도쿄 3D 지도" />
      )}
      <p className="map-disclaimer">
        연결선은 방문 순서이며 실제 도로 경로가 아닙니다. 기본은 일반 지도(빠름), 위성은 필요할 때
        켜 주세요. 건물은 OpenFreeMap 높이 입체입니다.
      </p>
      <button type="button" className="map-retry" onClick={() => setRetry((n) => n + 1)}>
        지도 다시 불러오기
      </button>
    </div>
  )
}
