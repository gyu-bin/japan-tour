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

const HERO_SLIDES = [
  {
    src: 'https://images.unsplash.com/photo-1540959733332-eab4deabeeaf?auto=format&fit=crop&w=1800&q=80',
    label: '도쿄 야경',
    pos: 'center 30%',
  },
  {
    src: 'https://images.unsplash.com/photo-1545569341-9eb8b30979d9?auto=format&fit=crop&w=1800&q=80',
    label: '센소지 · 아사쿠사',
    pos: 'center 40%',
  },
  {
    src: 'https://images.unsplash.com/photo-1513407030348-c983a97b98d8?auto=format&fit=crop&w=1800&q=80',
    label: '도쿄타워',
    pos: 'center 25%',
  },
  {
    src: 'https://images.unsplash.com/photo-1503899036084-c55cdd92da26?auto=format&fit=crop&w=1800&q=80',
    label: '시부야 스크램블',
    pos: 'center 45%',
  },
  {
    src: 'https://images.unsplash.com/photo-1536098561742-ca998e48cbcc?auto=format&fit=crop&w=1800&q=80',
    label: '신주쿠 네온',
    pos: 'center 35%',
  },
  {
    src: 'https://images.unsplash.com/photo-1524413840807-0c3cb6fa808d?auto=format&fit=crop&w=1800&q=80',
    label: '메이지 신궁 숲길',
    pos: 'center 40%',
  },
] as const

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
  const [basemap, setBasemap] = useState<BasemapMode>('map')
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
  const [touring, setTouring] = useState(false)
  const [spotlightKey, setSpotlightKey] = useState(0)
  const [heroIdx, setHeroIdx] = useState(0)
  const mapSectionRef = useRef<HTMLElement>(null)
  const daysSectionRef = useRef<HTMLElement>(null)

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

  // Hero landmark slideshow
  useEffect(() => {
    if (reduceMotion) return
    const id = window.setInterval(() => {
      setHeroIdx((i) => (i + 1) % HERO_SLIDES.length)
    }, 5200)
    return () => window.clearInterval(id)
  }, [reduceMotion])

  useEffect(() => {
    localStorage.setItem(SKIN_KEY, skin)
  }, [skin])

  useEffect(() => {
    localStorage.setItem(CAUGHT_KEY, JSON.stringify([...caught]))
  }, [caught])

  const scrollToMap = useCallback(() => {
    mapSectionRef.current?.scrollIntoView({
      behavior: reduceMotion ? 'auto' : 'smooth',
      block: 'start',
    })
  }, [reduceMotion])

  const scrollToDays = useCallback(() => {
    daysSectionRef.current?.scrollIntoView({
      behavior: reduceMotion ? 'auto' : 'smooth',
      block: 'start',
    })
  }, [reduceMotion])

  const selectDay = useCallback(
    (i: number, opts?: { scrollMap?: boolean }) => {
      setDayIdx(i)
      setPlaceIdx(0)
      setOrbit(false)
      setFocusToken((t) => t + 1)
      setSpotlightKey((k) => k + 1)
      if (opts?.scrollMap) scrollToMap()
    },
    [scrollToMap],
  )

  const selectPlace = useCallback((i: number) => {
    setPlaceIdx(i)
    setFocusToken((t) => t + 1)
    setSpotlightKey((k) => k + 1)
  }, [])

  const toggleTour = useCallback(() => {
    setTouring((v) => {
      if (!v) {
        setOrbit(false)
        setMode3d(true)
        setFocusToken((t) => t + 1)
        setSpotlightKey((k) => k + 1)
        scrollToMap()
      }
      return !v
    })
  }, [scrollToMap])

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

  const catchPlace = useCallback(
    (placeId: string) => {
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
    },
    [allPlaces],
  )

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
      if ((e.key === 'c' || e.key === 'C') && skin === 'pocket' && place) catchPlace(place.id)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [day, dayIdx, placeIdx, place, skin, selectDay, selectPlace, catchPlace, toggleTour])

  return (
    <div
      className={
        'site' +
        (entered ? ' is-ready' : '') +
        (skin === 'pocket' ? ' theme-pocket' : ' theme-cinema')
      }
    >
      <a className="skip" href="#map">
        지도로 건너뛰기
      </a>

      {/* —— Site nav —— */}
      <header className="site-nav reveal" style={{ '--d': '0ms' } as CSSProperties}>
        <a className="nav-brand" href="#top">
          <span className="en">{skin === 'pocket' ? 'Pocket Walk' : TRIP.titleEn}</span>
          <span className="ko">{skin === 'pocket' ? '포켓 산책' : TRIP.titleKo}</span>
        </a>
        <nav className="nav-links" aria-label="주요 메뉴">
          <button type="button" onClick={scrollToDays}>
            일정
          </button>
          <button type="button" onClick={scrollToMap}>
            지도
          </button>
          <button
            type="button"
            className="skin-toggle"
            aria-pressed={skin === 'pocket'}
            onClick={() => setSkin((s) => (s === 'pocket' ? 'cinema' : 'pocket'))}
          >
            {skin === 'pocket' ? '시네마' : '포켓'}
          </button>
        </nav>
      </header>

      {/* —— Hero —— */}
      <section id="top" className="hero" aria-label="소개">
        <div className="hero-media" aria-hidden="true">
          {HERO_SLIDES.map((slide, i) => (
            <img
              key={slide.src}
              src={slide.src}
              alt=""
              className={i === heroIdx ? 'is-active' : undefined}
              style={{ objectPosition: slide.pos }}
              loading={i === 0 ? 'eager' : 'lazy'}
            />
          ))}
          <div className="hero-shade" />
        </div>
        <div className="hero-copy reveal" style={{ '--d': '80ms' } as CSSProperties}>
          <p className="hero-eyebrow">{TRIP.travelers} · {TRIP.nights}</p>
          <h1>
            <span className="hero-en">{TRIP.titleEn}</span>
            <span className="hero-ko">{TRIP.titleKo}</span>
          </h1>
          <p className="hero-lead">
            {TRIP.period}. 날짜를 고르고, 지도에서 동선을 미리 걸어보세요.
          </p>
          <div className="hero-cta">
            <button type="button" className="btn-primary" onClick={scrollToMap}>
              지도에서 둘러보기
            </button>
            <button type="button" className="btn-ghost" onClick={scrollToDays}>
              6일 일정 보기
            </button>
          </div>
          <ul className="hero-tags" aria-label="하이라이트">
            <li>OpenFreeMap 3D</li>
            <li>위성 · Esri</li>
            <li>투어 재생</li>
            {skin === 'pocket' && <li>도감 {caughtCount}/{totalStops}</li>}
          </ul>
          <div className="hero-slide-ui" aria-label="배경 랜드마크">
            <p className="hero-slide-label">{HERO_SLIDES[heroIdx].label}</p>
            <div className="hero-dots" role="tablist">
              {HERO_SLIDES.map((slide, i) => (
                <button
                  key={slide.src}
                  type="button"
                  role="tab"
                  aria-selected={i === heroIdx}
                  aria-label={slide.label}
                  className={i === heroIdx ? 'is-active' : undefined}
                  onClick={() => setHeroIdx(i)}
                />
              ))}
            </div>
          </div>
        </div>
        <p className="hero-scroll" aria-hidden="true">
          Scroll
        </p>
      </section>

      {/* —— Days —— */}
      <section
        id="days"
        ref={daysSectionRef}
        className="section days-section"
        aria-label="여행 일정"
      >
        <div className="section-head reveal" style={{ '--d': '60ms' } as CSSProperties}>
          <p className="section-kicker">Itinerary</p>
          <h2>6일의 발자국</h2>
          <p>카드를 누르면 그날 지도로 이동합니다.</p>
        </div>
        <div className="days-grid">
          {DAYS.map((d, i) => (
            <button
              key={d.id}
              type="button"
              className={'day-card reveal' + (i === dayIdx ? ' is-active' : '')}
              style={{ '--d': `${100 + i * 70}ms` } as CSSProperties}
              onClick={() => {
                setTouring(false)
                selectDay(i, { scrollMap: true })
              }}
              aria-current={i === dayIdx ? 'date' : undefined}
            >
              <span className="day-card-kicker">
                Day {d.no} · {formatDate(d.date)} {d.weekday}
              </span>
              <strong>{d.title}</strong>
              <em>{d.region}</em>
              <span className="day-card-meta">{d.places.length} stops</span>
            </button>
          ))}
        </div>
      </section>

      {/* —— Map stage —— */}
      <section id="map" ref={mapSectionRef} className="section map-section" aria-label="지도">
        <div className="section-head map-section-head">
          <div>
            <p className="section-kicker">Explore</p>
            <h2>
              Day {day.no} · {day.title}
            </h2>
            <p>{day.intro}</p>
          </div>
          <div className="map-tools liquid-glass" role="toolbar" aria-label="지도 도구">
            <button type="button" aria-pressed={touring} onClick={toggleTour}>
              {touring ? '투어 정지' : '투어 재생'}
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
        </div>

        <div className="map-stage">
          <div className="map-bleed" id="map-panel">
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
                cinematic={touring}
                onSelectPlace={selectPlace}
                onStatus={onStatus}
                reduceMotion={reduceMotion}
              />
            </Suspense>
          </div>

          {place && (
            <div className="spotlight liquid-glass" key={spotlightKey} role="status">
              <div className="spotlight-top">
                <span className="spotlight-idx">
                  {placeIdx + 1}/{day.places.length}
                </span>
                <span className="spotlight-time">{place.time}</span>
                {touring && <span className="spotlight-live">LIVE TOUR</span>}
              </div>
              <h3>{place.name}</h3>
              {place.nameJp && <p className="spotlight-jp">{place.nameJp}</p>}
              <p className="spotlight-act">{place.activity}</p>
              <div className="spotlight-rail" aria-hidden="true">
                <span
                  style={{
                    width: `${((placeIdx + 1) / Math.max(day.places.length, 1)) * 100}%`,
                  }}
                />
              </div>
            </div>
          )}

          <div className="timeline liquid-glass" role="group" aria-label="오늘 일정 타임라인">
            <button
              type="button"
              className="timeline-play"
              aria-pressed={touring}
              onClick={toggleTour}
            >
              {touring ? '❚❚' : '▶'}
            </button>
            <div className="timeline-track">
              <div
                className="timeline-fill"
                style={{
                  width: `${(placeIdx / Math.max(day.places.length - 1, 1)) * 100}%`,
                }}
              />
              {day.places.map((p, i) => (
                <button
                  key={p.id}
                  type="button"
                  className={
                    'timeline-dot' +
                    (i === placeIdx ? ' is-active' : '') +
                    (i < placeIdx ? ' is-done' : '')
                  }
                  style={{ left: `${(i / Math.max(day.places.length - 1, 1)) * 100}%` }}
                  onClick={() => {
                    setTouring(false)
                    selectPlace(i)
                  }}
                  aria-label={`${p.time} ${p.name}`}
                  title={`${p.time} · ${p.name}`}
                />
              ))}
            </div>
          </div>
        </div>

        <div className="map-lower">
          <aside className="places-dock liquid-glass" aria-label="방문 장소">
            <div className="places-dock-head">
              <h3>{skin === 'pocket' ? 'Dex' : 'Stops'}</h3>
              <span>
                {day.places.filter((p) => caught.has(p.id)).length}/{day.places.length}
              </span>
            </div>
            {skin === 'pocket' && (
              <div className="dex-meter">
                <div className="dex-meter-bar">
                  <span style={{ width: `${(caughtCount / totalStops) * 100}%` }} />
                </div>
                <p>
                  전체 도감 {caughtCount}/{totalStops}
                </p>
              </div>
            )}
            <ol>
              {day.places.map((p, i) => {
                const mon = monForPlace(p.id, p.name, p.activity, p.eat)
                const isCaught = caught.has(p.id)
                return (
                  <li key={p.id}>
                    <button
                      type="button"
                      className={
                        'stop' +
                        (i === placeIdx ? ' is-active' : '') +
                        (isCaught ? ' is-caught' : '')
                      }
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
                            {isCaught ? `${mon.typeKo} · ${p.time}` : '미발견'}
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
            <div className="day-story-actions">
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
            </div>
          </aside>

          <section className="info-panel liquid-glass" aria-label="여행 정보">
            <button
              type="button"
              className="info-chip"
              aria-expanded={infoOpen}
              onClick={() => setInfoOpen((v) => !v)}
            >
              {infoOpen ? '정보 접기' : '이동 · 먹거리 · 예약 · 우천'}
            </button>
            {infoOpen && (
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
            {activeMon && skin === 'pocket' && (
              <p className="mon-hint">
                스팟 몬:{' '}
                {caught.has(place!.id)
                  ? `${activeMon.nameKo} (${activeMon.typeKo})`
                  : '???'}{' '}
                · 오리지널 캐릭터(비공식)
              </p>
            )}
          </section>
        </div>
      </section>

      <footer className="site-footer">
        <p>
          {TRIP.note} 지도 · OpenFreeMap / MapLibre. 위성 · Esri. 히어로 사진 · Unsplash
          (도쿄 랜드마크).
        </p>
        <p>
          <a href="https://github.com/gyu-bin/japan-tour">GitHub</a>
          {' · '}
          <a href="https://motionsites.ai/unlimited">MotionSites</a>
        </p>
      </footer>

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
