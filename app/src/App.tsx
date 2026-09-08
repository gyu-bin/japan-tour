import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react'
import { DAYS, TRIP, mapsDirUrl, streetViewUrl } from './data/itinerary'
import { MonFace, monForPlace, monTypeColor } from './data/pocketMons'
import type { BasemapMode } from './components/MapView'
import './App.css'

const MapView = lazy(() =>
  import('./components/MapView').then((m) => ({ default: m.MapView })),
)

type Skin = 'cinema' | 'pocket'

const CAUGHT_KEY = 'tokyo-walk-caught-v1'
const SKIN_KEY = 'tokyo-walk-skin'

function formatDate(iso: string) {
  const [, m, d] = iso.split('-')
  return `${Number(m)}/${Number(d)}`
}

function loadCaught(): Set<string> {
  try {
    const raw = localStorage.getItem(CAUGHT_KEY)
    if (!raw) return new Set()
    return new Set(JSON.parse(raw) as string[])
  } catch {
    return new Set()
  }
}

function loadSkin(): Skin {
  try {
    return localStorage.getItem(SKIN_KEY) === 'pocket' ? 'pocket' : 'cinema'
  } catch {
    return 'cinema'
  }
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
  const [skin, setSkin] = useState<Skin>(loadSkin)
  const [caught, setCaught] = useState<Set<string>>(loadCaught)
  const [catchFlash, setCatchFlash] = useState<{ name: string; cry: string } | null>(null)
  const [parallax, setParallax] = useState({ x: 0, y: 0 })
  const filmRef = useRef<HTMLDivElement>(null)

  const day = DAYS[dayIdx]
  const place = day.places[placeIdx] ?? day.places[0]
  const allPlaces = useMemo(() => DAYS.flatMap((d) => d.places), [])
  const totalStops = allPlaces.length
  const caughtCount = caught.size

  const activeMon = place
    ? monForPlace(place.id, place.name, place.activity, place.eat)
    : null

  useEffect(() => {
    if (reduceMotion) return
    const t = window.setTimeout(() => setEntered(true), 60)
    return () => window.clearTimeout(t)
  }, [reduceMotion])

  useEffect(() => {
    localStorage.setItem(SKIN_KEY, skin)
  }, [skin])

  useEffect(() => {
    localStorage.setItem(CAUGHT_KEY, JSON.stringify([...caught]))
  }, [caught])

  // Filmstrip auto-scroll to active day
  useEffect(() => {
    const track = filmRef.current
    if (!track) return
    const card = track.children[dayIdx] as HTMLElement | undefined
    card?.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', inline: 'center', block: 'nearest' })
  }, [dayIdx, reduceMotion])

  // Pointer parallax (MotionSites Mostar-style)
  useEffect(() => {
    if (reduceMotion) return
    const onMove = (e: PointerEvent) => {
      setParallax({
        x: e.clientX / window.innerWidth - 0.5,
        y: e.clientY / window.innerHeight - 0.5,
      })
    }
    window.addEventListener('pointermove', onMove, { passive: true })
    return () => window.removeEventListener('pointermove', onMove)
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

  const catchPlace = useCallback((placeId: string) => {
    const p = allPlaces.find((x) => x.id === placeId)
    if (!p) return
    const mon = monForPlace(p.id, p.name, p.activity, p.eat)
    setCaught((prev) => {
      if (prev.has(placeId)) return prev
      const next = new Set(prev)
      next.add(placeId)
      return next
    })
    setCatchFlash({ name: mon.nameKo, cry: mon.cry })
    window.setTimeout(() => setCatchFlash(null), 1600)
  }, [allPlaces])

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
      if (e.key === 'c' || e.key === 'C') {
        if (place) catchPlace(place.id)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [day, dayIdx, placeIdx, place, selectDay, selectPlace, catchPlace])

  const watermarkStyle = {
    transform: `translate(calc(-50% + ${parallax.x * 28}px), calc(-50% + ${parallax.y * 18}px))`,
  } as CSSProperties

  return (
    <div
      className={
        'stage' +
        (entered ? ' is-ready' : '') +
        (skin === 'pocket' ? ' theme-pocket' : ' theme-cinema')
      }
    >
      <a className="skip" href="#map-panel">
        지도로 건너뛰기
      </a>

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

      <h1 className="watermark" aria-hidden="true" style={watermarkStyle}>
        {skin === 'pocket' ? 'POCKET' : day.region.split('→')[0]?.trim() || 'Tokyo'}
      </h1>

      <header className="topbar reveal" style={{ '--d': '0ms' } as CSSProperties}>
        <div className="brand-block">
          <p className="eyebrow">{TRIP.travelers}</p>
          <p className="brand-title">
            <span className="en">{skin === 'pocket' ? 'Pocket Walk' : TRIP.titleEn}</span>
            <span className="ko">{skin === 'pocket' ? '포켓 산책 도감' : TRIP.titleKo}</span>
          </p>
          <p className="period">{TRIP.period}</p>
        </div>

        <div className="top-actions liquid-glass" role="toolbar" aria-label="지도 도구">
          <button
            type="button"
            className="skin-toggle"
            aria-pressed={skin === 'pocket'}
            onClick={() => setSkin((s) => (s === 'pocket' ? 'cinema' : 'pocket'))}
          >
            {skin === 'pocket' ? '시네마' : '포켓'}
          </button>
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

        {skin === 'pocket' && (
          <div className="dex-meter" aria-label="도감 진행">
            <div className="dex-meter-bar">
              <span style={{ width: `${(caughtCount / totalStops) * 100}%` }} />
            </div>
            <p>
              도감 {caughtCount}/{totalStops}
            </p>
          </div>
        )}

        <div className="day-story-actions">
          <button
            type="button"
            className="info-chip"
            aria-expanded={infoOpen}
            onClick={() => setInfoOpen((v) => !v)}
          >
            {infoOpen ? '정보 닫기' : '이동 · 먹거리 · 예약'}
          </button>
          {skin === 'pocket' && place && (
            <button
              type="button"
              className={'catch-btn' + (caught.has(place.id) ? ' is-caught' : '')}
              onClick={() => catchPlace(place.id)}
              disabled={caught.has(place.id)}
            >
              {caught.has(place.id) ? '등록됨' : '볼로 잡기 (C)'}
            </button>
          )}
        </div>
      </div>

      <aside
        className="places-dock liquid-glass reveal"
        style={{ '--d': '180ms' } as CSSProperties}
        aria-label={skin === 'pocket' ? '오늘의 도감' : '오늘의 방문 장소'}
      >
        <div className="places-dock-head">
          <h3>{skin === 'pocket' ? 'Dex' : 'Stops'}</h3>
          <span>
            {day.places.filter((p) => caught.has(p.id)).length}/{day.places.length}
          </span>
        </div>
        <ol>
          {day.places.map((p, i) => {
            const mon = monForPlace(p.id, p.name, p.activity, p.eat)
            const isCaught = caught.has(p.id)
            return (
              <li key={p.id}>
                <button
                  type="button"
                  className={'stop' + (i === placeIdx ? ' is-active' : '') + (isCaught ? ' is-caught' : '')}
                  onClick={() => selectPlace(i)}
                  aria-current={i === placeIdx ? 'true' : undefined}
                >
                  {skin === 'pocket' ? (
                    <span className="stop-mon">
                      <MonFace type={mon.type} caught={isCaught} />
                    </span>
                  ) : (
                    <span className={'stop-no' + (p.eat ? ' eat' : '')}>{i + 1}</span>
                  )}
                  <span className="stop-body">
                    <strong>
                      {skin === 'pocket'
                        ? isCaught
                          ? `${mon.nameKo} · ${p.name}`
                          : `??? · ${p.name}`
                        : `${p.time} · ${p.name}`}
                    </strong>
                    {skin === 'pocket' ? (
                      <em style={{ color: isCaught ? monTypeColor(mon.type) : undefined }}>
                        {isCaught ? `${mon.typeKo} · ${p.time}` : '미발견 · 지도를 탐색하세요'}
                      </em>
                    ) : (
                      <>
                        {p.nameJp && <em>{p.nameJp}</em>}
                        <span>{p.activity}</span>
                      </>
                    )}
                  </span>
                </button>
              </li>
            )
          })}
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

      <nav className="filmstrip reveal" style={{ '--d': '240ms' } as CSSProperties} aria-label="날짜 목록">
        <div className="filmstrip-track" ref={filmRef}>
          {DAYS.map((d, i) => (
            <button
              key={d.id}
              type="button"
              className={'film-card' + (i === dayIdx ? ' is-active' : '')}
              onClick={() => selectDay(i)}
              aria-current={i === dayIdx ? 'date' : undefined}
            >
              <span className="film-kicker">
                {skin === 'pocket' ? `Route ${d.no}` : `Day ${d.no}`}
              </span>
              <strong>{d.title}</strong>
              <em>
                {formatDate(d.date)} · {d.weekday} · {d.region}
              </em>
              {skin === 'pocket' && (
                <span className="film-caught">
                  {d.places.filter((p) => caught.has(p.id)).length}/{d.places.length} caught
                </span>
              )}
            </button>
          ))}
        </div>
      </nav>

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
          {activeMon && skin === 'pocket' && (
            <p className="mon-hint">
              현재 스팟 몬: {caught.has(place!.id) ? `${activeMon.nameKo} (${activeMon.typeKo})` : '???'} —
              공식 포켓몬이 아닌 여행용 오리지널 캐릭터입니다.
            </p>
          )}
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
            시네마 레이아웃 · MotionSites 톤. 포켓 모드는 오리지널 도감 테마(비공식). OpenFreeMap /
            Esri / MapLibre · {TRIP.nights}
          </p>
        </section>
      )}

      {catchFlash && (
        <div className="catch-flash" role="status" aria-live="polite">
          <div className="catch-ball" aria-hidden="true" />
          <p className="catch-cry">{catchFlash.cry}</p>
          <p className="catch-name">{catchFlash.name} 을(를) 도감에 등록!</p>
        </div>
      )}
    </div>
  )
}
