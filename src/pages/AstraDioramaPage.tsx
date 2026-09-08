/**
 * Astra kingdom-map experiment
 * 기존 /diorama 와 분리: 클래식 아이소메트릭 · 스튜디오 소프트라이트 · 고밀도 미니어처 · 리본 경로
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import * as THREE from 'three'
import { CSS2DObject, CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js'
import { DAYS, projectDay } from '../diorama/data.js'
import './AstraDioramaPage.css'

const HALF = 36
const ROADS = [-30, -24, -18, -12, -6, 0, 6, 12, 18, 24, 30]
const AZ0 = Math.PI / 4
const EL0 = Math.PI * 0.30
const DIST = 88
const ZOOM0 = 18
const SPAN = 24 // stop / landmark layout radius

type Theme = {
  sky: [string, string]
  fog: number
  plate: number
  rim: number
  road: number
  park: number
  walls: number[]
  roofs: number[]
  accent: number
  cool: number[]
  warmP: number
  tall: number
  empty: number
  trees: number
  sea?: boolean
  green?: boolean
}

const THEMES: Record<string, Theme> = {
  night: {
    sky: ['#9eb4c9', '#dfe6ef'], fog: 0xd6dde8,
    plate: 0xf2f4f7, rim: 0xd8dde6, road: 0xc8d0db,
    park: 0xb9cfc0, walls: [0xf7f8fa, 0xeef1f5, 0xf4f0eb, 0xe8edf3, 0xf0ebe4],
    roofs: [0x6d7f96, 0x8496ab, 0xe07a5f, 0x5f7188], accent: 0xe07a5f,
    cool: [0x7a8da6, 0x6a7d96], warmP: 0.35, tall: 1.15, empty: 0.05, trees: 0.12,
  },
  asakusa: {
    sky: ['#a8c0c8', '#e8efe8'], fog: 0xdce8e4,
    plate: 0xf4f1ea, rim: 0xddd6c8, road: 0xd2cbbd,
    park: 0xb8cba8, walls: [0xfaf6ef, 0xf3ebe0, 0xf7f0e6, 0xefe6d8, 0xf5ece2],
    roofs: [0xc45c45, 0xa84838, 0xd9785c, 0x6d7f96], accent: 0xc45c45,
    cool: [0x7a8da6], warmP: 0.82, tall: 0.72, empty: 0.04, trees: 0.2,
  },
  odaiba: {
    sky: ['#8eb8d4', '#d5e8f2'], fog: 0xcfe3ef,
    plate: 0xeef3f6, rim: 0xc9d7e2, road: 0xc2d0db,
    park: 0xa8c9b4, walls: [0xf5f9fb, 0xe8f0f5, 0xf2f6f8, 0xe4ecef],
    roofs: [0x6d8fad, 0x8aa8c0, 0xe07a5f], accent: 0x4a90b8,
    cool: [0x6d8fad, 0x8aa8c0, 0x5a7f9a], warmP: 0.28, tall: 1.45, empty: 0.06, trees: 0.1, sea: true,
  },
  roppongi: {
    sky: ['#8fa0b5', '#d8dee8'], fog: 0xcfd6e2,
    plate: 0xeceef2, rim: 0xc8ced8, road: 0xb8c0cc,
    park: 0xa8b9a4, walls: [0xf0f1f4, 0xe6e8ec, 0xf4f2ee, 0xdddfe4, 0xeae6e0],
    roofs: [0x4a5568, 0x5c6b80, 0xe07a5f, 0x6d7f96], accent: 0xe07a5f,
    cool: [0x4a5568, 0x5c6b80, 0x6d7f96], warmP: 0.22, tall: 1.85, empty: 0.04, trees: 0.08,
  },
  fuji: {
    sky: ['#9ab8c8', '#d8e6d4'], fog: 0xd2e0d6,
    plate: 0xe4ecd8, rim: 0xc5d0b4, road: 0xc0cbb0,
    park: 0x9fba8e, walls: [0xf7f3ea, 0xf0e8dc, 0xefe9e0],
    roofs: [0xc45c45, 0xa84838, 0x6d7f96], accent: 0xc45c45,
    cool: [0x6d7f96], warmP: 0.75, tall: 0.48, empty: 0.38, trees: 0.62, green: true,
  },
}

type Engine = {
  buildDay: (i: number) => void
  select: (i: number) => void
  zoomBy: (f: number) => void
  reset: () => void
  setPaused: (p: boolean) => void
  dispose: () => void
}

function createEngine(host: HTMLDivElement, labelsEl: HTMLDivElement, onPick: (i: number) => void): Engine {
  const scene = new THREE.Scene()
  scene.fog = new THREE.Fog(0xd6dde8, 100, 280)

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' })
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
  renderer.setSize(host.clientWidth, host.clientHeight)
  renderer.setClearColor(0x000000, 0)
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.12
  host.appendChild(renderer.domElement)

  const labelR = new CSS2DRenderer()
  labelR.setSize(host.clientWidth, host.clientHeight)
  labelR.domElement.style.cssText = 'position:absolute;inset:0;pointer-events:none'
  labelsEl.appendChild(labelR.domElement)

  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 400)
  cam.left = -host.clientWidth / 2
  cam.right = host.clientWidth / 2
  cam.top = host.clientHeight / 2
  cam.bottom = -host.clientHeight / 2
  cam.updateProjectionMatrix()

  const hemi = new THREE.HemisphereLight(0xf2f6fa, 0xb8c4b0, 1.05)
  const key = new THREE.DirectionalLight(0xffffff, 0.55)
  key.position.set(18, 32, 10)
  const fill = new THREE.DirectionalLight(0xb8d0e8, 0.35)
  fill.position.set(-22, 14, -16)
  const rimL = new THREE.DirectionalLight(0xffe8d8, 0.22)
  rimL.position.set(-8, 10, 24)
  scene.add(hemi, key, fill, rimL)

  const world = new THREE.Group()
  scene.add(world)

  const G = {
    box: new THREE.BoxGeometry(1, 1, 1),
    cyl: new THREE.CylinderGeometry(1, 1, 1, 14),
    cone: new THREE.ConeGeometry(1, 1, 10),
    sph: new THREE.SphereGeometry(1, 12, 10),
    plane: new THREE.PlaneGeometry(1, 1),
    circle: new THREE.CircleGeometry(1, 40),
    torus: new THREE.TorusGeometry(1, 0.08, 8, 36),
    wedge: (() => {
      const s = new THREE.Shape()
      s.moveTo(-0.5, 0); s.lineTo(0.5, 0); s.lineTo(0, 0.55); s.closePath()
      return new THREE.ExtrudeGeometry(s, { depth: 1, bevelEnabled: false })
    })(),
  }

  const cache = new Map<string, THREE.Material>()
  function mat(c: number, o: { basic?: boolean; opacity?: number; rough?: number } = {}) {
    const k = `${c}|${o.basic ? 1 : 0}|${o.opacity ?? 1}|${o.rough ?? 0.85}`
    let m = cache.get(k)
    if (m) return m
    if (o.basic) {
      m = new THREE.MeshBasicMaterial({
        color: c, transparent: (o.opacity ?? 1) < 1, opacity: o.opacity ?? 1, depthWrite: (o.opacity ?? 1) > 0.95,
      })
    } else {
      m = new THREE.MeshStandardMaterial({
        color: c, roughness: o.rough ?? 0.88, metalness: 0.02,
        transparent: (o.opacity ?? 1) < 1, opacity: o.opacity ?? 1,
      })
    }
    cache.set(k, m)
    return m
  }

  function M(
    geo: THREE.BufferGeometry, m: THREE.Material,
    sx: number, sy: number, sz: number, x: number, y: number, z: number,
  ) {
    const o = new THREE.Mesh(geo, m)
    o.scale.set(sx, sy, sz)
    o.position.set(x, y, z)
    return o
  }

  const rnd = (a: number, b: number) => a + Math.random() * (b - a)
  const pick = <T,>(a: T[]) => a[(Math.random() * a.length) | 0]

  let az = AZ0, elev = EL0, zoom = ZOOM0, zoomT = ZOOM0
  const focus = new THREE.Vector3(), focusT = new THREE.Vector3()
  let flying = false
  let paused = false
  let sel = 0
  const keys = new Set<string>()
  const right = new THREE.Vector3()
  const fwd = new THREE.Vector3()
  let pins: { el: HTMLElement; obj: CSS2DObject }[] = []
  let spots: THREE.Vector3[] = []
  let people: { g: THREE.Group; axis: string; c: number; t: number; spd: number; off: number }[] = []
  let cars: { g: THREE.Group; axis: string; c: number; t: number; spd: number; dir: number }[] = []
  let wheels: { o: THREE.Object3D; spd: number }[] = []
  let rings: THREE.Object3D[] = []
  let pathGlow: THREE.Mesh | null = null

  function clampFocus() {
    const lim = HALF * 0.92
    focusT.x = Math.max(-lim, Math.min(lim, focusT.x))
    focusT.z = Math.max(-lim, Math.min(lim, focusT.z))
    focusT.y = 0.45
  }

  function groundAxes() {
    right.set(Math.cos(az), 0, -Math.sin(az))
    fwd.set(-Math.sin(az), 0, -Math.cos(az))
  }

  function panScreen(dx: number, dy: number) {
    groundAxes()
    const scale = (52 / Math.max(zoom, 8)) * 0.05
    focusT.addScaledVector(right, -dx * scale)
    focusT.addScaledVector(fwd, dy * scale)
    clampFocus()
    focus.copy(focusT)
    flying = false
  }

  function updateCam() {
    const x = focus.x + Math.cos(elev) * Math.sin(az) * DIST
    const y = focus.y + Math.sin(elev) * DIST
    const z = focus.z + Math.cos(elev) * Math.cos(az) * DIST
    cam.position.set(x, y, z)
    cam.lookAt(focus)
    cam.zoom = zoom
    cam.updateProjectionMatrix()
  }

  function clear() {
    while (world.children.length) world.remove(world.children[0])
    labelsEl.querySelectorAll('.astra-pin, .astra-lm').forEach((n) => n.remove())
    pins = []; people = []; cars = []; wheels = []; rings = []; spots = []
    pathGlow = null
  }

  function plate(th: Theme) {
    const base = M(G.box, mat(th.rim), HALF * 2 + 1.6, 0.55, HALF * 2 + 1.6, 0, -0.28, 0)
    world.add(base)
    const top = M(G.box, mat(th.plate), HALF * 2, 0.18, HALF * 2, 0, 0.02, 0)
    world.add(top)
    const lip = M(G.box, mat(th.rim, { rough: 0.6 }), HALF * 2 + 0.35, 0.22, HALF * 2 + 0.35, 0, -0.02, 0)
    world.add(lip)

    for (const r of ROADS) {
      world.add(M(G.box, mat(th.road), HALF * 2 - 0.6, 0.04, 1.15, 0, 0.12, r))
      world.add(M(G.box, mat(th.road), 1.15, 0.04, HALF * 2 - 0.6, r, 0.12, 0))
    }
    if (th.green) {
      for (let i = 0; i < 18; i++) {
        const px = rnd(-HALF + 4, HALF - 4), pz = rnd(-HALF + 4, HALF - 4)
        world.add(M(G.circle, mat(th.park), rnd(2.2, 4.2), 1, rnd(2.2, 4.2), px, 0.11, pz))
        world.children[world.children.length - 1].rotation.x = -Math.PI / 2
      }
    }
  }

  type Win = { x: number; y: number; z: number; sx: number; sy: number; rotY: number; c?: number }[]

  function wins(buf: Win, x: number, z: number, w: number, d: number, h: number, fl: number, cols: number, lit = 0x8eb4d4) {
    const fh = h / (fl + 0.45)
    for (let f = 0; f < fl; f++) {
      for (let c = 0; c < cols; c++) {
        if (Math.random() < 0.08) continue
        const u = (c + 0.5) / cols - 0.5
        const y = 0.22 + f * fh + fh * 0.38
        buf.push({ x: x + u * w * 0.78, y, z: z + d / 2 + 0.02, sx: w * 0.11, sy: fh * 0.4, rotY: 0, c: lit })
        if (Math.random() < 0.65) buf.push({ x: x + w / 2 + 0.02, y, z: z + u * d * 0.78, sx: d * 0.11, sy: fh * 0.4, rotY: Math.PI / 2, c: lit })
      }
    }
  }

  function gable(x: number, z: number, w: number, d: number, h: number, c: number) {
    world.add(M(G.wedge, mat(c, { rough: 0.7 }), w * 1.12, Math.max(0.55, h * 0.38), d * 1.08, x, h + 0.02, z - d * 0.54))
  }

  function flatRoof(x: number, z: number, w: number, d: number, h: number, c: number) {
    world.add(M(G.box, mat(c, { rough: 0.65 }), w * 1.04, 0.1, d * 1.04, x, h + 0.05, z))
    world.add(M(G.box, mat(c), w * 1.06, 0.16, 0.06, x, h + 0.16, z + d * 0.52))
    world.add(M(G.box, mat(c), w * 1.06, 0.16, 0.06, x, h + 0.16, z - d * 0.52))
  }

  function chimney(x: number, z: number, h: number) {
    world.add(M(G.box, mat(0x8a8078), 0.18, 0.45, 0.18, x, h + 0.35, z))
  }

  function acUnit(x: number, z: number, h: number, faceZ: number) {
    world.add(M(G.box, mat(0xb8c0c8), 0.35, 0.22, 0.2, x, h * 0.45, z + faceZ))
  }

  function signBoard(x: number, z: number, h: number, d: number, color: number, vertical = false) {
    if (vertical) world.add(M(G.box, mat(color, { basic: true }), 0.12, rnd(0.9, 1.6), 0.08, x + 0.02, h * 0.55, z + d / 2 + 0.12))
    else world.add(M(G.box, mat(color, { basic: true }), rnd(0.7, 1.2), 0.22, 0.06, x, h + 0.2, z + d / 2 + 0.08))
  }

  function awning(x: number, z: number, w: number, d: number, y: number, c: number) {
    world.add(M(G.box, mat(c), w * 0.92, 0.06, 0.45, x, y, z + d / 2 + 0.22))
  }

  function balcony(x: number, z: number, w: number, d: number, y: number) {
    world.add(M(G.box, mat(0xdde4ec), w * 0.7, 0.06, 0.28, x, y, z + d / 2 + 0.14))
    world.add(M(G.box, mat(0x8aa0b4), w * 0.7, 0.14, 0.04, x, y + 0.1, z + d / 2 + 0.26))
  }

  function waterTank(x: number, z: number, h: number) {
    world.add(M(G.cyl, mat(0xc5d0dc), 0.28, 0.45, 0.28, x, h + 0.35, z))
    world.add(M(G.box, mat(0x6d7f96), 0.06, 0.55, 0.06, x + 0.35, h + 0.4, z))
  }

  function house(x: number, z: number, th: Theme, buf: Win) {
    const w = rnd(1.15, 1.75), d = rnd(1.05, 1.55), h = rnd(1.15, 2.0) * Math.min(th.tall, 1.1)
    const wall = pick(th.walls)
    world.add(M(G.box, mat(wall), w, h, d, x, h / 2, z))
    gable(x, z, w, d, h, Math.random() < th.warmP ? pick(th.roofs) : pick(th.cool))
    if (Math.random() < 0.55) {
      world.add(M(G.box, mat(0xe8e2d8), w * 0.45, 0.08, 0.35, x, 0.06, z + d / 2 + 0.12))
      world.add(M(G.cyl, mat(wall), 0.05, 0.55, 0.05, x - w * 0.15, 0.35, z + d / 2 + 0.2))
    }
    if (Math.random() < 0.7) chimney(x + w * 0.28, z - d * 0.1, h + 0.35)
    if (Math.random() < 0.4) acUnit(x + w * 0.4, z, h, d / 2 + 0.12)
    world.add(M(G.box, mat(0x6a5848), 0.28, 0.55, 0.04, x - w * 0.15, 0.3, z + d / 2 + 0.03))
    wins(buf, x, z, w, d, h, 2, 2, 0x9ec0dc)
  }

  function machiya(x: number, z: number, th: Theme, buf: Win) {
    const w = rnd(1.3, 2.0), d = rnd(1.4, 2.0), h = rnd(1.6, 2.4)
    const wood = pick([0x5c4030, 0x6a4a38, 0x4a3428])
    world.add(M(G.box, mat(pick(th.walls)), w, h, d, x, h / 2, z))
    world.add(M(G.box, mat(wood), w * 1.02, 0.35, 0.06, x, h * 0.55, z + d / 2 + 0.02))
    gable(x, z, w, d, h, pick([0x3a322c, 0x4a4038, pick(th.roofs)]))
    world.add(M(G.box, mat(pick([0xc45c45, 0x4a90b8, 0x2d2a25, 0xe07a5f]), { basic: true }), w * 0.7, 0.35, 0.04, x, 0.85, z + d / 2 + 0.08))
    world.add(M(G.box, mat(0xd4c4a8), w * 0.95, 0.08, 0.28, x, 0.08, z + d / 2 + 0.1))
    wins(buf, x, z, w, d, h, 2, 3, 0xf0e0c0)
  }

  function shop(x: number, z: number, th: Theme, buf: Win) {
    const w = rnd(1.5, 2.3), d = rnd(1.25, 1.8), h = rnd(1.5, 2.5)
    const accent = pick([th.accent, 0x4a90b8, 0xe07a5f, 0xd4af37, 0x6fa06a])
    world.add(M(G.box, mat(pick(th.walls)), w, h, d, x, h / 2, z))
    flatRoof(x, z, w, d, h, pick(th.roofs))
    world.add(M(G.plane, mat(0x9ec4e0, { basic: true, opacity: 0.88 }), w * 0.82, 0.7, 1, x, 0.55, z + d / 2 + 0.02))
    awning(x, z, w, d, 1.05, accent)
    if (Math.random() < 0.7) signBoard(x, z, h, d, accent, Math.random() < 0.55)
    if (Math.random() < 0.45) {
      world.add(M(G.box, mat(0x8a6a4a), 0.35, 0.2, 0.25, x + w * 0.35, 0.12, z + d / 2 + 0.2))
      world.add(M(G.sph, mat(0x6fa06a), 0.18, 0.18, 0.18, x + w * 0.35, 0.32, z + d / 2 + 0.2))
    }
    wins(buf, x, z, w, d, h, Math.max(2, (h / 0.9) | 0), 3)
  }

  function konbini(x: number, z: number, _th: Theme, buf: Win) {
    const w = rnd(2.0, 2.6), d = rnd(1.5, 1.9), h = 1.45
    const stripe = Math.random() < 0.5
    world.add(M(G.box, mat(0xf7f8fa), w, h, d, x, h / 2, z))
    world.add(M(G.box, mat(stripe ? 0x1a4a8a : 0x0a6b4a), w * 1.05, 0.22, d * 1.05, x, h + 0.08, z))
    world.add(M(G.box, mat(stripe ? 0xe07a5f : 0xf2f4f7), w * 1.05, 0.1, d * 1.05, x, h + 0.24, z))
    world.add(M(G.plane, mat(0xb8d8f0, { basic: true, opacity: 0.9 }), w * 0.85, 0.75, 1, x, 0.55, z + d / 2 + 0.02))
    awning(x, z, w, d, 1.05, stripe ? 0x1a4a8a : 0x0a6b4a)
    wins(buf, x, z, w, d, h, 1, 4, 0xc5e0f5)
  }

  function mid(x: number, z: number, th: Theme, buf: Win) {
    const w = rnd(1.6, 2.5), d = rnd(1.5, 2.2), fl = 3 + ((Math.random() * 4) | 0)
    const h = fl * 0.7 * th.tall
    world.add(M(G.box, mat(pick(th.walls)), w, h, d, x, h / 2, z))
    for (let f = 1; f < fl; f++) world.add(M(G.box, mat(0xd8dee6, { rough: 0.7 }), w * 1.02, 0.05, d * 1.02, x, f * (h / fl), z))
    flatRoof(x, z, w, d, h, pick(th.cool))
    if (Math.random() < 0.55) waterTank(x + w * 0.2, z - d * 0.15, h)
    if (Math.random() < 0.6) {
      for (let f = 1; f < fl; f++) if (Math.random() < 0.5) balcony(x, z, w * 0.8, d, f * (h / fl) + 0.15)
    }
    if (Math.random() < 0.35) signBoard(x, z, h * 0.4, d, th.accent, true)
    wins(buf, x, z, w, d, h, fl, 3)
  }

  function tower(x: number, z: number, th: Theme, buf: Win) {
    const w = rnd(1.35, 1.95), d = rnd(1.35, 1.95), fl = 8 + ((Math.random() * 7) | 0)
    const h = fl * 0.65 * th.tall
    world.add(M(G.box, mat(pick(th.cool.length ? th.cool : th.walls)), w, h, d, x, h / 2, z))
    for (let i = 0; i < 3; i++) {
      const u = (i / 2 - 0.5) * w * 0.7
      world.add(M(G.box, mat(0xdde4ec, { rough: 0.5 }), 0.06, h * 0.95, 0.04, x + u, h / 2, z + d / 2 + 0.03))
    }
    world.add(M(G.box, mat(0xf2f4f7, { rough: 0.45 }), w * 0.65, h * 0.12, d * 0.65, x, h + h * 0.06, z))
    world.add(M(G.box, mat(0xd4af37, { basic: true }), 0.1, 0.7, 0.1, x, h + h * 0.2, z))
    wins(buf, x, z, w, d, h, Math.min(fl, 12), 4, 0xa8c8e0)
  }

  function lShape(x: number, z: number, th: Theme, buf: Win) {
    const w = rnd(2.0, 2.8), d = rnd(1.4, 1.9), h = rnd(1.8, 3.0) * th.tall
    const wall = pick(th.walls)
    world.add(M(G.box, mat(wall), w, h, d * 0.55, x, h / 2, z - d * 0.22))
    world.add(M(G.box, mat(wall), w * 0.45, h * 0.85, d, x - w * 0.28, h * 0.425, z))
    flatRoof(x, z - d * 0.22, w, d * 0.55, h, pick(th.cool))
    wins(buf, x, z - d * 0.22, w, d * 0.55, h, 3, 3)
  }

  function stepped(x: number, z: number, th: Theme, buf: Win) {
    const wall = pick(th.walls)
    const w = rnd(1.6, 2.2), d = rnd(1.5, 2.0)
    const h1 = rnd(1.4, 2.0), h2 = h1 + rnd(0.8, 1.6), h3 = h2 + rnd(0.6, 1.4)
    world.add(M(G.box, mat(wall), w, h1, d, x, h1 / 2, z))
    world.add(M(G.box, mat(wall), w * 0.75, h2 - h1, d * 0.75, x, h1 + (h2 - h1) / 2, z))
    world.add(M(G.box, mat(pick(th.cool)), w * 0.5, h3 - h2, d * 0.5, x, h2 + (h3 - h2) / 2, z))
    wins(buf, x, z, w, d, h1, 2, 3)
    wins(buf, x, z, w * 0.75, d * 0.75, h2, 2, 2)
  }

  function warehouse(x: number, z: number, th: Theme, buf: Win) {
    const w = rnd(2.4, 3.4), d = rnd(1.8, 2.6), h = rnd(1.4, 2.2)
    world.add(M(G.box, mat(pick([0xd8d4cc, 0xc8c4bc, pick(th.walls)])), w, h, d, x, h / 2, z))
    for (let i = 0; i < 3; i++) gable(x + (i - 1) * (w / 3.2), z, w / 3.4, d * 0.95, h, pick(th.cool))
    world.add(M(G.box, mat(0x5a6578), w * 0.35, 0.7, 0.08, x - w * 0.2, 0.4, z + d / 2 + 0.04))
    wins(buf, x, z, w, d, h, 2, 4, 0x9aabbc)
  }

  function parkLot(x: number, z: number) {
    world.add(M(G.box, mat(0xb8c0cc), 2.4, 0.06, 2.0, x, 0.08, z))
    for (let i = 0; i < 3; i++) {
      world.add(M(G.box, mat(0xdde4ec), 0.04, 0.02, 1.6, x - 0.8 + i * 0.8, 0.12, z))
      if (Math.random() < 0.55) {
        const car = new THREE.Group()
        car.add(M(G.box, mat(pick([0xe07a5f, 0x4a90b8, 0x2d2a25, 0xf2f4f7])), 0.55, 0.18, 0.3, 0, 0.12, 0))
        car.position.set(x - 0.8 + i * 0.8, 0.12, z + (Math.random() < 0.5 ? 0.4 : -0.4))
        car.rotation.y = Math.PI / 2
        world.add(car)
      }
    }
  }

  function shrine(x: number, z: number) {
    const g = new THREE.Group()
    g.add(M(G.box, mat(0xf0e6d4), 1.2, 0.9, 1.0, 0, 0.45, 0))
    g.add(M(G.wedge, mat(0xc45c45, { rough: 0.7 }), 1.45, 0.7, 1.15, 0, 0.95, -0.55))
    g.add(M(G.box, mat(0xc45c45), 0.15, 1.5, 0.15, -0.9, 0.75, 0.6))
    g.add(M(G.box, mat(0xc45c45), 0.15, 1.5, 0.15, 0.9, 0.75, 0.6))
    g.add(M(G.box, mat(0xc45c45), 2.0, 0.12, 0.2, 0, 1.5, 0.6))
    g.position.set(x, 0, z)
    world.add(g)
  }

  function tree(x: number, z: number, lush = false) {
    const g = new THREE.Group()
    g.add(M(G.cyl, mat(0x8a6a4a), 0.07, lush ? 0.55 : 0.4, 0.07, 0, lush ? 0.28 : 0.2, 0))
    const leaf = lush ? 0x6fa06a : pick([0x7aab72, 0x8bbb78, 0x6a9a68])
    g.add(M(G.sph, mat(leaf, { rough: 0.95 }), rnd(0.35, 0.55), rnd(0.32, 0.48), rnd(0.35, 0.55), 0, lush ? 0.7 : 0.55, 0))
    if (lush && Math.random() < 0.4) g.add(M(G.sph, mat(leaf, { rough: 0.95 }), 0.28, 0.25, 0.28, 0.25, 0.55, 0.1))
    g.position.set(x, 0, z)
    world.add(g)
  }

  function city(th: Theme, clears: { x: number; z: number; r: number }[], seaX: number | null) {
    const buf: Win = []
    const step = th.green ? 2.55 : 2.15
    for (let x = -HALF + 1.2; x < HALF - 1.2; x += step) {
      for (let z = -HALF + 1.2; z < HALF - 1.2; z += step) {
        const jx = x + rnd(-0.28, 0.28), jz = z + rnd(-0.28, 0.28)
        if (clears.some((c) => Math.hypot(jx - c.x, jz - c.z) < c.r)) continue
        if (ROADS.some((r) => Math.abs(jx - r) < 0.95 || Math.abs(jz - r) < 0.95)) continue
        if (seaX !== null && jx > seaX) continue
        if (Math.random() < th.empty) {
          if (Math.random() < th.trees) tree(jx, jz, th.green)
          else if (Math.random() < 0.15) parkLot(jx, jz)
          continue
        }
        const r = Math.random()
        const center = Math.hypot(jx, jz) < 8
        if (th.green) {
          if (r < 0.12) shrine(jx, jz)
          else if (r < 0.4) house(jx, jz, th, buf)
          else if (r < 0.62) machiya(jx, jz, th, buf)
          else if (r < 0.78) shop(jx, jz, th, buf)
          else tree(jx, jz, true)
        } else if (center && th.tall > 1.25 && r < 0.22) tower(jx, jz, th, buf)
        else if (center && r < 0.38) mid(jx, jz, th, buf)
        else if (r < 0.08) parkLot(jx, jz)
        else if (r < 0.14) konbini(jx, jz, th, buf)
        else if (r < 0.22) warehouse(jx, jz, th, buf)
        else if (r < 0.32) lShape(jx, jz, th, buf)
        else if (r < 0.42) stepped(jx, jz, th, buf)
        else if (r < 0.52) shop(jx, jz, th, buf)
        else if (r < 0.6) machiya(jx, jz, th, buf)
        else if (r < 0.78) house(jx, jz, th, buf)
        else mid(jx, jz, th, buf)
      }
    }
    if (buf.length) {
      const place = (list: Win, color: number) => {
        if (!list.length) return
        const inst = new THREE.InstancedMesh(G.plane, mat(color, { basic: true, opacity: 0.78 }), list.length)
        const dummy = new THREE.Object3D()
        list.forEach((w, i) => {
          dummy.position.set(w.x, w.y, w.z)
          dummy.scale.set(w.sx, w.sy, 1)
          dummy.rotation.set(0, w.rotY, 0)
          dummy.updateMatrix()
          inst.setMatrixAt(i, dummy.matrix)
        })
        inst.instanceMatrix.needsUpdate = true
        world.add(inst)
      }
      place(buf.filter((w) => !w.c || w.c === 0x8eb4d4), 0x8eb4d4)
      place(buf.filter((w) => w.c === 0xf0e0c0), 0xf0e0c0)
      place(buf.filter((w) => w.c === 0xc5e0f5 || w.c === 0x9ec0dc || w.c === 0xa8c8e0 || w.c === 0x9aabbc), 0xa8c8e0)
    }
  }

  function addLmLabel(x: number, z: number, y: number, title: string, jp?: string) {
    const el = document.createElement('div')
    el.className = 'astra-lm'
    el.innerHTML = `<span class="t">${title}</span>${jp ? `<span class="j">${jp}</span>` : ''}`
    const obj = new CSS2DObject(el)
    obj.position.set(x, y, z)
    world.add(obj)
  }

  function lmPagoda(x: number, z: number) {
    const g = new THREE.Group()
    const red = 0xb84438, dark = 0x2a221c, gold = 0xd4af37
    g.add(M(G.box, mat(0xf0e6d4), 2.6, 0.25, 2.6, 0, 0.12, 0))
    for (let i = 0; i < 5; i++) {
      const s = 2.4 - i * 0.35, y = 0.55 + i * 1.15
      g.add(M(G.box, mat(red), s * 0.72, 0.7, s * 0.72, 0, y, 0))
      g.add(M(G.box, mat(dark), s * 1.35, 0.1, s * 1.35, 0, y + 0.4, 0))
      g.add(M(G.box, mat(dark), s * 1.15, 0.08, 0.12, 0, y + 0.48, s * 0.62))
      g.add(M(G.box, mat(dark), s * 1.15, 0.08, 0.12, 0, y + 0.48, -s * 0.62))
      g.add(M(G.box, mat(dark), 0.12, 0.08, s * 1.15, s * 0.62, y + 0.48, 0))
      g.add(M(G.box, mat(dark), 0.12, 0.08, s * 1.15, -s * 0.62, y + 0.48, 0))
    }
    g.add(M(G.cyl, mat(gold), 0.12, 1.4, 0.12, 0, 6.6, 0))
    g.add(M(G.sph, mat(gold, { basic: true }), 0.22, 0.22, 0.22, 0, 7.35, 0))
    g.position.set(x, 0, z)
    world.add(g)
    addLmLabel(x, z, 8.2, '센소지 오층탑', '五重塔')
  }

  function lmGate(x: number, z: number) {
    const g = new THREE.Group()
    const red = 0xb84438
    g.add(M(G.box, mat(red), 0.45, 3.0, 0.45, -1.7, 1.5, 0))
    g.add(M(G.box, mat(red), 0.45, 3.0, 0.45, 1.7, 1.5, 0))
    g.add(M(G.box, mat(red), 4.2, 0.45, 0.7, 0, 2.85, 0))
    g.add(M(G.box, mat(0x2a221c), 4.8, 0.22, 0.9, 0, 3.25, 0))
    g.add(M(G.box, mat(0x2a221c), 5.0, 0.12, 0.5, 0, 3.45, 0))
    g.add(M(G.cyl, mat(0xc45c45), 0.55, 1.3, 0.55, 0, 1.5, 0.15))
    g.add(M(G.cyl, mat(0xf0e6d4), 0.5, 0.2, 0.5, 0, 2.15, 0.15))
    g.add(M(G.box, mat(0x2a221c), 0.35, 0.45, 0.05, 0, 1.5, 0.72))
    g.position.set(x, 0, z)
    world.add(g)
    addLmLabel(x, z, 4.2, '가미나리몬', '雷門')
  }

  function lmTokyoTower(x: number, z: number) {
    const g = new THREE.Group()
    const orange = 0xe05a3a, white = 0xf4f6f9
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(M(G.box, mat(orange), 0.18, 7.5, 0.18, sx * 1.1, 3.75, sz * 1.1))
    for (let i = 0; i < 6; i++) {
      const y = 0.8 + i * 1.15, s = 2.0 - i * 0.22
      g.add(M(G.box, mat(i % 2 ? white : orange), s, 0.12, s, 0, y, 0))
    }
    for (let i = 0; i < 10; i++) {
      const t = i / 10, s = 1.5 - t * 1.15, y = 0.5 + i * 1.05
      g.add(M(G.box, mat(i % 2 ? white : orange), s, 1.0, s, 0, y, 0))
    }
    g.add(M(G.box, mat(white), 1.4, 0.35, 1.4, 0, 7.2, 0))
    g.add(M(G.box, mat(orange), 0.9, 0.25, 0.9, 0, 9.6, 0))
    g.add(M(G.cyl, mat(orange), 0.07, 2.8, 0.07, 0, 11.4, 0))
    g.add(M(G.sph, mat(0xd4af37, { basic: true }), 0.2, 0.2, 0.2, 0, 12.9, 0))
    g.position.set(x, 0, z)
    world.add(g)
    addLmLabel(x, z, 13.6, '도쿄타워', '東京タワー')
  }

  function lmWheel(x: number, z: number) {
    const g = new THREE.Group()
    g.add(M(G.box, mat(0x5a6a80), 0.3, 3.6, 0.3, -1.6, 1.8, 0))
    g.add(M(G.box, mat(0x5a6a80), 0.3, 3.6, 0.3, 1.6, 1.8, 0))
    g.add(M(G.box, mat(0x5a6a80), 3.6, 0.25, 0.25, 0, 3.5, 0))
    g.add(M(G.box, mat(0xeef1f5), 2.8, 0.9, 1.6, 0, 0.45, 1.4))
    g.add(M(G.box, mat(0x4a90b8), 2.9, 0.15, 1.7, 0, 0.95, 1.4))
    const wheel = new THREE.Group()
    wheel.add(M(G.torus, mat(0x8aa8c0), 3.1, 3.1, 3.1, 0, 0, 0))
    wheel.add(M(G.torus, mat(0x6d7f96), 2.2, 2.2, 2.2, 0, 0, 0))
    const cabColors = [0xe07a5f, 0x4a90b8, 0xd4af37, 0x6fa06a, 0xc45c45, 0xf2f4f7]
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2
      const spoke = M(G.box, mat(0x6d7f96), 0.05, 3.0, 0.05, 0, 0, 0)
      spoke.rotation.z = a
      wheel.add(spoke)
      const cab = new THREE.Group()
      cab.add(M(G.box, mat(cabColors[i % cabColors.length]), 0.4, 0.32, 0.32, 0, 0, 0))
      cab.add(M(G.plane, mat(0xc5daf0, { basic: true, opacity: 0.85 }), 0.28, 0.2, 1, 0, 0.02, 0.18))
      cab.position.set(Math.cos(a) * 3.1, Math.sin(a) * 3.1, 0)
      wheel.add(cab)
    }
    wheel.add(M(G.cyl, mat(0x4a5568), 0.35, 0.35, 0.35, 0, 0, 0))
    wheel.position.y = 3.8
    g.add(wheel)
    g.position.set(x, 0, z)
    world.add(g)
    wheels.push({ o: wheel, spd: 0.28 })
    addLmLabel(x, z, 7.8, '대관람차', '観覧車')
  }

  function lmBridge(x0: number, x1: number, z: number) {
    const len = x1 - x0, mid = (x0 + x1) / 2
    world.add(M(G.box, mat(0xc8d0db), len, 0.2, 1.6, mid, 0.6, z))
    for (let i = 0; i < 5; i++) {
      const t = i / 4, px = x0 + 1 + t * (len - 2), rise = Math.sin(t * Math.PI)
      world.add(M(G.box, mat(0x6d7f96), 0.08, 1.6 + rise * 1.2, 0.08, px, 0.9 + rise * 0.6, z - 0.7))
      world.add(M(G.box, mat(0x6d7f96), 0.08, 1.6 + rise * 1.2, 0.08, px, 0.9 + rise * 0.6, z + 0.7))
    }
    world.add(M(G.box, mat(0x4a5568), 0.25, 2.2, 0.25, x0 + 1.2, 1.3, z))
    world.add(M(G.box, mat(0x4a5568), 0.25, 2.2, 0.25, x1 - 1.2, 1.3, z))
  }

  function lmFuji(x: number, z: number) {
    const g = new THREE.Group()
    g.add(M(G.cone, mat(0x6a8a68, { rough: 0.95 }), 3.2, 1.4, 3.2, -2.5, 0.7, 1.5))
    g.add(M(G.cone, mat(0x5e7e5c, { rough: 0.95 }), 2.8, 1.2, 2.8, 2.8, 0.6, 1.2))
    g.add(M(G.cone, mat(0x7a8da6, { rough: 0.95 }), 6.2, 5.0, 6.2, 0, 2.5, 0))
    g.add(M(G.cone, mat(0x8a9ab0, { rough: 0.9 }), 3.8, 2.2, 3.8, 0, 4.6, 0))
    g.add(M(G.cone, mat(0xf4f8fc), 2.4, 1.5, 2.4, 0, 5.9, 0))
    g.position.set(x, 0, z)
    world.add(g)
    addLmLabel(x, z, 7.4, '후지산', '富士山')
  }

  function lmLawson(x: number, z: number) {
    const g = new THREE.Group()
    g.add(M(G.box, mat(0xf7f8fa), 2.6, 1.4, 1.7, 0, 0.7, 0))
    g.add(M(G.box, mat(0x1a4a8a), 2.7, 0.32, 1.8, 0, 1.5, 0))
    g.add(M(G.box, mat(0xe07a5f), 2.7, 0.14, 1.8, 0, 1.72, 0))
    g.add(M(G.plane, mat(0xb8d4ec, { basic: true, opacity: 0.9 }), 1.9, 0.8, 1, 0, 0.6, 0.88))
    g.add(M(G.box, mat(0x1a4a8a, { basic: true }), 0.55, 0.55, 0.08, -0.9, 1.5, 0.95))
    g.add(M(G.box, mat(0xf7f8fa, { basic: true }), 0.2, 0.35, 0.05, -0.95, 1.48, 1.0))
    g.add(M(G.box, mat(0xc8d0db), 1.8, 0.05, 1.2, 1.8, 0.08, 0.2))
    g.position.set(x, 0, z)
    world.add(g)
    addLmLabel(x, z, 2.6, '후지뷰 로손', 'LAWSON')
  }

  function lmTorii(x: number, z: number) {
    const g = new THREE.Group()
    const red = 0xb84438
    g.add(M(G.box, mat(red), 0.28, 2.6, 0.28, -1.35, 1.3, 0))
    g.add(M(G.box, mat(red), 0.28, 2.6, 0.28, 1.35, 1.3, 0))
    g.add(M(G.box, mat(red), 3.4, 0.28, 0.4, 0, 2.45, 0))
    g.add(M(G.box, mat(red), 3.8, 0.16, 0.5, 0, 2.75, 0))
    g.add(M(G.box, mat(red), 2.6, 0.12, 0.2, 0, 2.1, 0))
    g.position.set(x, 0, z)
    world.add(g)
    addLmLabel(x, z, 3.4, '도리이', '鳥居')
  }

  function lmRope(x: number, z: number) {
    const g = new THREE.Group()
    g.add(M(G.cyl, mat(0x6d7f96), 0.18, 3.4, 0.18, -3.0, 1.7, 0))
    g.add(M(G.cyl, mat(0x6d7f96), 0.18, 5.0, 0.18, 3.0, 2.5, 0))
    g.add(M(G.box, mat(0x4a5568), 0.8, 0.35, 0.8, -3.0, 3.5, 0))
    g.add(M(G.box, mat(0x4a5568), 0.8, 0.35, 0.8, 3.0, 5.1, 0))
    const cable = M(G.box, mat(0x2d2a25), 6.2, 0.06, 0.06, 0, 4.0, 0)
    cable.rotation.z = -0.22
    g.add(cable)
    const car = new THREE.Group()
    car.add(M(G.box, mat(0xe07a5f), 0.7, 0.5, 0.5, 0, 0, 0))
    car.add(M(G.plane, mat(0xc5daf0, { basic: true, opacity: 0.9 }), 0.4, 0.28, 1, 0, 0.05, 0.28))
    car.position.set(0.3, 3.6, 0)
    g.add(car)
    g.position.set(x, 0, z)
    world.add(g)
    addLmLabel(x, z, 5.8, '후지산 로프웨이', 'ロープウェイ')
  }

  function lmAirport(x: number, z: number) {
    const g = new THREE.Group()
    g.add(M(G.box, mat(0x9aa4b0), 9.5, 0.1, 2.6, 0, 0.1, 0))
    g.add(M(G.box, mat(0xf2f4f7), 0.15, 0.02, 2.2, -3, 0.16, 0))
    g.add(M(G.box, mat(0xf2f4f7), 0.15, 0.02, 2.2, 0, 0.16, 0))
    g.add(M(G.box, mat(0xf2f4f7), 0.15, 0.02, 2.2, 3, 0.16, 0))
    g.add(M(G.box, mat(0xeef1f5), 4.0, 1.6, 2.2, -2.8, 0.85, 2.6))
    g.add(M(G.box, mat(0x8aa8c0), 4.1, 0.2, 2.3, -2.8, 1.7, 2.6))
    g.add(M(G.plane, mat(0xa8c8e0, { basic: true, opacity: 0.85 }), 3.4, 0.9, 1, -2.8, 0.9, 3.75))
    g.add(M(G.cyl, mat(0xdde4ec), 0.35, 3.2, 0.35, -5.2, 1.6, 2.2))
    g.add(M(G.box, mat(0x4a90b8), 1.1, 0.55, 1.1, -5.2, 3.4, 2.2))
    g.add(M(G.box, mat(0x9ec4e0, { basic: true }), 1.0, 0.35, 0.08, -5.2, 3.4, 2.78))
    const plane = new THREE.Group()
    const fus = M(G.cyl, mat(0xf2f4f7), 0.3, 3.8, 0.3, 0, 0, 0)
    fus.rotation.z = Math.PI / 2
    plane.add(fus)
    const nose = M(G.cone, mat(0xf2f4f7), 0.3, 0.75, 0.3, 2.15, 0, 0)
    nose.rotation.z = -Math.PI / 2
    plane.add(nose)
    plane.add(M(G.box, mat(0xdde4ec), 0.55, 0.07, 3.6, 0.15, 0, 0))
    plane.add(M(G.box, mat(0xe07a5f), 0.5, 0.75, 0.1, -1.55, 0.38, 0))
    plane.add(M(G.box, mat(0xdde4ec), 0.4, 0.06, 1.1, -1.4, 0.05, 0))
    plane.add(M(G.cyl, mat(0xb0b4b8), 0.12, 0.4, 0.12, 0.25, -0.15, 0.95))
    plane.add(M(G.cyl, mat(0xb0b4b8), 0.12, 0.4, 0.12, 0.25, -0.15, -0.95))
    for (let i = 0; i < 4; i++) plane.add(M(G.sph, mat(0x4a90b8, { basic: true }), 0.06, 0.06, 0.06, 0.7 - i * 0.4, 0.12, 0.22))
    plane.position.set(1.8, 0.55, 0)
    g.add(plane)
    g.position.set(x, 0, z)
    world.add(g)
    addLmLabel(x, z, 4.2, '하네다공항', '羽田空港')
  }

  function addPath(pts: THREE.Vector3[], accent: number) {
    if (pts.length < 2) return
    const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(p.x, 0.16, p.z)))
    const tube = new THREE.TubeGeometry(curve, Math.max(32, pts.length * 12), 0.14, 8, false)
    pathGlow = new THREE.Mesh(tube, mat(accent, { basic: true, opacity: 0.85 }))
    world.add(pathGlow)
    const halo = new THREE.TubeGeometry(curve, Math.max(32, pts.length * 12), 0.32, 8, false)
    world.add(new THREE.Mesh(halo, mat(accent, { basic: true, opacity: 0.12 })))
  }

  function addLife() {
    const pcs = [0xe07a5f, 0x4a90b8, 0x6fa06a, 0xd4af37, 0x6d7f96]
    for (let i = 0; i < 36; i++) {
      const g = new THREE.Group()
      g.add(M(G.cyl, mat(pick(pcs)), 0.07, 0.28, 0.07, 0, 0.14, 0))
      g.add(M(G.sph, mat(0xf0d5bd), 0.08, 0.08, 0.08, 0, 0.36, 0))
      world.add(g)
      people.push({ g, axis: Math.random() < 0.5 ? 'x' : 'z', c: pick(ROADS), t: Math.random(), spd: rnd(0.012, 0.025) * (Math.random() < 0.5 ? 1 : -1), off: rnd(-0.35, 0.35) })
    }
    for (let i = 0; i < 18; i++) {
      const g = new THREE.Group()
      g.add(M(G.box, mat(pick(pcs)), 0.72, 0.2, 0.36, 0, 0.14, 0))
      g.add(M(G.box, mat(0xe9eef3), 0.34, 0.16, 0.3, -0.04, 0.3, 0))
      world.add(g)
      cars.push({ g, axis: Math.random() < 0.5 ? 'x' : 'z', c: pick(ROADS), t: Math.random(), spd: rnd(2.6, 4.5), dir: Math.random() < 0.5 ? 1 : -1 })
    }
  }

  function addSpot(i: number, pos: THREE.Vector3, stop: { name: string; eat?: number }, accent: number) {
    const acc = stop.eat ? 0xe07a5f : accent
    const rg = new THREE.Group()
    const ring = M(G.torus, mat(acc, { basic: true }), 0.85, 0.85, 0.85, 0, 0.08, 0)
    ring.rotation.x = Math.PI / 2
    rg.add(ring)
    const disc = M(G.circle, mat(acc, { basic: true, opacity: 0.2 }), 0.85, 1, 0.85, 0, 0.05, 0)
    disc.rotation.x = -Math.PI / 2
    rg.add(disc)
    const peg = M(G.cyl, mat(acc, { basic: true }), 0.12, 0.9, 0.12, 0, 0.55, 0)
    rg.add(peg)
    const head = M(G.sph, mat(acc, { basic: true }), 0.28, 0.28, 0.28, 0, 1.15, 0)
    rg.add(head)
    rg.position.copy(pos)
    world.add(rg)
    rings.push(rg)

    const el = document.createElement('div')
    el.className = 'astra-pin' + (stop.eat ? ' eat' : '')
    el.innerHTML = `<span class="no">${i + 1}</span><span class="nm">${stop.name}</span>`
    el.onclick = () => onPick(i)
    const obj = new CSS2DObject(el)
    const dup = spots.slice(0, i).filter((p) => p.distanceTo(pos) < 0.5).length
    obj.position.set(pos.x, 2.6 + dup * 1.0, pos.z)
    world.add(obj)
    pins.push({ el, obj })
  }

  function buildDay(di: number) {
    clear()
    const day = DAYS[di]
    const th = THEMES[day.theme as string] ?? THEMES.night
    host.style.background = `radial-gradient(ellipse 90% 70% at 58% 42%, ${th.sky[1]} 0%, ${th.sky[0]} 55%, ${th.sky[0]} 100%)`
    if (scene.fog instanceof THREE.Fog) scene.fog.color.setHex(th.fog)

    const proj = projectDay(day)
    const pts = proj.stops.map((s: { km: { x: number; z: number } }) => ({
      x: s.km.x - proj.center.x, z: s.km.z - proj.center.z,
    }))
    const lmPt = proj.lm ? { x: proj.lm.x - proj.center.x, z: proj.lm.z - proj.center.z } : null
    const rmax = Math.max(...pts.map((p: { x: number; z: number }) => Math.hypot(p.x, p.z)), lmPt ? Math.hypot(lmPt.x, lmPt.z) : 0, 0.001)
    const toPos = (p: { x: number; z: number }) => {
      const r = Math.hypot(p.x, p.z)
      const rr = SPAN * Math.pow(r / rmax, 0.55)
      const k = r > 0 ? rr / r : 0
      return new THREE.Vector3(p.x * k, 0, p.z * k)
    }
    spots = pts.map(toPos)
    let lmv = lmPt ? toPos(lmPt) : new THREE.Vector3(-14, 0, -10)
    const lr = Math.hypot(lmv.x, lmv.z)
    if (lr > SPAN + 2) lmv.multiplyScalar((SPAN + 2) / lr)

    const clears = spots.map((p) => ({ x: p.x, z: p.z, r: 2.0 }))
    const seaX = th.sea ? HALF * 0.42 : null
    plate(th)
    if (th.sea) {
      const seaW = HALF - (seaX as number) + 2
      world.add(M(G.box, mat(0x7eb0c8), seaW, 0.1, HALF * 2 + 2, HALF - seaW / 2 + 0.5, 0.04, 0))
      lmBridge((seaX as number) - 4, (seaX as number) + 6, -6)
    }

    const lmR = { plane: 5.5, pagoda: 3.4, wheel: 4.0, tower: 3.2, fuji: 7.0 }[day.landmark as string] ?? 3
    clears.push({ x: lmv.x, z: lmv.z, r: lmR })
    switch (day.landmark) {
      case 'plane': lmAirport(lmv.x, lmv.z); break
      case 'pagoda':
        lmPagoda(lmv.x, lmv.z)
        lmGate(lmv.x + 4.2, lmv.z + 1.4)
        clears.push({ x: lmv.x + 4.2, z: lmv.z + 1.4, r: 2.8 })
        break
      case 'wheel': lmWheel(lmv.x, lmv.z); break
      case 'tower': lmTokyoTower(lmv.x, lmv.z); break
      case 'fuji': {
        lmFuji(lmv.x, lmv.z)
        if (di === 4) {
          lmRope(lmv.x + 7.0, lmv.z + 2.2)
          clears.push({ x: lmv.x + 7.0, z: lmv.z + 2.2, r: 3.4 })
        } else {
          lmTorii(lmv.x + 6.2, lmv.z + 2.8)
          clears.push({ x: lmv.x + 6.2, z: lmv.z + 2.8, r: 2.0 })
        }
        const li = day.stops.findIndex((s: { name: string }) => s.name.includes('로손'))
        if (li >= 0) {
          lmLawson(spots[li].x + 1.6, spots[li].z + 0.5)
          clears.push({ x: spots[li].x + 1.6, z: spots[li].z + 0.5, r: 2.2 })
        }
        break
      }
    }

    city(th, clears, seaX)
    day.stops.forEach((s: { name: string }, i: number) => {
      if (/공원/.test(s.name)) for (let k = 0; k < 8; k++) tree(spots[i].x + rnd(-1.8, 1.8), spots[i].z + rnd(-1.8, 1.8), true)
    })
    addPath(spots, th.accent)
    addLife()
    day.stops.forEach((s: { name: string; eat?: number }, i: number) => addSpot(i, spots[i], s, th.accent))
    focusT.set(0, 0.45, 0)
    focus.copy(focusT)
    flying = false
    zoomT = ZOOM0
    select(0)
  }

  function select(i: number) {
    sel = i
    if (spots[i]) {
      focusT.set(spots[i].x, 0.45, spots[i].z)
      flying = true
    }
    pins.forEach((p, k) => {
      if (!p.el.classList.contains('astra-pin')) return
      p.el.classList.toggle('sel', k === i)
      p.el.classList.toggle('dim', k !== i)
    })
  }

  const clock = new THREE.Clock()
  let last = 0, raf = 0, dead = false
  const roadSpan = HALF * 2 - 4
  function tick() {
    if (dead) return
    const t = clock.getElapsedTime()
    const dt = Math.min(t - last, 0.05)
    last = t

    // WASD pan · Q/E rotate
    if (keys.size) {
      groundAxes()
      const speed = (38 / Math.max(zoom, 8)) * dt * 18
      let moved = false
      if (keys.has('KeyW')) { focusT.addScaledVector(fwd, -speed); moved = true }
      if (keys.has('KeyS')) { focusT.addScaledVector(fwd, speed); moved = true }
      if (keys.has('KeyA')) { focusT.addScaledVector(right, -speed); moved = true }
      if (keys.has('KeyD')) { focusT.addScaledVector(right, speed); moved = true }
      if (keys.has('KeyQ')) { az += dt * 1.2; moved = true }
      if (keys.has('KeyE')) { az -= dt * 1.2; moved = true }
      if (moved) {
        clampFocus()
        focus.copy(focusT)
        flying = false
      }
    }

    if (flying) {
      focus.lerp(focusT, 1 - Math.pow(0.0012, dt))
      if (focus.distanceToSquared(focusT) < 0.01) { focus.copy(focusT); flying = false }
    }
    zoom += (zoomT - zoom) * (1 - Math.pow(0.0004, dt))
    updateCam()
    if (!paused) {
      people.forEach((w) => {
        w.t = (w.t + w.spd * dt * 10 + 1) % 1
        const s = -HALF + 2 + w.t * roadSpan, bob = Math.abs(Math.sin(t * 9 + w.off * 10)) * 0.04
        if (w.axis === 'x') w.g.position.set(s, bob, w.c + w.off)
        else w.g.position.set(w.c + w.off, bob, s)
      })
      cars.forEach((c) => {
        c.t = (c.t + (c.spd * c.dir * dt) / roadSpan + 1) % 1
        const s = -HALF + 2 + c.t * roadSpan
        if (c.axis === 'x') {
          c.g.position.set(s, 0, c.c + 0.35 * c.dir)
          c.g.rotation.y = c.dir > 0 ? 0 : Math.PI
        } else {
          c.g.position.set(c.c + 0.35 * c.dir, 0, s)
          c.g.rotation.y = c.dir > 0 ? -Math.PI / 2 : Math.PI / 2
        }
      })
    }
    wheels.forEach((w) => { w.o.rotation.z = t * w.spd })
    rings.forEach((r, i) => {
      const k = i === sel ? 1 + Math.abs(Math.sin(t * 2.8)) * 0.2 : 1
      r.scale.setScalar(k)
    })
    if (pathGlow) {
      const m = pathGlow.material as THREE.MeshBasicMaterial
      m.opacity = 0.7 + Math.sin(t * 2) * 0.12
    }
    renderer.render(scene, cam)
    labelR.render(scene, cam)
    raf = requestAnimationFrame(tick)
  }

  let mode: 'none' | 'pan' | 'orbit' = 'none'
  let px = 0, py = 0
  const offs: (() => void)[] = []
  const on = (el: HTMLElement | Window, type: string, fn: EventListener, opts?: AddEventListenerOptions) => {
    el.addEventListener(type, fn, opts)
    offs.push(() => el.removeEventListener(type, fn, opts))
  }
  on(host, 'contextmenu', ((e: Event) => e.preventDefault()) as EventListener)
  on(host, 'pointerdown', ((e: PointerEvent) => {
    if (e.button === 2 || e.button === 1 || e.altKey) mode = 'orbit'
    else if (e.button === 0) mode = 'pan'
    else return
    px = e.clientX; py = e.clientY
    host.setPointerCapture?.(e.pointerId)
    flying = false
  }) as EventListener)
  on(host, 'pointermove', ((e: PointerEvent) => {
    if (mode === 'none') return
    const dx = e.clientX - px, dy = e.clientY - py
    px = e.clientX; py = e.clientY
    if (mode === 'pan') panScreen(dx, dy)
    else {
      az -= dx * 0.005
      elev = Math.max(0.14, Math.min(0.52, elev + dy * 0.003))
    }
  }) as EventListener)
  on(host, 'pointerup', (() => { mode = 'none' }) as EventListener)
  on(host, 'pointercancel', (() => { mode = 'none' }) as EventListener)
  on(host, 'wheel', ((e: WheelEvent) => {
    e.preventDefault()
    zoomT = Math.max(8, Math.min(48, zoomT * (1 - e.deltaY * 0.0011)))
  }) as EventListener, { passive: false })
  on(window, 'keydown', ((e: KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return
    const tag = (e.target as HTMLElement)?.tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA') return
    if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE'].includes(e.code)) {
      keys.add(e.code)
      e.preventDefault()
    }
  }) as EventListener)
  on(window, 'keyup', ((e: KeyboardEvent) => { keys.delete(e.code) }) as EventListener)
  on(window, 'blur', (() => { keys.clear() }) as EventListener)
  on(window, 'resize', (() => {
    const w = host.clientWidth, h = host.clientHeight
    renderer.setSize(w, h); labelR.setSize(w, h)
    cam.left = -w / 2; cam.right = w / 2; cam.top = h / 2; cam.bottom = -h / 2
    cam.updateProjectionMatrix()
  }) as EventListener)

  updateCam()
  tick()

  return {
    buildDay,
    select,
    zoomBy: (f) => { zoomT = Math.max(8, Math.min(48, zoomT * f)) },
    reset: () => {
      az = AZ0; elev = EL0; zoomT = ZOOM0
      focusT.set(0, 0.45, 0); focus.copy(focusT); flying = false
    },
    setPaused: (p) => { paused = p },
    dispose: () => {
      dead = true
      cancelAnimationFrame(raf)
      offs.forEach((fn) => fn())
      clear()
      cache.forEach((m) => m.dispose())
      Object.values(G).forEach((g) => g.dispose())
      renderer.dispose()
      renderer.domElement.remove()
      labelsEl.replaceChildren()
    },
  }
}

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

export default function AstraDioramaPage() {
  const hostRef = useRef<HTMLDivElement>(null)
  const labelRef = useRef<HTMLDivElement>(null)
  const eng = useRef<Engine | null>(null)
  const [dayIdx, setDayIdx] = useState(0)
  const [selIdx, setSelIdx] = useState(0)
  const [paused, setPaused] = useState(false)
  const [open, setOpen] = useState(true)

  useEffect(() => {
    if (!hostRef.current || !labelRef.current) return
    const e = createEngine(hostRef.current, labelRef.current, setSelIdx)
    eng.current = e
    return () => { e.dispose(); eng.current = null }
  }, [])

  useEffect(() => { eng.current?.buildDay(dayIdx) }, [dayIdx])
  useEffect(() => { eng.current?.select(selIdx) }, [selIdx])
  useEffect(() => { eng.current?.setPaused(paused) }, [paused])

  const selectDay = useCallback((i: number) => { setDayIdx(i); setSelIdx(0) }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') selectDay(Math.min(dayIdx + 1, DAYS.length - 1))
      if (e.key === 'ArrowLeft') selectDay(Math.max(dayIdx - 1, 0))
      if (e.key === 'ArrowDown') setSelIdx((s) => Math.min(s + 1, DAYS[dayIdx].stops.length - 1))
      if (e.key === 'ArrowUp') setSelIdx((s) => Math.max(s - 1, 0))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [dayIdx, selectDay])

  const day = DAYS[dayIdx]
  const stop = (day.stops[selIdx] ?? day.stops[0]) as StopView

  return (
    <div className="astra-root">
      <div className="astra-scene" ref={hostRef} />
      <div className="astra-labels" ref={labelRef} />

      <div className="astra-vignette" aria-hidden />

      <aside className="astra-rail">
        {DAYS.map((d: { no: string; d: string }, i: number) => (
          <button
            key={d.no}
            type="button"
            className={'astra-rail-day' + (i === dayIdx ? ' on' : '')}
            onClick={() => selectDay(i)}
          >
            <span className="n">{d.no}</span>
            <span className="d">{d.d.split(' ')[1]}</span>
          </button>
        ))}
      </aside>

      <header className="astra-brand">
        <p className="kicker">ASTRA MAP · TOKYO WALK</p>
        <h1>{day.t}</h1>
        <p className="sub">DAY {day.no} · {day.d} · {day.region}</p>
      </header>

      <div className="astra-alts">
        <Link to="/diorama">기존 디오라마</Link>
        <Link to="/">실측 지도</Link>
      </div>

      <section className={'astra-sheet' + (open ? ' open' : '')}>
        <button type="button" className="astra-sheet-toggle" onClick={() => setOpen((v) => !v)}>
          {open ? '접기' : '일정 펼치기'}
        </button>
        <div className="astra-sheet-body">
          <ol className="astra-stops">
            {day.stops.map((s: { name: string; time: string; eat?: number }, i: number) => (
              <li key={i}>
                <button
                  type="button"
                  className={'astra-stop' + (i === selIdx ? ' on' : '') + (s.eat ? ' eat' : '')}
                  onClick={() => setSelIdx(i)}
                >
                  <span className="ix">{i + 1}</span>
                  <span className="meta">
                    <span className="tm">{s.time}</span>
                    <span className="nm">{s.name}</span>
                  </span>
                </button>
              </li>
            ))}
          </ol>
          <article className="astra-card">
            <p className="place">
              PLACE {String(selIdx + 1).padStart(2, '0')}
              {stop.eat ? ' · EAT' : stop.stay ? ' · STAY' : ''}
            </p>
            <h2>{stop.name}</h2>
            {stop.jp && <p className="jp">{stop.jp}</p>}
            <p className="body">{stop.why || stop.note}</p>
            {(stop.see || stop.via) && (
              <p className="tip">{stop.see || stop.via}</p>
            )}
          </article>
        </div>
      </section>

      <div className="astra-ctrl">
        <button type="button" onClick={() => eng.current?.zoomBy(1.2)}>＋</button>
        <button type="button" onClick={() => eng.current?.zoomBy(0.84)}>−</button>
        <button type="button" onClick={() => eng.current?.reset()}>리셋</button>
        <button type="button" onClick={() => setPaused((p) => !p)}>{paused ? '재생' : '멈춤'}</button>
      </div>

      <p className="astra-help">드래그 이동 · 우클릭/Alt 회전 · WASD 이동 · QE 회전 · 휠 줌 · ←→ 날짜</p>
    </div>
  )
}
