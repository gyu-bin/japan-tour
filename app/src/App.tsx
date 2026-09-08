import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
} from 'react'
import { DAYS, TRIP, mapsDirUrl, streetViewUrl } from './data/itinerary'
import type { BasemapMode } from './components/MapView'
import './App.css'

const MapView = lazy(() =>
  import('./components/MapView').then((m) => ({ default: m.MapView })),
)

function formatDate(iso: string) {
  const [, m, d] = iso.split('-')
  return `${Number(m)}/${Number(d)}`
}

export default function App() {
  const reduceMotion = useMemo(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    [],
  )
  const [dayIdx, setDayIdx] = useState(1)
  const [placeIdx, setPlaceIdx] = useState(0)
  const [mode3d, setMode3d] = useState(true)
  const [basemap, setBasemap] = useState<BasemapMode>('satellite')
  const [orbit, setOrbit] = useState(false)
  const [fitKey, setFitKey] = useState(0)
  const [focusToken, setFocusToken] = useState(0)
  const [mapStatus, setMapStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [mapError, setMapError] = useState<string>()
  const [infoOpen, setInfoOpen] = useState(false)
  const [entered, setEntered] = useState(reduceMotion)

  const day = DAYS[dayIdx]
  const place = day.places[placeIdx] ?? day.places[0]

  useEffect(() => {
    if (reduceMotion) return
    const t = window.setTimeout(() => setEntered(true), 60)
    return () => window.clearTimeout(t)
  }, [reduceMotion])

  const selectDay = useCallback((i: number) => {
    setDayIdx(i)
    setPlaceIdx(0)
    setOrbit(false)
    setFocusToken((t) => t + 1)
  }, [])

  const selectPlace = useCallback((i: number) => {
    setPlaceIdx(i)
    setFocusToken((t) => t + 1)
  }, [])

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
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        selectDay(Math.min(dayIdx + 1, DAYS.length - 1))
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        selectDay(Math.max(dayIdx - 1, 0))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [day, dayIdx, placeIdx, selectDay, selectPlace])

  return (
    <div className={'stage' + (entered ? ' is-ready' : '')}>
      <a className="skip" href="#map-panel">
        지도로 건너뛰기
      </a>

      {/* Full-bleed map — the whole page is the map */}
      <div id="map-panel" className="map-bleed" aria-label="여행 지도">
        {(mapStatus === 'loading' || mapStatus === 'error') && (
          <div className={'map-status is-' + mapStatus} role="status">
            {mapStatus === 'loading' && <p>지도를 불러오는 중…</p>}
            {mapStatus === 'error' && (
              <>
                <p>{mapError ?? '지도를 표시할 수 없습니다.'}</p>
                <p className="hint">다시 불러오기를 눌러 주세요.</p>
              </>
            )}
          </div>
        )}
        <Suspense
          fallback={
            <div className="map-shell map-shell-fallback">
              <p>지도 엔진 준비 중…</p>
            </div>
          }
        >
          <MapView
            day={day}
            place={place}
            placeIndex={placeIdx}
            mode3d={mode3d}
            basemap={basemap}
            orbit={orbit}
            fitRouteKey={fitKey}
            focusToken={focusToken}
            onSelectPlace={selectPlace}
            onStatus={onStatus}
            reduceMotion={reduceMotion}
          />
        </Suspense>
      </div>

      {/* Giant watermark title — Travel Journal / Mostar scale */}
      <h1 className="watermark" aria-hidden="true">
        {day.region.split('→')[0]?.trim() || 'Tokyo'}
      </h1>

      {/* Top chrome */}
      <header className="topbar reveal" style={{ '--d': '0ms' } as CSSProperties}>
        <div className="brand-block">
          <p className="eyebrow">{TRIP.travelers}</p>
          <p className="brand-title">
            <span className="en">{TRIP.titleEn}</span>
            <span className="ko">{TRIP.titleKo}</span>
          </p>
          <p className="period">{TRIP.period}</p>
        </div>

        <div className="top-actions liquid-glass" role="toolbar" aria-label="지도 도구">
          <button type="button" onClick={() => setFitKey((k) => k + 1)}>
            동선
          </button>
          <button
            type="button"
            aria-pressed={basemap === 'satellite'}
            onClick={() => setBasemap((v) => (v === 'satellite' ? 'map' : 'satellite'))}
          >
            {basemap === 'satellite' ? '위성' : '일반'}
          </button>
          <button type="button" aria-pressed={mode3d} onClick={() => setMode3d((v) => !v)}>
            {mode3d ? '3D' : '2D'}
          </button>
          <button type="button" aria-pressed={orbit} onClick={() => setOrbit((v) => !v)}>
            {orbit ? '멈춤' : '회전'}
          </button>
          {place && (
            <a
              className="btn-link"
              href={streetViewUrl(place.lat, place.lng)}
              target="_blank"
              rel="noopener noreferrer"
            >
              거리뷰
            </a>
          )}
        </div>
      </header>

      {/* Day story chip */}
      <div className="day-story liquid-glass reveal" style={{ '--d': '120ms' } as CSSProperties}>
        <div className="day-story-nav">
          <button
            type="button"
            disabled={dayIdx === 0}
            onClick={() => selectDay(dayIdx - 1)}
            aria-label="이전 날"
          >
            ←
          </button>
          <button
            type="button"
            disabled={dayIdx === DAYS.length - 1}
            onClick={() => selectDay(dayIdx + 1)}
            aria-label="다음 날"
          >
            →
          </button>
        </div>
        <p className="day-story-kicker">
          Day {day.no} · {formatDate(day.date)} {day.weekday}
        </p>
        <h2>{day.title}</h2>
        <p className="day-story-intro">{day.intro}</p>
        <button
          type="button"
          className="info-chip"
          aria-expanded={infoOpen}
          onClick={() => setInfoOpen((v) => !v)}
        >
          {infoOpen ? '정보 닫기' : '이동 · 먹거리 · 예약'}
        </button>
      </div>

      {/* Places dock — right floating */}
      <aside
        className="places-dock liquid-glass reveal"
        style={{ '--d': '180ms' } as CSSProperties}
        aria-label="오늘의 방문 장소"
      >
        <div className="places-dock-head">
          <h3>Stops</h3>
          <span>{day.places.length}</span>
        </div>
        <ol>
          {day.places.map((p, i) => (
            <li key={p.id}>
              <button
                type="button"
                className={'stop' + (i === placeIdx ? ' is-active' : '')}
                onClick={() => selectPlace(i)}
                aria-current={i === placeIdx ? 'true' : undefined}
              >
                <span className={'stop-no' + (p.eat ? ' eat' : '')}>{i + 1}</span>
                <span className="stop-body">
                  <strong>
                    {p.time} · {p.name}
                  </strong>
                  {p.nameJp && <em>{p.nameJp}</em>}
                  <span>{p.activity}</span>
                </span>
              </button>
            </li>
          ))}
        </ol>
        {place && (
          <a
            className="maps-link"
            href={mapsDirUrl(place.lat, place.lng, place.name)}
            target="_blank"
            rel="noopener noreferrer"
          >
            Maps · {place.name}
          </a>
        )}
      </aside>

      {/* Horizontal day filmstrip — Mostar sights slider */}
      <nav className="filmstrip reveal" style={{ '--d': '240ms' } as CSSProperties} aria-label="날짜 목록">
        <div className="filmstrip-track">
          {DAYS.map((d, i) => (
            <button
              key={d.id}
              type="button"
              className={'film-card' + (i === dayIdx ? ' is-active' : '')}
              onClick={() => selectDay(i)}
              aria-current={i === dayIdx ? 'date' : undefined}
            >
              <span className="film-kicker">Day {d.no}</span>
              <strong>{d.title}</strong>
              <em>
                {formatDate(d.date)} · {d.weekday} · {d.region}
              </em>
            </button>
          ))}
        </div>
      </nav>

      {/* Expandable info sheet */}
      {infoOpen && (
        <section className="info-sheet liquid-glass" aria-label="여행 정보">
          <div className="info-grid">
            <article>
              <h3>이동</h3>
              <p>{day.transport}</p>
            </article>
            <article>
              <h3>먹거리</h3>
              <ul>
                {day.food.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            </article>
            <article>
              <h3>예약 · 운영</h3>
              <p>{day.booking}</p>
              {place?.hoursNote && (
                <p className="muted">
                  {place.name}: {place.hoursNote}
                </p>
              )}
            </article>
            <article>
              <h3>비 오는 날</h3>
              <p>{day.rainAlt}</p>
            </article>
          </div>
          <ul className="info-links">
            {day.links.map((l) => (
              <li key={l.url}>
                <a href={l.url} target="_blank" rel="noopener noreferrer">
                  {l.label}
                </a>
              </li>
            ))}
          </ul>
          <p className="credits">
            MotionSites 레이아웃 재구성 · OpenFreeMap / Esri / MapLibre · {TRIP.nights}
          </p>
        </section>
      )}
    </div>
  )
}
