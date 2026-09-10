import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { DAYS, TRIP, mapsDirUrl, streetViewUrl } from '../data/itinerary'
import type { BasemapMode } from '../components/MapView'
import './MapPage.css'

const MapView = lazy(() =>
  import('../components/MapView').then((m) => ({ default: m.MapView })),
)

const CHAPTER_EN = [
  'Landing at midnight',
  'Old Tokyo alleys',
  'Where the city meets the sea',
  'Above the Tokyo sky',
  'Sleep under Fuji',
  'Morning farewell to Fuji',
] as const

const CHAPTER_SHORT = [
  'Haneda',
  'Asakusa',
  'Odaiba',
  'Roppongi',
  'Kawaguchiko',
  'Return',
] as const

function formatDate(iso: string) {
  const [, m, d] = iso.split('-')
  return `${Number(m)}/${Number(d)}`
}

export default function MapPage() {
  const reduceMotion = useMemo(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    [],
  )
  const [dayIdx, setDayIdx] = useState(2)
  const [placeIdx, setPlaceIdx] = useState(0)
  const [mode3d, setMode3d] = useState(true)
  const [basemap, setBasemap] = useState<BasemapMode>('map')
  const [orbit, setOrbit] = useState(false)
  const [fitKey, setFitKey] = useState(0)
  const [focusToken, setFocusToken] = useState(0)
  const [zoomCmd, setZoomCmd] = useState({ n: 0, dir: 1 as 1 | -1 })
  const [mapStatus, setMapStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [mapError, setMapError] = useState<string>()
  const [touring, setTouring] = useState(false)
  const [sheetOpen, setSheetOpen] = useState(true)

  const day = DAYS[dayIdx]
  const place = day.places[placeIdx] ?? day.places[0]

  const selectDay = useCallback((i: number) => {
    setDayIdx(i)
    setPlaceIdx(0)
    setOrbit(false)
    setTouring(false)
    setFocusToken((t) => t + 1)
  }, [])

  const selectPlace = useCallback((i: number) => {
    setPlaceIdx(i)
    setFocusToken((t) => t + 1)
  }, [])

  const toggleTour = useCallback(() => {
    setTouring((v) => {
      if (!v) {
        setOrbit(false)
        setMode3d(true)
        setFocusToken((t) => t + 1)
      }
      return !v
    })
  }, [])

  useEffect(() => {
    if (!touring) return
    if (reduceMotion) {
      setTouring(false)
      return
    }
    const wait = placeIdx === 0 ? 2000 : 2600
    const t = window.setTimeout(() => {
      if (placeIdx < day.places.length - 1) selectPlace(placeIdx + 1)
      else if (dayIdx < DAYS.length - 1) selectDay(dayIdx + 1)
      else {
        setTouring(false)
        setFitKey((k) => k + 1)
      }
    }, wait)
    return () => window.clearTimeout(t)
  }, [touring, placeIdx, dayIdx, day.places.length, reduceMotion, selectPlace, selectDay])

  const onStatus = useCallback((s: 'loading' | 'ready' | 'error', message?: string) => {
    setMapStatus(s)
    setMapError(message)
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (e.key === 'ArrowRight') {
        e.preventDefault()
        if (placeIdx < day.places.length - 1) selectPlace(placeIdx + 1)
        else if (dayIdx < DAYS.length - 1) selectDay(dayIdx + 1)
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        if (placeIdx > 0) selectPlace(placeIdx - 1)
        else if (dayIdx > 0) selectDay(dayIdx - 1)
      }
      if (e.key === ' ') {
        e.preventDefault()
        toggleTour()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [day, dayIdx, placeIdx, selectDay, selectPlace, toggleTour])

  const placeTag = place?.stay ? 'STAY' : place?.eat ? 'EAT' : 'STOP'

  return (
    <div className="rmap">
      <div className="rmap-scene">
        {(mapStatus === 'loading' || mapStatus === 'error') && (
          <div className={'rmap-status is-' + mapStatus} role="status">
            {mapStatus === 'loading' && <p>지도를 불러오는 중…</p>}
            {mapStatus === 'error' && <p>{mapError ?? '지도를 표시할 수 없습니다.'}</p>}
          </div>
        )}
        <Suspense fallback={<div className="rmap-status is-loading"><p>지도 엔진 준비 중…</p></div>}>
          <MapView
            day={day}
            place={place}
            placeIndex={placeIdx}
            mode3d={mode3d}
            basemap={basemap}
            orbit={orbit}
            fitRouteKey={fitKey}
            focusToken={focusToken}
            cinematic={touring}
            onSelectPlace={selectPlace}
            onStatus={onStatus}
            reduceMotion={reduceMotion}
            eager
            darkTheme
            zoomCmd={zoomCmd}
            fitPadding={{ top: 80, bottom: 120, left: 380, right: 48 }}
          />
        </Suspense>
      </div>

      <header className="rmap-top">
        <div className="rmap-brand">
          <p className="en">{TRIP.titleEn}</p>
          <p className="ko">{TRIP.titleKo}</p>
          <p className="tag">A LITTLE WORLD. A LONG MEMORY.</p>
        </div>
        <div className="rmap-chapter-title">
          <p className="ch">CHAPTER {day.no} / 06</p>
          <h1>{CHAPTER_EN[dayIdx]}</h1>
        </div>
        <div className="rmap-top-actions">
          <button type="button" className="ghost" onClick={toggleTour} aria-pressed={touring}>
            {touring ? '투어 정지' : 'EXPLORE'}
          </button>
          <a className="pill alt" href="/pokemon.html">픽셀 ↗</a>
          <a className="pill alt" href="/pokemon2.html">골드 ↗</a>
          <Link className="pill" to="/">디오라마 ↗</Link>
        </div>
      </header>

      <aside className={'rmap-side' + (sheetOpen ? ' open' : '')}>
        <button type="button" className="rmap-side-toggle" onClick={() => setSheetOpen((v) => !v)}>
          {sheetOpen ? '접기' : '일정'}
        </button>
        <div className="rmap-side-body">
          <div className="rmap-day-head">
            <p className="day-kicker">DAY {day.no}</p>
            <h2>{day.title}</h2>
            <p className="region">{day.region} · {formatDate(day.date)} {day.weekday}</p>
          </div>

          <ol className="rmap-stops">
            {day.places.map((p, i) => (
              <li key={p.id}>
                <button
                  type="button"
                  className={
                    'rmap-stop' +
                    (i === placeIdx ? ' on' : '') +
                    (p.eat ? ' eat' : '') +
                    (p.stay ? ' stay' : '')
                  }
                  onClick={() => {
                    setTouring(false)
                    selectPlace(i)
                  }}
                >
                  <span className="ix">{i + 1}</span>
                  <span className="meta">
                    <span className="tm">{p.time}</span>
                    <span className="nm">{p.name}</span>
                  </span>
                </button>
              </li>
            ))}
          </ol>

          {place && (
            <article className="rmap-card">
              <p className="place">
                PLACE {String(placeIdx + 1).padStart(2, '0')} · {placeTag}
              </p>
              <h3>{place.name}</h3>
              {place.nameJp && <p className="jp">{place.nameJp}</p>}
              <p className="body">{place.activity}</p>
              <div className="rmap-card-links">
                <a href={mapsDirUrl(place.lat, place.lng, place.name)} target="_blank" rel="noopener noreferrer">
                  Maps
                </a>
                <a href={streetViewUrl(place.lat, place.lng)} target="_blank" rel="noopener noreferrer">
                  거리뷰
                </a>
              </div>
            </article>
          )}
        </div>
      </aside>

      <nav className="rmap-chapters" aria-label="일차 선택">
        {DAYS.map((d, i) => (
          <button
            key={d.id}
            type="button"
            className={'rmap-ch' + (i === dayIdx ? ' on' : '')}
            onClick={() => selectDay(i)}
          >
            <span className="no">CHAPTER {d.no}</span>
            <span className="nm">{CHAPTER_SHORT[i]}</span>
            <span className="dt">{formatDate(d.date)}</span>
          </button>
        ))}
      </nav>

      <div className="rmap-ctrl">
        <button type="button" onClick={() => setZoomCmd((c) => ({ n: c.n + 1, dir: 1 }))}>＋</button>
        <button type="button" onClick={() => setZoomCmd((c) => ({ n: c.n + 1, dir: -1 }))}>−</button>
        <button type="button" onClick={() => setFitKey((k) => k + 1)}>전체 보기</button>
        <button type="button" aria-pressed={orbit} onClick={() => setOrbit((v) => !v)}>
          {orbit ? '움직임 멈춤' : '천천히 회전'}
        </button>
        <button type="button" aria-pressed={mode3d} onClick={() => setMode3d((v) => !v)}>
          {mode3d ? '3D' : '2D'}
        </button>
        <button
          type="button"
          aria-pressed={basemap === 'satellite'}
          onClick={() => setBasemap((v) => (v === 'satellite' ? 'map' : 'satellite'))}
        >
          {basemap === 'satellite' ? '위성' : '일반'}
        </button>
      </div>

      <p className="rmap-help">드래그 이동 · 우클릭 회전 · 휠 확대 · ←→ 스팟 · Space 투어</p>
    </div>
  )
}
