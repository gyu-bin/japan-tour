/**
 * Astra kingdom-map page — UI shell around AstraDioramaEngine
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { DAYS } from '../diorama/data.js'
import { createEngine, eventScope } from './AstraDioramaEngine'
import type { Engine } from './AstraDioramaEngine'
import './AstraDioramaPage.css'

type StopView = {
  name: string
  time: string
  jp?: string
  note?: string
  why?: string
  see?: string
  via?: string
  stay?: number
  eat?: number
}

const CHAPTER_EN = [
  'Landing at midnight',
  'Old Tokyo alleys',
  'Where the city meets the sea',
  'Above the Tokyo sky',
  'Sleep under Fuji',
  'Morning farewell to Fuji',
] as const

const CHAPTER_KO = ['하네다', '아사쿠사', '오다이바', '롯폰기', '카와구치코', '귀국'] as const

const SIDE_W = 340

function fmtDate(d: string) {
  const parts = (d || '').trim().split(/\s+/)
  if (parts.length < 2) return d || ''
  return `${parts[1]} ${parts[0]}`
}

export default function AstraDioramaPage() {
  const hostRef = useRef(null as HTMLDivElement | null)
  const labelRef = useRef(null as HTMLDivElement | null)
  const eng = useRef(null as Engine | null)
  const compassRef = useRef(null as HTMLSpanElement | null)
  const [rotating, setRotating] = useState(false)
  const [dayIdx, setDayIdx] = useState(0)
  const [alternateLight, setAlternateLight] = useState(false)
  const [selIdx, setSelIdx] = useState(0)
  const [paused, setPaused] = useState(false)
  const [touring, setTouring] = useState(false)
  const [open, setOpen] = useState(typeof window !== 'undefined' ? window.innerWidth > 900 : true)

  useEffect(() => {
    const host = hostRef.current
    const labels = labelRef.current
    const compass = compassRef.current
    if (!host || !labels || !compass) return
    const e = createEngine(host, labels, setSelIdx, compass, setRotating)
    eng.current = e
    return () => {
      e.dispose()
      eng.current = null
    }
  }, [])

  useEffect(() => {
    const apply = () => {
      const wide = window.innerWidth > 900
      eng.current?.setSideOffset(open && wide ? SIDE_W / 2 + 10 : 0)
    }
    apply()
    const scope = eventScope()
    scope.on(window, 'resize', apply)
    return scope.dispose
  }, [open])

  const firstDay = useRef(true)
  useEffect(() => {
    const host = hostRef.current
    const labels = labelRef.current
    if (!host || !labels) return
    if (firstDay.current) {
      firstDay.current = false
      eng.current?.buildDay(dayIdx)
      return
    }
    host.style.opacity = '0'
    labels.style.opacity = '0'
    const id = window.setTimeout(() => {
      eng.current?.buildDay(dayIdx)
      host.style.opacity = '1'
      labels.style.opacity = '1'
    }, 125)
    return () => {
      window.clearTimeout(id)
      host.style.opacity = '1'
      labels.style.opacity = '1'
    }
  }, [dayIdx])

  useEffect(() => {
    eng.current?.select(selIdx)
  }, [selIdx])

  useEffect(() => {
    eng.current?.setPaused(paused)
  }, [paused])

  useEffect(() => {
    eng.current?.setAlternateLight(alternateLight)
  }, [alternateLight])

  const selectDay = useCallback((i: number) => {
    eng.current?.setAutoRotate(false)
    setTouring(false)
    setDayIdx(i)
    setSelIdx(0)
  }, [])

  useEffect(() => {
    if (!touring) return
    const id = window.setInterval(() => {
      setSelIdx((s) => {
        const n = DAYS[dayIdx].stops.length
        if (s + 1 >= n) {
          setTouring(false)
          return s
        }
        return s + 1
      })
    }, 2400)
    return () => window.clearInterval(id)
  }, [touring, dayIdx])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target?.isContentEditable) return
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key.startsWith('Arrow')) {
        eng.current?.setAutoRotate(false)
        e.preventDefault()
      }
      if (e.key === 'ArrowRight') selectDay(Math.min(dayIdx + 1, DAYS.length - 1))
      if (e.key === 'ArrowLeft') selectDay(Math.max(dayIdx - 1, 0))
      if (e.key === 'ArrowDown') setSelIdx((s) => Math.min(s + 1, DAYS[dayIdx].stops.length - 1))
      if (e.key === 'ArrowUp') setSelIdx((s) => Math.max(s - 1, 0))
    }
    const scope = eventScope()
    scope.on(window, 'keydown', onKey as EventListener)
    return scope.dispose
  }, [dayIdx, selectDay])

  const day = DAYS[dayIdx]
  const stop = (day.stops[selIdx] ?? day.stops[0]) as StopView
  const placeTag = stop.eat ? 'EAT' : stop.stay ? 'STAY' : 'STOP'
  const dateLabel = typeof day.d === 'string' ? fmtDate(day.d) : ''

  return (
    <div className="astra-root">
      <div className="astra-scene" ref={hostRef}></div>
      <div className="astra-labels" ref={labelRef}></div>
      <div className="astra-vignette" aria-hidden="true"></div>

      <header className="astra-top">
        <div className="astra-brand">
          <p className="line">
            <span className="en">Tokyo Walk</span>
            <span className="bar" aria-hidden="true"></span>
            <span className="ko">東京散歩</span>
          </p>
          <p className="tag">A LITTLE WORLD. A LONG MEMORY.</p>
        </div>
        <div className="astra-chapter-title">
          <p className="ch">CHAPTER {day.no} / 06</p>
          <h1>{CHAPTER_EN[dayIdx]}</h1>
          <p className="ko-sub">{day.t}</p>
        </div>
        <div className="astra-top-actions">
          <button
            type="button"
            className={touring ? 'explore on' : 'explore'}
            onClick={() => {
              eng.current?.setAutoRotate(false)
              setTouring((v) => !v)
            }}
          >
            <span className="dot"></span>
            {touring ? 'TOURING' : 'EXPLORE'}
          </button>
          <button
            type="button"
            className="pill alt"
            title="시간대 전환"
            aria-label="시간대 전환"
            aria-pressed={alternateLight}
            onClick={() => setAlternateLight((v) => !v)}
          >
            {alternateLight ? '낮' : '밤'}
          </button>
          <a className="pill alt" href="/pokemon.html">
            픽셀
          </a>
          <a className="pill alt" href="/pokemon2.html">
            골드
          </a>
          <Link className="pill" to="/map">
            실제 지도
          </Link>
        </div>
      </header>

      <aside className={open ? 'astra-side open' : 'astra-side'}>
        <button
          type="button"
          className="astra-side-toggle"
          onClick={() => {
            eng.current?.setAutoRotate(false)
            setOpen((v) => !v)
          }}
        >
          {open ? '접기' : '일정 보기'}
        </button>
        <div className="astra-side-body">
          <div className="astra-day-head">
            <p className="day-kicker">DAY {day.no}</p>
            <h2>{day.t}</h2>
            <p className="region">
              {day.region} · {dateLabel}
            </p>
          </div>
          <ol className="astra-stops">
            {day.stops.map((s: { name: string; time: string; eat?: number }, i: number) => {
              const stopClass =
                'astra-stop' + (i === selIdx ? ' on' : '') + (s.eat ? ' eat' : '')
              return (
                <li key={i}>
                  <button
                    type="button"
                    className={stopClass}
                    onClick={() => {
                      eng.current?.setAutoRotate(false)
                      setSelIdx(i)
                    }}
                  >
                    <span className="ix">{i + 1}</span>
                    <span className="meta">
                      <span className="nm">{s.name}</span>
                      <span className="tm">{s.time}</span>
                    </span>
                  </button>
                </li>
              )
            })}
          </ol>
          <article className="astra-card">
            <p className="place">
              PLACE {String(selIdx + 1).padStart(2, '0')} · {placeTag}
            </p>
            <h3>{stop.name}</h3>
            {stop.jp ? <p className="jp">{stop.jp}</p> : null}
            <p className="body">{stop.why || stop.note}</p>
          </article>
        </div>
      </aside>

      <nav className="astra-chapters" aria-label="일차 선택">
        {DAYS.map((d: { no: string; d: string }, i: number) => (
          <button
            key={d.no}
            type="button"
            className={i === dayIdx ? 'astra-ch on' : 'astra-ch'}
            onClick={() => selectDay(i)}
          >
            <span className="no">{d.no}</span>
            <span className="meta">
              <span className="nm">{CHAPTER_KO[i]}</span>
              <span className="dt">{fmtDate(d.d)}</span>
            </span>
          </button>
        ))}
      </nav>

      <div className="astra-ctrl">
        <div className="row orbit-row">
          <button
            type="button"
            className="astra-compass"
            aria-label="정면으로 복귀"
            title="정면으로 복귀"
            onClick={() => eng.current?.front()}
          >
            <span ref={compassRef} className="astra-compass-dial" aria-hidden="true">
              N
            </span>
          </button>
          <button
            type="button"
            aria-pressed={rotating}
            onClick={() => {
              setTouring(false)
              eng.current?.setAutoRotate(!rotating)
            }}
          >
            {rotating ? '360도 회전 중' : '360도 둘러보기'}
          </button>
        </div>
        <div className="row">
          <button type="button" aria-label="확대" onClick={() => eng.current?.zoomBy(1.2)}>
            +
          </button>
          <button type="button" aria-label="축소" onClick={() => eng.current?.zoomBy(0.84)}>
            -
          </button>
          <button type="button" onClick={() => eng.current?.reset()}>
            전체 보기
          </button>
          <button
            type="button"
            onClick={() => {
              eng.current?.setAutoRotate(false)
              setPaused((p) => !p)
            }}
          >
            {paused ? '움직임 재생' : '움직임 멈춤'}
          </button>
        </div>
        <p className="astra-help">
          좌우 스크롤·드래그 회전 · 상하 스크롤 확대 · Shift+드래그 이동 · 핀치 확대 · 화살표로 날짜
        </p>
      </div>

      <p className="astra-foot">여행을 담은 미니어처 · 축척과 위치는 실제와 다릅니다</p>
    </div>
  )
}
