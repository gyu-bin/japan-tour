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

const HERO =
  'https://images.higgs.ai/?default=1&output=webp&url=https%3A%2F%2Fd8j0ntlcm91z4.cloudfront.net%2Fuser_38xzZboKViGWJOttwIXH07lWA1P%2Fhf_20260704_101902_e8f0f37b-18b7-4c14-bb5c-99f0724d2646.png&w=1280&q=85'

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
  const [daysOpen, setDaysOpen] = useState(false)
  const [entered, setEntered] = useState(reduceMotion)

  const day = DAYS[dayIdx]
  const place = day.places[placeIdx] ?? day.places[0]

  useEffect(() => {
    if (reduceMotion) return
    const t = window.setTimeout(() => setEntered(true), 80)
    return () => window.clearTimeout(t)
  }, [reduceMotion])

  const selectDay = useCallback((i: number) => {
    setDayIdx(i)
    setPlaceIdx(0)
    setOrbit(false)
    setFocusToken((t) => t + 1)
    setDaysOpen(false)
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
    <div className={'app' + (entered ? ' is-ready' : '')}>
      <a className="skip" href="#map-panel">
        지도로 건너뛰기
      </a>

      <aside className="sidebar" aria-label="여행 개요와 날짜">
        <div className="brand reveal" style={{ '--d': '0ms' } as CSSProperties}>
          <p className="eyebrow">{TRIP.travelers}</p>
          <h1 className="title-en">{TRIP.titleEn}</h1>
          <h2 className="title-ko">{TRIP.titleKo}</h2>
          <p className="period">{TRIP.period}</p>
          <p className="nights">{TRIP.nights}</p>
        </div>

        <figure className="hero-card reveal" style={{ '--d': '120ms' } as CSSProperties}>
          <img src={HERO} alt="도쿄 야경" width={420} height={280} loading="eager" />
          <div className="hero-fade" aria-hidden="true" />
          <span className="liquid-glass hero-pill">{DAYS.length} days</span>
          <strong className="hero-word" aria-hidden="true">
            Tokyo
          </strong>
          <figcaption>MotionSites · Travel Journal 톤</figcaption>
        </figure>

        <button
          type="button"
          className="days-toggle liquid-glass"
          aria-expanded={daysOpen}
          onClick={() => setDaysOpen((v) => !v)}
        >
          {daysOpen ? '날짜 목록 닫기' : '6일 일정 열기'}
        </button>

        <nav className={'day-list' + (daysOpen ? ' is-open' : '')} aria-label="날짜 목록">
          {DAYS.map((d, i) => (
            <button
              key={d.id}
              type="button"
              className={
                'day-stamp reveal' + (i === dayIdx ? ' is-active' : '')
              }
              style={{ '--d': `${180 + i * 70}ms` } as CSSProperties}
              onClick={() => selectDay(i)}
              aria-current={i === dayIdx ? 'date' : undefined}
            >
              <span className="stamp-kicker">Day {d.no}</span>
              <strong className="stamp-title">{d.title}</strong>
              <em className="stamp-meta">
                {formatDate(d.date)} · {d.weekday}
              </em>
            </button>
          ))}
        </nav>

        <p className="sidebar-note">{TRIP.note}</p>
        <p className="legacy-link">
          <a href="https://github.com/gyu-bin/japan-tour">저장소 · 디오라마 원본 포함</a>
        </p>
      </aside>

      <main className="main">
        <header className="day-head reveal" style={{ '--d': '200ms' } as CSSProperties}>
          <div className="day-head-text">
            <p className="day-kicker">
              <span className="tile-date">
                {formatDate(day.date)} {day.weekday}
              </span>
              <span className="tile-region">{day.region}</span>
            </p>
            <h2>{day.title}</h2>
            <p className="intro">{day.intro}</p>
          </div>
          <div className="day-nav">
            <button
              type="button"
              className="liquid-glass"
              disabled={dayIdx === 0}
              onClick={() => selectDay(dayIdx - 1)}
            >
              이전 날
            </button>
            <button
              type="button"
              className="liquid-glass"
              disabled={dayIdx === DAYS.length - 1}
              onClick={() => selectDay(dayIdx + 1)}
            >
              다음 날
            </button>
          </div>
        </header>

        <section id="map-panel" className="map-panel">
          <div className="map-toolbar liquid-glass" role="toolbar" aria-label="지도 도구">
            <button type="button" onClick={() => setFitKey((k) => k + 1)}>
              오늘 동선
            </button>
            <button
              type="button"
              aria-pressed={basemap === 'satellite'}
              onClick={() =>
                setBasemap((v) => (v === 'satellite' ? 'map' : 'satellite'))
              }
            >
              {basemap === 'satellite' ? '위성' : '일반'}
            </button>
            <button
              type="button"
              aria-pressed={mode3d}
              onClick={() => setMode3d((v) => !v)}
            >
              {mode3d ? '3D' : '2D'}
            </button>
            <button
              type="button"
              aria-pressed={orbit}
              onClick={() => setOrbit((v) => !v)}
            >
              {orbit ? '멈추기' : '둘러보기'}
            </button>
            {place && (
              <a
                className="btn-link"
                href={streetViewUrl(place.lat, place.lng)}
                target="_blank"
                rel="noopener noreferrer"
              >
                실제 거리 보기
              </a>
            )}
          </div>

          <div className="map-frame">
            {(mapStatus === 'loading' || mapStatus === 'error') && (
              <div className={'map-status is-' + mapStatus} role="status">
                {mapStatus === 'loading' && <p>지도를 불러오는 중…</p>}
                {mapStatus === 'error' && (
                  <>
                    <p>{mapError ?? '지도를 표시할 수 없습니다.'}</p>
                    <p className="hint">아래 ‘지도 다시 불러오기’를 눌러 주세요.</p>
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
        </section>

        <div className="lower">
          <section className="places" aria-label="오늘의 방문 장소">
            <h3>방문 장소</h3>
            <ol>
              {day.places.map((p, i) => (
                <li key={p.id}>
                  <button
                    type="button"
                    className={'place-row' + (i === placeIdx ? ' is-active' : '')}
                    onClick={() => selectPlace(i)}
                    aria-current={i === placeIdx ? 'true' : undefined}
                  >
                    <span className={'num' + (p.eat ? ' eat' : '')}>{i + 1}</span>
                    <span className="place-body">
                      <strong>
                        {p.time} · {p.name}
                      </strong>
                      {p.nameJp && <span className="jp">{p.nameJp}</span>}
                      <span className="act">{p.activity}</span>
                      {p.booking && p.booking !== 'none' && (
                        <span className={'book-tag is-' + p.booking}>
                          {p.booking === 'confirmed' ? '예약 확정' : '추천 시각'}
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          </section>

          <section className="info" aria-label="여행 정보">
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
                {place?.hoursNote && <p className="muted">{place.name}: {place.hoursNote}</p>}
                {place?.bookingNote && <p className="muted">{place.bookingNote}</p>}
              </article>
              <article>
                <h3>비 오는 날</h3>
                <p>{day.rainAlt}</p>
              </article>
            </div>
            <div className="links">
              <h3>공식 링크</h3>
              <ul>
                {day.links.map((l) => (
                  <li key={l.url}>
                    <a href={l.url} target="_blank" rel="noopener noreferrer">
                      {l.label}
                    </a>
                  </li>
                ))}
                {place && (
                  <li>
                    <a
                      href={mapsDirUrl(place.lat, place.lng, place.name)}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Maps 길찾기 · {place.name}
                    </a>
                  </li>
                )}
              </ul>
            </div>
            <footer className="credits">
              <p>
                디자인 · MotionSites (Travel Journal / Mostar Guide / Place Saver). 지도 ·
                OpenFreeMap · MapLibre. 위성 · Esri World Imagery. 지형 · Mapzen Terrarium.
              </p>
              <p>
                Mapbox·Google 실사 3D는 API 키·결제가 필요합니다. 현재 빌드는 키 없이
                OpenFreeMap 높이 입체만 사용합니다.
              </p>
            </footer>
          </section>
        </div>
      </main>
    </div>
  )
}
