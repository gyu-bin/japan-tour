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
const EL0 = 0.62 // ~35.5° classic isometric
const DIST = 120
const ZOOM0 = 12
const SPAN = 22 // stop / landmark layout radius

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
    sky: ['#1a2230', '#33435a'], fog: 0x1e2838,
    plate: 0xc4ccd6, rim: 0x59636f, road: 0xa9b2bd,
    park: 0x6f8f72, walls: [0xf1f3f6, 0xe7ebf0, 0xf4f2ee, 0xdfe4ea],
    roofs: [0xd9dfe6, 0xc7cfd8, 0x8496ab], accent: 0xe07a5f,
    cool: [0x9db6c8, 0x8aa8bc, 0x7f95a8], warmP: 0.12, tall: 1.15, empty: 0.05, trees: 0.12,
  },
  asakusa: {
    sky: ['#1b222e', '#354256'], fog: 0x202a38,
    plate: 0xd2cfc6, rim: 0x625d55, road: 0xb8b3a8,
    park: 0x6f8f66, walls: [0xfaf6ef, 0xf3ebe0, 0xf7f0e6, 0xefe6d8],
    roofs: [0xb85a48, 0x9e4a3c, 0xc9cbc8, 0x6d7f96], accent: 0xe07a5f,
    cool: [0x9aa8b8], warmP: 0.6, tall: 0.72, empty: 0.04, trees: 0.2,
  },
  odaiba: {
    sky: ['#182230', '#33465c'], fog: 0x1c2a3a,
    plate: 0xc3cad3, rim: 0x545e6a, road: 0xa7b0ba,
    park: 0x668a7c, walls: [0xf3f6f8, 0xe9f0f4, 0xeef2f5, 0xe2eaee],
    roofs: [0xdbe1e7, 0xcbd3db, 0xb4c6d4], accent: 0xe07a5f,
    cool: [0x9fb9cb, 0x8db0c6, 0xb3c9d8], warmP: 0.08, tall: 1.5, empty: 0.06, trees: 0.1, sea: true,
  },
  roppongi: {
    sky: ['#161c28', '#2d3a4e'], fog: 0x1a2230,
    plate: 0xbfc5ce, rim: 0x505864, road: 0xa2aab4,
    park: 0x62806a, walls: [0xf0f1f4, 0xe6e8ec, 0xf4f2ee, 0xdddfe4],
    roofs: [0xd0d6de, 0x9ea9b8, 0x6d7f96], accent: 0xe07a5f,
    cool: [0x8fa4b8, 0x7d92a8, 0xa9bccb], warmP: 0.1, tall: 1.9, empty: 0.04, trees: 0.08,
  },
  fuji: {
    sky: ['#182028', '#334450'], fog: 0x1c2830,
    plate: 0xcdd4c2, rim: 0x5c675a, road: 0xb0baa2,
    park: 0x648a5e, walls: [0xf7f3ea, 0xf0e8dc, 0xefe9e0],
    roofs: [0xb85a48, 0x9e4a3c, 0xcfd3d1, 0x6d7f96], accent: 0xe07a5f,
    cool: [0x8fa0ad], warmP: 0.5, tall: 0.48, empty: 0.38, trees: 0.62, green: true,
  },
}

type ExtraLandmark = 'skytree' | 'fujiTV' | 'mori' | 'nakamise' | 'liberty' | 'moat' | 'ryokan' | 'lake' | 'government'
// Zero-based day index; positions remain local to this page.
const EXTRA_LM: Partial<Record<number, { fn: ExtraLandmark; dx: number; dz: number; r: number }[]>> = {
  1: [{ fn: 'skytree', dx: 10, dz: -8, r: 4 }, { fn: 'nakamise', dx: 0, dz: 4.7, r: 3.5 }],
  2: [{ fn: 'fujiTV', dx: -13, dz: -7, r: 6 }, { fn: 'liberty', dx: -1, dz: 12, r: 3 }],
  3: [{ fn: 'mori', dx: -11, dz: -7, r: 5 }, { fn: 'moat', dx: -23, dz: 8, r: 7 }],
  4: [{ fn: 'lake', dx: -3, dz: 12, r: 7.5 }, { fn: 'ryokan', dx: -12, dz: 1, r: 4 }],
  5: [{ fn: 'lake', dx: -3, dz: 12, r: 7.5 }, { fn: 'ryokan', dx: -12, dz: 1, r: 4 }, { fn: 'government', dx: -16, dz: -12, r: 5 }],
}

function eventScope() {
  const offs = new Set<() => void>()
  const on = (el: HTMLElement | Window, type: string, fn: EventListener, opts?: AddEventListenerOptions) => {
    el.addEventListener(type, fn, opts)
    const off = () => { el.removeEventListener(type, fn, opts); offs.delete(off) }
    offs.add(off)
    return off
  }
  return { on, dispose: () => { offs.forEach((off) => off()) } }
}

type Engine = {
  buildDay: (i: number) => void
  select: (i: number) => void
  zoomBy: (f: number) => void
  reset: () => void
  setAutoRotate: (active: boolean) => void
  front: () => void
  setPaused: (p: boolean) => void
  setSideOffset: (px: number) => void
  dispose: () => void
}

function createEngine(host: HTMLDivElement, labelsEl: HTMLDivElement, onPick: (i: number) => void, compass: HTMLSpanElement, onRotate: (active: boolean) => void): Engine {
  const scene = new THREE.Scene()
  scene.fog = new THREE.Fog(0x162430, 90, 260)

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' })
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
  renderer.setSize(host.clientWidth, host.clientHeight)
  renderer.setClearColor(0x000000, 0)
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.12
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  // Buildings are static: render their shadow map only when a day is rebuilt.
  renderer.shadowMap.autoUpdate = false
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
  key.castShadow = true
  key.shadow.mapSize.set(2048, 2048)
  key.shadow.bias = -0.0005
  key.shadow.normalBias = 0.03
  key.shadow.intensity = 0.45
  // The plate corners extend beyond HALF in light-space; include the diagonal
  // and the tallest landmark rather than clipping shadows at the plate edges.
  const shadowExtent = HALF * Math.SQRT2 + 8
  Object.assign(key.shadow.camera, {
    left: -shadowExtent, right: shadowExtent,
    top: shadowExtent, bottom: -shadowExtent, near: 0.5, far: 160,
  })
  key.position.multiplyScalar(2.5)
  key.shadow.camera.updateProjectionMatrix()
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
    skytree: (() => {
      const positions: number[] = [], indices: number[] = []
      const sides = 48, levels = 24
      for (let j = 0; j <= levels; j++) {
        const t = j / levels, radius = 1.12 * (1 - t) + 0.25 * t
        for (let i = 0; i <= sides; i++) {
          const a = i / sides * Math.PI * 2
          const sector = ((a + Math.PI / 3) % (Math.PI * 2 / 3)) - Math.PI / 3
          const triangle = 0.5 / Math.cos(sector)
          const r = radius * (triangle * (1 - t) + t)
          positions.push(Math.cos(a) * r, t * 10.8, Math.sin(a) * r)
          if (j < levels && i < sides) {
            const n = j * (sides + 1) + i
            indices.push(n, n + sides + 1, n + 1, n + 1, n + sides + 1, n + sides + 2)
          }
        }
      }
      const geo = new THREE.BufferGeometry()
      geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
      geo.setIndex(indices); geo.computeVertexNormals()
      return geo
    })(),
    taper: new THREE.CylinderGeometry(0.72, 1, 1, 4),
    mori: new THREE.LatheGeometry([
      new THREE.Vector2(0, 0), new THREE.Vector2(2.1, 0),
      new THREE.Vector2(2.3, 1), new THREE.Vector2(2.45, 5),
      new THREE.Vector2(2.25, 9), new THREE.Vector2(1.8, 11.5), new THREE.Vector2(0, 11.5),
    ], 32),
    wedge: (() => {
      const s = new THREE.Shape()
      s.moveTo(-0.5, 0); s.lineTo(0.5, 0); s.lineTo(0, 0.55); s.closePath()
      return new THREE.ExtrudeGeometry(s, { depth: 1, bevelEnabled: false })
    })(),
  }

  const textures: THREE.Texture[] = []
  function canvasTexture(draw: (ctx: CanvasRenderingContext2D) => void, w = 128, h = 128) {
    const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h
    const ctx = canvas.getContext('2d')!
    draw(ctx)
    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    textures.push(texture)
    return texture
  }
  const softTexture = canvasTexture((ctx) => {
    const gradient = ctx.createRadialGradient(64, 64, 2, 64, 64, 62)
    gradient.addColorStop(0, 'rgba(255,255,255,0.8)'); gradient.addColorStop(0.4, 'rgba(255,255,255,0.35)')
    gradient.addColorStop(1, 'rgba(255,255,255,0)'); ctx.fillStyle = gradient; ctx.fillRect(0, 0, 128, 128)
  })
  const inscriptionTexture = canvasTexture((ctx) => {
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#fff'
    ctx.font = '52px Georgia, serif'; ctx.fillText('Tokyo Walk', 256, 64)
  }, 512, 128)
  const moonTexture = canvasTexture((ctx) => {
    ctx.fillStyle = '#f3e7cc'; ctx.beginPath(); ctx.arc(64, 64, 42, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = 'rgba(133,136,144,.15)'
    for (const [x, y, r] of [[52, 52, 10], [73, 74, 13], [48, 79, 6], [79, 43, 5]]) {
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill()
    }
  })
  const skyTexture = canvasTexture((ctx) => {
    const gradient = ctx.createLinearGradient(0, 0, 0, 128)
    gradient.addColorStop(0, '#293951'); gradient.addColorStop(0.48, '#b9d0df')
    gradient.addColorStop(0.55, '#637c90'); gradient.addColorStop(1, '#263c44')
    ctx.fillStyle = gradient; ctx.fillRect(0, 0, 256, 128)
  }, 256, 128)
  skyTexture.mapping = THREE.EquirectangularReflectionMapping
  const cache = new Map<string, THREE.Material>()
  function mat(c: number, o: { basic?: boolean; opacity?: number; rough?: number; metal?: number; emissive?: number; sprite?: boolean; points?: boolean; map?: THREE.Texture; env?: boolean } = {}) {
    const k = `${c}|${o.basic ? 1 : 0}|${o.opacity ?? 1}|${o.rough ?? 0.85}|${o.metal ?? 0.02}|${o.emissive ?? 0}|${o.sprite ?? false}|${o.points ?? false}|${o.map?.uuid ?? ""}|${o.env ?? false}`
    let m = cache.get(k)
    if (m) return m
    if (o.sprite) {
      m = new THREE.SpriteMaterial({ color: c, map: o.map ?? null, transparent: true, opacity: o.opacity ?? 1, depthWrite: false })
    } else if (o.points) {
      m = new THREE.PointsMaterial({ color: c, map: o.map ?? null, size: 0.16, transparent: true, opacity: o.opacity ?? 1, depthWrite: false })
    } else if (o.basic) {
      m = new THREE.MeshBasicMaterial({
        color: c, map: o.map ?? null, side: THREE.DoubleSide, transparent: (o.opacity ?? 1) < 1, opacity: o.opacity ?? 1, depthWrite: (o.opacity ?? 1) > 0.95,
      })
    } else {
      m = new THREE.MeshStandardMaterial({
        color: c, envMap: o.env ? skyTexture : null, envMapIntensity: 0.75, roughness: o.rough ?? 0.88, metalness: o.metal ?? 0.02, emissive: o.emissive ?? 0, emissiveIntensity: 0.4,
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
    // Emissive overlays and thin planes must not darken the miniature.
    o.castShadow = m instanceof THREE.MeshStandardMaterial && !m.transparent && geo !== G.plane && geo !== G.circle
    o.receiveShadow = m instanceof THREE.MeshStandardMaterial
    o.scale.set(sx, sy, sz)
    o.position.set(x, y, z)
    return o
  }

  type Part = { x: number; y: number; z: number; sx: number; sy: number; sz: number; ry?: number; rz?: number }
  function instances(parent: THREE.Object3D, geo: THREE.BufferGeometry, material: THREE.Material, parts: Part[]) {
    const mesh = new THREE.InstancedMesh(geo, material, parts.length)
    const dummy = new THREE.Object3D()
    parts.forEach((p, i) => {
      dummy.position.set(p.x, p.y, p.z); dummy.scale.set(p.sx, p.sy, p.sz)
      dummy.rotation.set(0, p.ry ?? 0, p.rz ?? 0); dummy.updateMatrix()
      mesh.setMatrixAt(i, dummy.matrix)
    })
    mesh.instanceMatrix.needsUpdate = true
    mesh.castShadow = material instanceof THREE.MeshStandardMaterial && !material.transparent
    mesh.receiveShadow = material instanceof THREE.MeshStandardMaterial
    parent.add(mesh)
    return mesh
  }

  const rnd = (a: number, b: number) => a + Math.random() * (b - a)
  const pick = <T,>(a: T[]) => a[(Math.random() * a.length) | 0]

  let az = AZ0, elev = EL0, zoom = ZOOM0, zoomT = ZOOM0
  const focus = new THREE.Vector3(), focusT = new THREE.Vector3()
  let sideOffsetPx = 0
  let autoRotate = false
  function setAutoRotate(active: boolean) {
    if (autoRotate === active) return
    autoRotate = active
    onRotate(active)
  }
  let flying = false
  let paused = false
  let sel = 0
  const keys = new Set<string>()
  const right = new THREE.Vector3()
  const fwd = new THREE.Vector3()
  let dayOffs: (() => void)[] = []
  let pins: { el: HTMLElement; obj: CSS2DObject }[] = []
  let spots: THREE.Vector3[] = []
  let people: { g: THREE.Group; axis: string; c: number; t: number; spd: number; off: number }[] = []
  let cars: { g: THREE.Group; axis: string; c: number; t: number; spd: number; dir: number }[] = []
  let wheels: { o: THREE.Object3D; spd: number }[] = []
  let rings: THREE.Object3D[] = []
  let animations: ((t: number, dt: number) => void)[] = []
  let animationTime = 0
  let pathMat: THREE.MeshBasicMaterial | null = null
  let haloMat: THREE.MeshBasicMaterial | null = null

  /** 판 전체가 화면에 들어오는 줌 (사이드바 제외 영역 기준) */
  function fitZoom() {
    const w = Math.max(320, host.clientWidth - sideOffsetPx * 2 - 40)
    const h = Math.max(240, host.clientHeight - 210)
    const diag = HALF * 2 * Math.SQRT2 + 6
    const depth = diag * Math.sin(elev) + 14
    return Math.max(2, Math.min(w / diag, h / depth))
  }

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

  const lookAt = new THREE.Vector3()
  function updateCam() {
    groundAxes()
    // 사이드바 폭만큼 판을 화면 오른쪽으로 밀어 보이게 (타깃을 왼쪽으로 이동)
    lookAt.copy(focus).addScaledVector(right, -sideOffsetPx / Math.max(zoom, 1))
    const x = lookAt.x + Math.cos(elev) * Math.sin(az) * DIST
    const y = lookAt.y + Math.sin(elev) * DIST
    const z = lookAt.z + Math.cos(elev) * Math.cos(az) * DIST
    compass.style.transform = `rotate(${-az * 180 / Math.PI}deg)`
    cam.position.set(x, y, z)
    cam.lookAt(lookAt)
    cam.zoom = zoom
    cam.updateProjectionMatrix()
  }

  function clear() {
    animations = []; animationTime = 0
    dayOffs.forEach((off) => off()); dayOffs = []
    const shared = new Set<THREE.BufferGeometry>(Object.values(G))
    const released = new Set<THREE.BufferGeometry>()
    world.traverse((o) => {
      if (o instanceof THREE.InstancedMesh) o.dispose()
      if ((o instanceof THREE.Mesh || o instanceof THREE.Points) && !shared.has(o.geometry) && !released.has(o.geometry)) {
        released.add(o.geometry); o.geometry.dispose()
      }
    })
    while (world.children.length) world.remove(world.children[0])
    labelsEl.querySelectorAll('.astra-pin, .astra-lm').forEach((n) => n.remove())
    pins = []; people = []; cars = []; wheels = []; rings = []; spots = []
    pathMat?.dispose(); haloMat?.dispose()
    pathMat = null; haloMat = null
  }

  function plate(th: Theme, seaX: number | null) {
    const base = M(G.box, mat(th.rim), HALF * 2 + 1.6, 0.55, HALF * 2 + 1.6, 0, -0.28, 0)
    base.castShadow = false
    world.add(base)
    const top = M(G.box, mat(th.plate), HALF * 2, 0.18, HALF * 2, 0, 0.02, 0)
    top.castShadow = false
    world.add(top)
    const lip = M(G.box, mat(th.rim, { rough: 0.6 }), HALF * 2 + 0.35, 0.22, HALF * 2 + 0.35, 0, -0.02, 0)
    lip.castShadow = false
    world.add(lip)

    for (const [y, h, color] of [[-0.67, 0.28, 0x786655], [-0.96, 0.3, 0x525963], [-1.22, 0.22, 0x373f49]]) {
      const layer = M(G.box, mat(color), HALF * 2 + 1.5, h, HALF * 2 + 1.5, 0, y, 0)
      layer.castShadow = false; world.add(layer)
    }
    const inscription = M(G.plane, mat(0xc5c8bf, { basic: true, opacity: 0.72, map: inscriptionTexture }), 9, 0.75, 1, 18, -0.81, HALF + 0.81)
    world.add(inscription)
    const landR = seaX !== null ? seaX - 0.4 : HALF - 0.3
    const landLen = landR - (-HALF + 0.3)
    for (const r of ROADS) {
      world.add(M(G.box, mat(th.road), landLen, 0.04, 1.15, (landR + (-HALF + 0.3)) / 2, 0.12, r))
      if (seaX === null || r < seaX - 0.8) world.add(M(G.box, mat(th.road), 1.15, 0.04, HALF * 2 - 0.6, r, 0.12, 0))
    }
    const paint: Part[] = []
    for (const road of ROADS) {
      for (let v = -HALF + 1; v < landR; v += 1.5) {
        if (!ROADS.some((cross) => Math.abs(v - cross) < 1.5)) paint.push({ x: v, y: 0.151, z: road, sx: 0.65, sy: 0.008, sz: 0.045 })
      }
      if (seaX !== null && road >= seaX - 0.8) continue
      for (let v = -HALF + 1; v < HALF - 1; v += 1.5) {
        if (!ROADS.some((cross) => Math.abs(v - cross) < 1.5)) paint.push({ x: road, y: 0.151, z: v, sx: 0.045, sy: 0.008, sz: 0.65 })
      }
      for (const cross of ROADS) for (const side of [-1, 1]) for (let stripe = 0; stripe < 4; stripe++) {
        paint.push({ x: road + (stripe - 1.5) * 0.24, y: 0.152, z: cross + side * 0.97, sx: 0.13, sy: 0.008, sz: 0.52 })
        if (road + side * 0.97 < landR) paint.push({ x: road + side * 0.97, y: 0.152, z: cross + (stripe - 1.5) * 0.24, sx: 0.52, sy: 0.008, sz: 0.13 })
      }
    }
    const markings = instances(world, G.box, mat(0xe7e3d3), paint)
    markings.castShadow = false
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
        if (clears.some((c) => Math.hypot(jx - c.x, jz - c.z) < c.r + 1.8)) continue
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
        const glow = new THREE.InstancedMesh(G.plane, mat(color, { basic: true, opacity: 0.12, map: softTexture }), list.length)
        const dummy = new THREE.Object3D()
        list.forEach((w, i) => {
          dummy.position.set(w.x, w.y, w.z)
          dummy.scale.set(w.sx, w.sy, 1)
          dummy.rotation.set(0, w.rotY, 0)
          dummy.updateMatrix()
          inst.setMatrixAt(i, dummy.matrix)
          dummy.position.x += Math.sin(w.rotY) * 0.008
          dummy.position.z += Math.cos(w.rotY) * 0.008
          dummy.scale.set(w.sx * 2.4, w.sy * 1.8, 1); dummy.updateMatrix()
          glow.setMatrixAt(i, dummy.matrix)
        })
        inst.instanceMatrix.needsUpdate = true
        glow.instanceMatrix.needsUpdate = true
        world.add(inst, glow)
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

  function lmSkytree(x: number, z: number) {
    const g = new THREE.Group()
    g.add(M(G.cyl, mat(0xbfcbd5), 1.7, 0.25, 1.7, 0, 0.2, 0))
    g.add(M(G.skytree, mat(0xe1e8ef, { metal: 0.4, rough: 0.4 }), 1, 1, 1, 0, 0.3, 0))
    const bands: Part[] = []
    for (let i = 0; i < 3; i++) {
      const a = i * Math.PI * 2 / 3
      bands.push({ x: Math.cos(a) * 0.28, y: 7, z: Math.sin(a) * 0.28, sx: 0.035, sy: 6.5, sz: 0.035 })
    }
    instances(g, G.box, mat(0x888dff, { emissive: 0x777bff }), bands)
    for (const [y, r] of [[8, 0.94], [10.1, 0.68]]) {
      g.add(M(G.cyl, mat(0xa5b6d1, { metal: 0.6, rough: 0.22 }), r, 0.45, r, 0, y, 0))
      const ring = M(G.torus, mat(0xa3aaff, { basic: true }), r, r, r, 0, y + 0.18, 0)
      ring.rotation.x = Math.PI / 2; g.add(ring)
    }
    g.add(M(G.cyl, mat(0xe7edf4), 0.085, 3, 0.085, 0, 12.3, 0))
    g.add(M(G.sph, mat(0xb4bbff, { basic: true }), 0.09, 0.09, 0.09, 0, 13.85, 0))
    g.position.set(x, 0, z); world.add(g)
    addLmLabel(x, z, 14.5, '도쿄 스카이트리', '東京スカイツリー')
  }

  function lmFujiTV(x: number, z: number) {
    const g = new THREE.Group(), bars: Part[] = []
    g.add(M(G.box, mat(0x70899e, { rough: 0.28, metal: 0.5 }), 2, 7, 3.3, -3.5, 3.5, 0))
    g.add(M(G.box, mat(0x70899e, { rough: 0.28, metal: 0.5 }), 2, 7, 3.3, 3.5, 3.5, 0))
    for (const zz of [-1.8, 1.8]) {
      for (let i = -4; i <= 4; i++) bars.push({ x: i, y: 4.2, z: zz, sx: 0.13, sy: 8.4, sz: 0.13 })
      for (let i = 1; i <= 7; i++) bars.push({ x: 0, y: i * 1.15, z: zz, sx: 9, sy: 0.13, sz: 0.13 })
    }
    instances(g, G.box, mat(0xcbd4de, { metal: 0.55, rough: 0.4 }), bars)
    g.add(M(G.box, mat(0xb8c9d8), 9.4, 0.6, 4.1, 0, 8.5, 0))
    // Oversized observation sphere projects in front of the open grid.
    g.add(M(G.sph, mat(0xd5dee8, { rough: 0.16, metal: 0.85 }), 1.9, 1.9, 1.9, 0.7, 5.7, 1.75))
    const belt = M(G.torus, mat(0x8393a7), 1.92, 1.92, 1.92, 0.7, 5.7, 1.75)
    belt.rotation.x = Math.PI / 2; g.add(belt)
    g.position.set(x, 0, z); world.add(g)
    addLmLabel(x, z, 9.5, '후지TV 본사', 'フジテレビ本社')
  }

  function lmMori(x: number, z: number) {
    const g = new THREE.Group()
    g.add(M(G.mori, mat(0x718b9e, { rough: 0.2, metal: 0.65 }), 1, 1, 0.85, 0, 0.2, 0))
    const bands: Part[] = []
    for (let i = 1; i <= 30; i++) {
      const y = i * 0.37
      const r = y < 5 ? 2.3 + (y - 1) * 0.0375 : y < 9 ? 2.45 - (y - 5) * 0.05 : 2.25 - (y - 9) * 0.18
      // Torus lies in XY; rotate the batched mesh to wrap the tower horizontally.
      bands.push({ x: 0, y: 0, z: y + 0.2, sx: r, sy: r * 0.85, sz: 0.32 })
    }
    const rings = instances(g, G.torus, mat(0xb7c7d3, { metal: 0.5 }), bands)
    rings.rotation.x = -Math.PI / 2
    g.add(M(G.cyl, mat(0xb6c5d2), 1.83, 0.22, 1.56, 0, 11.75, 0))
    g.position.set(x, 0, z); world.add(g)
    addLmLabel(x, z, 12.8, '롯폰기 모리타워', '六本木ヒルズ森タワー')
  }

  function lmNakamise(x: number, z: number) {
    const g = new THREE.Group(), pillars: Part[] = [], roofs: Part[] = [], stalls: Part[] = []
    for (const side of [-1, 1]) for (let i = 0; i < 5; i++) {
      pillars.push({ x: side * 1.08, y: 0.8, z: i - 2, sx: 0.1, sy: 1.6, sz: 0.1 })
      stalls.push({ x: side * 1.65, y: 0.65, z: i - 2, sx: 0.8, sy: 1.3, sz: 0.86 })
      roofs.push({ x: side * 1.55, y: 1.55, z: i - 2, sx: 1.05, sy: 0.12, sz: 0.98 })
    }
    g.add(M(G.box, mat(0xd4bc9c), 4.2, 0.1, 5.5, 0, 0.19, 0))
    instances(g, G.box, mat(0x8c4d36), stalls)
    instances(g, G.box, mat(0xbf4037), pillars)
    instances(g, G.box, mat(0xe7bc55), roofs)
    g.position.set(x, 0, z); world.add(g)
    addLmLabel(x, z, 2.5, '나카미세 상점가', '仲見世商店街')
  }

  function lmLiberty(x: number, z: number) {
    const g = new THREE.Group(), copper = mat(0x63a89b, { metal: 0.25 })
    g.add(M(G.box, mat(0xa59b87), 2, 0.35, 2, 0, 0.3, 0))
    g.add(M(G.box, mat(0xc1b59c), 1.2, 1.35, 1.2, 0, 1.05, 0))
    g.add(M(G.cone, copper, 0.48, 1.85, 0.4, 0, 2.55, 0))
    g.add(M(G.sph, copper, 0.23, 0.28, 0.23, 0, 3.7, 0))
    const arm = M(G.cyl, copper, 0.105, 1.6, 0.105, -0.46, 3.7, 0)
    arm.rotation.z = -0.45; g.add(arm)
    g.add(M(G.box, copper, 0.4, 0.65, 0.14, 0.35, 3.05, 0.3))
    g.add(M(G.cyl, mat(0x867752), 0.06, 0.5, 0.06, -0.8, 4.6, 0))
    g.add(M(G.cone, mat(0xffd591, { emissive: 0xff9933 }), 0.17, 0.45, 0.17, -0.8, 4.95, 0))
    const crown: Part[] = []
    for (let i = 0; i < 7; i++) {
      const a = i / 6 * Math.PI
      crown.push({ x: Math.cos(a) * 0.28, y: 3.8 + Math.sin(a) * 0.2, z: 0, sx: 0.045, sy: 0.3, sz: 0.045, rz: a - Math.PI / 2 })
    }
    instances(g, G.cone, copper, crown)
    g.position.set(x, 0, z); world.add(g)
    addLmLabel(x, z, 5.7, '자유의 여신상', '自由の女神像')
  }

  function lmMoat(x: number, z: number) {
    const g = new THREE.Group()
    // Rotated four-sided frustum makes a battered stone wall, wider at its foot.
    const wall = M(G.taper, mat(0x66716b), 1, 1, 1, 0, 0, 0)
    wall.rotation.y = Math.PI / 4
    const wallGroup = new THREE.Group(); wallGroup.add(wall)
    wallGroup.scale.set(1.7, 1.9, 7.5); wallGroup.position.set(-1.7, 1.1, 0)
    g.add(wallGroup)
    g.add(M(G.box, mat(0x507e87, { rough: 0.12, metal: 0.65, env: true }), 2.5, 0.1, 11.5, 0.65, 0.22, 0))
    const stones: Part[] = []
    for (let row = 0; row < 4; row++) for (let i = 0; i < 12; i++) {
      stones.push({ x: -0.47 - row * 0.09, y: 0.35 + row * 0.4, z: (i - 5.5) * 0.8 + row % 2 * 0.18, sx: 0.07, sy: 0.025, sz: 0.69 })
    }
    instances(g, G.box, mat(0x90958a), stones)
    const trunks: Part[] = [], crowns: Part[] = []
    for (let i = 0; i < 4; i++) {
      const zz = -4.2 + i * 2.8
      trunks.push({ x: -2.6, y: 2.2, z: zz, sx: 0.12, sy: 2.4, sz: 0.12 })
      crowns.push({ x: -2.4, y: 3.15, z: zz, sx: 0.9, sy: 0.3, sz: 0.72 })
      crowns.push({ x: -2.7, y: 3.6, z: zz, sx: 0.6, sy: 0.25, sz: 0.6 })
    }
    instances(g, G.cyl, mat(0x72563d), trunks)
    instances(g, G.sph, mat(0x315a47), crowns)
    g.position.set(x, 0, z); world.add(g)
    addLmLabel(x, z, 4.5, '황거 해자와 성벽', '皇居のお堀・石垣')
  }

  function lmRyokan(x: number, z: number) {
    const g = new THREE.Group()
    g.add(M(G.box, mat(0x654532), 4.6, 2.4, 3.2, 0, 1.3, 0))
    const windows: Part[] = [], posts: Part[] = []
    for (let f = 0; f < 2; f++) for (let i = 0; i < 6; i++) {
      windows.push({ x: (i - 2.5) * 0.66, y: 0.8 + f * 1.1, z: 1.62, sx: 0.5, sy: 0.7, sz: 0.025 })
      posts.push({ x: (i - 2.5) * 0.75, y: 1.3, z: 1.72, sx: 0.07, sy: 2.6, sz: 0.08 })
    }
    instances(g, G.box, mat(0xefcf92, { emissive: 0xb98143 }), windows)
    instances(g, G.box, mat(0x392f29), posts)
    for (const y of [1.35, 2.65]) g.add(M(G.wedge, mat(0x3e4853), 5.1, 0.95, 3.7, 0, y, -1.85))
    g.add(M(G.box, mat(0x968b7e), 0.4, 1, 0.4, 1.3, 3.25, -0.5))
    for (let i = 0; i < 7; i++) {
      const smoke = new THREE.Sprite(mat(0xffffff, { sprite: true, map: softTexture, opacity: 0.22 }) as THREE.SpriteMaterial)
      g.add(smoke)
      animations.push((t) => {
        const age = (t * 0.13 + i / 7) % 1
        smoke.position.set(1.3 + Math.sin(t * 0.24 + i) * age * 0.5, 3.8 + age * 3.5, -0.5 + age * 0.45)
        smoke.scale.setScalar((0.6 + age * 1.2) * Math.sin(Math.PI * age))
      })
    }
    g.position.set(x, 0, z); world.add(g)
    addLmLabel(x, z, 4.3, '후지산 료칸', '富士の宿')
  }

  function lmLake(x: number, z: number) {
    const water = M(G.circle, mat(0x639ca9, { rough: 0.08, metal: 0.7, env: true }), 7, 4.6, 1, x, 0.25, z)
    water.rotation.x = -Math.PI / 2; world.add(water)
    const bank = M(G.circle, mat(0x94ab8f), 7.35, 4.95, 1, x, 0.2, z)
    bank.rotation.x = -Math.PI / 2; world.add(bank)
    const boat = new THREE.Group()
    boat.add(M(G.sph, mat(0xf0e9db), 0.9, 0.2, 0.36, 0, 0, 0))
    boat.add(M(G.box, mat(0xf1e9d8), 0.85, 0.4, 0.48, 0, 0.3, 0))
    boat.add(M(G.box, mat(0x557f99), 0.6, 0.22, 0.5, 0, 0.37, 0))
    boat.add(M(G.box, mat(0xc65a43), 1.05, 0.09, 0.62, 0, 0.56, 0))
    boat.traverse((o) => { o.castShadow = false }); world.add(boat)
    animations.push((t) => {
      const a = t * 0.055
      boat.position.set(x + Math.cos(a) * 4.7, 0.45 + Math.sin(t * 1.5) * 0.025, z + Math.sin(a) * 2.6)
      boat.rotation.y = Math.atan2(-2.6 * Math.cos(a), -4.7 * Math.sin(a))
    })
    addLmLabel(x, z, 1.4, '카와구치호 유람선', '河口湖遊覧船')
  }

  function lmGovernment(x: number, z: number) {
    const g = new THREE.Group(), bands: Part[] = []
    g.add(M(G.box, mat(0x8f9daa), 6.4, 4.5, 3, 0, 2.3, 0))
    for (const side of [-1, 1]) {
      g.add(M(G.box, mat(0xb9c1c9), 2.15, 6.4, 2.8, side * 1.95, 7.5, 0))
      g.add(M(G.cyl, mat(0xb9c1c9), 1.1, 1.15, 1.1, side * 1.95, 11.25, 0))
      for (let f = 0; f < 24; f++) bands.push({ x: side * 1.95, y: 0.6 + f * 0.44, z: 0, sx: 2.2, sy: 0.14, sz: 2.85 })
    }
    instances(g, G.box, mat(0x576e83, { metal: 0.45, rough: 0.3 }), bands)
    g.position.set(x, 0, z); world.add(g)
    addLmLabel(x, z, 12.4, '신주쿠 도쿄도청', '東京都庁')
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
    const struts: Part[] = [], hoops: Part[] = []
    function strut(a: THREE.Vector3, b: THREE.Vector3, width: number) {
      const d = b.clone().sub(a), mid = a.clone().add(b).multiplyScalar(0.5)
      const mesh = M(G.cyl, mat(orange, { emissive: 0xff691e }), width, d.length(), width, mid.x, mid.y, mid.z)
      mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize())
      g.add(mesh)
    }
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      strut(new THREE.Vector3(sx * 1.65, 0, sz * 1.65), new THREE.Vector3(sx * 0.28, 10.5, sz * 0.28), 0.095)
    }
    for (let i = 0; i < 9; i++) {
      const y = 0.7 + i * 1.05, r = 1.65 - y / 10.5 * 1.37
      for (const side of [-1, 1]) {
        hoops.push({ x: 0, y, z: side * r, sx: r * 2, sy: 0.065, sz: 0.065 })
        hoops.push({ x: side * r, y, z: 0, sx: 0.065, sy: 0.065, sz: r * 2 })
        for (const sign of [-1, 1]) {
          struts.push({ x: 0, y: y + 0.43, z: side * (r - 0.055), sx: 0.045, sy: Math.hypot(2 * r - 0.12, 0.86), sz: 0.045, rz: sign * Math.atan2(2 * r - 0.12, 0.86) })
          struts.push({ x: side * (r - 0.055), y: y + 0.43, z: 0, sx: 0.045, sy: Math.hypot(2 * r - 0.12, 0.86), sz: 0.045, ry: Math.PI / 2, rz: sign * Math.atan2(2 * r - 0.12, 0.86) })
        }
      }
    }
    instances(g, G.box, mat(orange, { emissive: 0xff691e }), [...hoops, ...struts])
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
    const cabinLamps: Part[] = []
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
      animations.push((t) => { cab.rotation.z = -t * 0.28 })
      cabinLamps.push({ x: Math.cos(a) * 3.1, y: Math.sin(a) * 3.1, z: 0.2, sx: 0.11, sy: 0.11, sz: 0.08 })
    }
    const leds = instances(wheel, G.sph, mat(0xffffff, { basic: true }), cabinLamps)
    const ledColor = new THREE.Color()
    let previousPhase = -1
    animations.push((t) => {
      const phase = Math.floor(t * 4) % 16
      if (phase === previousPhase) return
      previousPhase = phase
      for (let i = 0; i < 16; i++) leds.setColorAt(i, ledColor.setHex(cabColors[i % cabColors.length]).multiplyScalar((i + phase) % 4 === 0 ? 1.6 : 0.35))
      leds.instanceColor!.needsUpdate = true
    })
    wheel.add(M(G.cyl, mat(0x4a5568), 0.35, 0.35, 0.35, 0, 0, 0))
    wheel.position.y = 3.8
    g.add(wheel)
    g.scale.setScalar(1.75)
    g.position.set(x, 0, z)
    world.add(g)
    wheels.push({ o: wheel, spd: 0.28 })
    addLmLabel(x, z, 12.6, '대관람차', '観覧車')
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
    // 다리 기둥 (수면 아래로 내려가는 교각)
    for (let i = 1; i < 6; i++) {
      const px = x0 + (len * i) / 6
      world.add(M(G.box, mat(0x8a94a0), 0.35, 0.6, 1.4, px, 0.3, z))
    }
    addLmLabel(mid, z, 3.6, '레인보우 브리지', 'RAINBOW BRIDGE')
  }

  function harbor(seaX: number) {
    // 선착장
    for (let i = 0; i < 4; i++) {
      const pz = -HALF + 6 + i * ((HALF * 2 - 12) / 3) + rnd(-2, 2)
      const len = rnd(3.5, 6)
      world.add(M(G.box, mat(0xb9c1ca), len, 0.14, 1.1, seaX + len / 2 + 0.6, 0.3, pz))
      for (let k = 0; k < 3; k++) world.add(M(G.cyl, mat(0x6b7480), 0.09, 0.5, 0.09, seaX + 1.2 + k * (len / 3), 0.2, pz + 0.65))
      if (Math.random() < 0.7) world.add(M(G.box, mat(0xeef1f5), 1.6, 0.6, 0.9, seaX + len * 0.55, 0.65, pz - 0.05))
    }
    // 배
    for (let i = 0; i < 5; i++) {
      const bx = rnd(seaX + 4, HALF - 3), bz = rnd(-HALF + 4, HALF - 4)
      const g = new THREE.Group()
      g.add(M(G.box, mat(0xf2f4f7), 1.1, 0.22, 0.42, 0, 0.16, 0))
      g.add(M(G.box, mat(0xd8dee6), 0.45, 0.22, 0.3, -0.1, 0.36, 0))
      g.position.set(bx, 0.12, bz)
      g.rotation.y = rnd(0, Math.PI * 2)
      world.add(g)
    }
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
    const runwayParts: Part[] = []
    for (let i = 0; i < 20; i++) for (const side of [-1, 1]) runwayParts.push({ x: -4.5 + i * 0.47, y: 0.21, z: side * 1.22, sx: 0.045, sy: 0.045, sz: 0.045 })
    const runway = instances(g, G.sph, mat(0xffffff, { basic: true }), runwayParts)
    const lampColor = new THREE.Color()
    let lastPhase = -1
    animations.push((t) => {
      const phase = Math.floor(t * 9) % 20
      if (phase === lastPhase) return
      lastPhase = phase
      for (let i = 0; i < runwayParts.length; i++) {
        lampColor.setHex(Math.floor(i / 2) === phase ? 0xffefba : 0x536bba)
        runway.setColorAt(i, lampColor)
      }
      runway.instanceColor!.needsUpdate = true
    })
    const beacon = new THREE.Group()
    beacon.add(M(G.sph, mat(0xe8edc9, { basic: true }), 0.1, 0.1, 0.1, 0, 0, 0))
    const beam = M(G.cone, mat(0xffecb4, { basic: true, opacity: 0.09 }), 0.5, 3.2, 0.5, 1.6, 0, 0)
    beam.rotation.z = Math.PI / 2; beacon.add(beam)
    beacon.position.set(-5.2, 3.95, 2.2); g.add(beacon)
    animations.push((t) => { beacon.rotation.y = t * 0.7 })
    addLmLabel(x, z - 1.8, 0.6, '활주로 유도등', '滑走路灯')
    addLmLabel(x - 5.2, z + 2.2, 4.8, '관제탑 회전등', '管制塔ビーコン')
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

  const snapRoad = (v: number) => ROADS.reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a))

  /** 스팟 → 가장 가까운 교차로 → 도로를 따라 직각으로 다음 교차로 → 스팟 (Manhattan routing) */
  function routePolyline(pts: THREE.Vector3[]) {
    const out: THREE.Vector3[] = []
    const push = (x: number, z: number) => {
      const last = out[out.length - 1]
      if (last && Math.abs(last.x - x) < 1e-3 && Math.abs(last.z - z) < 1e-3) return
      out.push(new THREE.Vector3(x, 0, z))
    }
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i]
      const ix = snapRoad(p.x), iz = snapRoad(p.z)
      push(p.x, p.z)
      push(ix, iz)
      if (i < pts.length - 1) {
        const q = pts[i + 1]
        const jx = snapRoad(q.x), jz = snapRoad(q.z)
        if (i % 2 === 0) push(jx, iz)
        else push(ix, jz)
        push(jx, jz)
      }
    }
    return out
  }

  function pathClears(pts: THREE.Vector3[], clears: { x: number; z: number; r: number }[]) {
    // 스팟 ↔ 교차로 사이 진입로에 건물이 서지 않게
    for (const p of pts) {
      const ix = snapRoad(p.x), iz = snapRoad(p.z)
      for (const f of [0.35, 0.7]) clears.push({ x: p.x + (ix - p.x) * f, z: p.z + (iz - p.z) * f, r: 1.05 })
    }
  }

  function addPath(pts: THREE.Vector3[], accent: number) {
    if (pts.length < 2) return
    const line = routePolyline(pts)
    pathMat = new THREE.MeshBasicMaterial({ color: 0xff8c5a, transparent: true, opacity: 0.95, depthTest: false, depthWrite: false })
    haloMat = new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.16, depthWrite: false })
    const grp = new THREE.Group()
    const W = 0.6, Y = 0.24
    for (let i = 0; i < line.length - 1; i++) {
      const a = line[i], b = line[i + 1]
      const len = Math.hypot(b.x - a.x, b.z - a.z)
      if (len < 1e-3) continue
      const ang = Math.atan2(b.x - a.x, b.z - a.z)
      const seg = new THREE.Mesh(G.box, pathMat)
      seg.renderOrder = 5
      seg.scale.set(W, 0.05, len + W * 0.6)
      seg.position.set((a.x + b.x) / 2, Y, (a.z + b.z) / 2)
      seg.rotation.y = ang
      grp.add(seg)
      const halo = new THREE.Mesh(G.box, haloMat)
      halo.scale.set(W * 2.6, 0.03, len + W * 1.4)
      halo.position.set((a.x + b.x) / 2, Y - 0.02, (a.z + b.z) / 2)
      halo.rotation.y = ang
      grp.add(halo)
    }
    for (const v of line) {
      const cap = new THREE.Mesh(G.cyl, pathMat)
      cap.renderOrder = 5
      cap.scale.set(W / 2, 0.05, W / 2)
      cap.position.set(v.x, Y, v.z)
      grp.add(cap)
    }
    world.add(grp)
  }

  function atmosphere(th: Theme) {
    if (!th.green) {
      const moon = new THREE.Sprite(mat(0xffffff, { sprite: true, map: moonTexture }) as THREE.SpriteMaterial)
      moon.scale.set(5, 5, 1); moon.position.set(-24, 27, -27); world.add(moon)
    }
    for (let i = 0; i < 3; i++) {
      const cloud = new THREE.Group()
      for (let k = 0; k < 3; k++) {
        const puff = new THREE.Sprite(mat(0xc2cfdd, { sprite: true, map: softTexture, opacity: 0.065 }) as THREE.SpriteMaterial)
        puff.scale.set(9 + k, 2.2 + k * 0.3, 1); puff.position.x = (k - 1) * 3.5; cloud.add(puff)
      }
      world.add(cloud)
      animations.push((t) => { cloud.position.set(((t * 0.12 + i * 24) % 90) - 45, 17 + i * 2.5, -18 + i * 17) })
    }
    if (th.green) {
      const positions = new Float32Array(50 * 3)
      for (let i = 0; i < 50; i++) { positions[i * 3] = rnd(-HALF, HALF); positions[i * 3 + 1] = rnd(1, 15); positions[i * 3 + 2] = rnd(-HALF, HALF) }
      const geo = new THREE.BufferGeometry()
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
      const snow = new THREE.Points(geo, mat(0xf3f5ff, { points: true, map: softTexture, opacity: 0.7 }) as THREE.PointsMaterial)
      world.add(snow)
      animations.push((t, dt) => {
        for (let i = 0; i < 50; i++) {
          positions[i * 3] += Math.sin(t * 0.5 + i) * dt * 0.18
          positions[i * 3 + 1] -= dt * (0.25 + i % 5 * 0.06)
          if (positions[i * 3 + 1] < 0.25) positions[i * 3 + 1] = 15
        }
        geo.attributes.position.needsUpdate = true
      })
    }
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
    const rg = new THREE.Group()
    const ring = M(G.torus, mat(accent, { basic: true }), 0.7, 0.7, 0.7, 0, 0.1, 0)
    ring.rotation.x = Math.PI / 2
    rg.add(ring)
    const disc = M(G.circle, mat(accent, { basic: true, opacity: 0.22 }), 0.7, 1, 0.7, 0, 0.06, 0)
    disc.rotation.x = -Math.PI / 2
    rg.add(disc)
    rg.add(M(G.cyl, mat(accent, { basic: true }), 0.07, 0.8, 0.07, 0, 0.5, 0))
    rg.position.copy(pos)
    world.add(rg)
    rings.push(rg)

    const el = document.createElement('div')
    el.className = 'astra-pin' + (stop.eat ? ' eat' : '')
    el.innerHTML = `<span class="no">${i + 1}</span><span class="nm">${stop.name}</span>`
    dayOffs.push(on(el, 'click', (() => { setAutoRotate(false); onPick(i) }) as EventListener))
    const obj = new CSS2DObject(el)
    const dup = spots.slice(0, i).filter((p) => p.distanceTo(pos) < 0.5).length
    obj.position.set(pos.x, 1.1 + dup * 0.9, pos.z)
    world.add(obj)
    pins.push({ el, obj })
  }

  function buildDay(di: number) {
    setAutoRotate(false)
    clear()
    const day = DAYS[di]
    const th = THEMES[day.theme as string] ?? THEMES.night
    host.style.background = `radial-gradient(ellipse 70% 60% at 60% 46%, ${th.sky[1]} 0%, ${th.sky[0]} 75%)`
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

    // Keep room in front of the main monument for the arcade/lake.
    if (day.landmark === 'pagoda') lmv.z = Math.min(lmv.z, HALF - 14)
    if (day.landmark === 'fuji') lmv.z = Math.min(lmv.z, HALF - 21)
    const seaX = th.sea ? HALF * 0.22 : null
    if (seaX !== null) {
      // 바다 위에 놓인 스팟·랜드마크는 해안선 안쪽으로
      const shore = seaX - 3.2
      // 바다 쪽(+x)에 있는 점들을 해안선 안쪽으로 비율 압축 (상대 배치는 유지)
      const maxX = Math.max(lmv.x, ...spots.map((s) => s.x))
      if (maxX > shore) {
        const k = shore / maxX
        spots.forEach((s) => { if (s.x > 0) s.x *= k })
        if (lmv.x > 0) lmv.x *= k
      }
      // 반대편(-x)으로는 판을 더 넓게 써서 동선이 길게 굽이치도록
      const minX = Math.min(lmv.x, ...spots.map((s) => s.x))
      const targetMin = -HALF + 6
      if (minX > targetMin + 6 && minX < 0) {
        const k2 = targetMin / minX
        spots.forEach((s) => { if (s.x < 0) s.x *= k2 })
        if (lmv.x < 0) lmv.x *= k2
      }
    }

    const clears = spots.map((p) => ({ x: p.x, z: p.z, r: 2.0 }))
    pathClears(spots, clears)
    plate(th, seaX)
    if (seaX !== null) {
      const seaW = HALF - seaX + 0.8
      world.add(M(G.box, mat(0x3f7e8f, { rough: 0.35 }), seaW, 0.12, HALF * 2 + 0.8, HALF - seaW / 2 + 0.4, 0.075, 0))
      // 얕은 물결 띠
      for (let i = 0; i < 14; i++) {
        const wx = rnd(seaX + 2, HALF - 2), wz = rnd(-HALF + 2, HALF - 2)
        world.add(M(G.box, mat(0x5a97a6, { basic: true, opacity: 0.55 }), rnd(1.2, 3.0), 0.01, 0.12, wx, 0.14, wz))
      }
      // 해안 방파제
      world.add(M(G.box, mat(0x9aa4ae), 0.7, 0.24, HALF * 2, seaX + 0.05, 0.17, 0))
      lmBridge(seaX - 5, HALF - 1.5, -7)
      harbor(seaX)
    }

    const lmR = { plane: 5.5, pagoda: 3.4, wheel: 6.8, tower: 3.2, fuji: 7.0 }[day.landmark as string] ?? 3
    clears.push({ x: lmv.x, z: lmv.z, r: lmR })
    switch (day.landmark) {
      case 'plane': lmAirport(lmv.x, lmv.z); break
      case 'pagoda':
        lmPagoda(lmv.x, lmv.z)
        lmGate(lmv.x, lmv.z + 9.5)
        clears.push({ x: lmv.x, z: lmv.z + 9.5, r: 2.8 })
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

    const extraBuilders: Record<ExtraLandmark, (x: number, z: number) => void> = {
      skytree: lmSkytree, fujiTV: lmFujiTV, mori: lmMori,
      nakamise: lmNakamise, liberty: lmLiberty, moat: lmMoat, ryokan: lmRyokan, lake: lmLake, government: lmGovernment,
    }
    // Reserve the arcade before searching other parcels; its axis must connect the two gates.
    if (di === 1) clears.push({ x: lmv.x, z: lmv.z + 4.7, r: 3.5 })
    for (const extra of EXTRA_LM[di] ?? []) {
      if (extra.fn === 'nakamise') { lmNakamise(lmv.x, lmv.z + 4.7); continue }
      // Search outward from the authored offset to avoid other landmarks and routes.
      const preferredX = lmv.x + extra.dx, preferredZ = lmv.z + extra.dz
      const limitX = (seaX ?? HALF) - extra.r - 1
      let chosen: { x: number; z: number } | undefined
      let best = Infinity
      for (let x = -HALF + extra.r + 1; x <= limitX; x += 1) {
        for (let z = -HALF + extra.r + 1; z <= HALF - extra.r - 1; z += 1) {
          if (clears.some((c) => Math.hypot(x - c.x, z - c.z) < c.r + extra.r)) continue
          const score = (x - preferredX) ** 2 + (z - preferredZ) ** 2
          if (score < best) { best = score; chosen = { x, z } }
        }
      }
      if (!chosen) {
        // Dense routes can exhaust free parcels; landmarks still take priority over buildings.
        chosen = {
          x: Math.max(-HALF + extra.r + 1, Math.min(limitX, preferredX)),
          z: Math.max(-HALF + extra.r + 1, Math.min(HALF - extra.r - 1, preferredZ)),
        }
      }
      clears.push({ ...chosen, r: extra.r })
      extraBuilders[extra.fn](chosen.x, chosen.z)
    }

    city(th, clears, seaX)
    day.stops.forEach((s: { name: string }, i: number) => {
      if (/공원/.test(s.name)) for (let k = 0; k < 8; k++) tree(spots[i].x + rnd(-1.8, 1.8), spots[i].z + rnd(-1.8, 1.8), true)
    })
    addPath(spots, th.accent)
    addLife()
    atmosphere(th)
    animations.forEach((animate) => animate(0, 0))
    // Moving figures and the wheel are excluded from the cached shadow map,
    // so they cannot leave frozen shadows as their animation advances.
    const noShadow = (root: THREE.Object3D) => root.traverse((o) => { o.castShadow = false })
    people.forEach(({ g }) => noShadow(g))
    cars.forEach(({ g }) => noShadow(g))
    wheels.forEach(({ o }) => noShadow(o))
    renderer.shadowMap.needsUpdate = true
    day.stops.forEach((s: { name: string; eat?: number }, i: number) => addSpot(i, spots[i], s, th.accent))
    focusT.set(0, 0.45, 0)
    focus.copy(focusT)
    flying = false
    zoomT = fitZoom()
    select(0)
  }

  function select(i: number) {
    sel = i
    // 판 전체가 보이는 상태에서는 시점을 유지, 확대해 들어간 상태에서만 스팟으로 이동
    if (spots[i] && zoomT > fitZoom() * 1.3) {
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
    const elapsed = clock.getElapsedTime()
    const dt = Math.min(elapsed - last, 0.05)
    last = elapsed
    if (!paused) animationTime += dt
    const t = animationTime
    animations.forEach((animate) => animate(t, paused ? 0 : dt))

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
        setAutoRotate(false)
        clampFocus()
        focus.copy(focusT)
        flying = false
      }
    }

    if (autoRotate) az = (az + dt * Math.PI * 2 / 40) % (Math.PI * 2)
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
    if (pathMat) pathMat.opacity = 0.82 + Math.sin(t * 2.2) * 0.14
    if (haloMat) haloMat.opacity = 0.14 + Math.sin(t * 2.2) * 0.05
    renderer.render(scene, cam)
    labelR.render(scene, cam)
    raf = requestAnimationFrame(tick)
  }

  let mode: 'none' | 'pan' | 'orbit' = 'none'
  const pointers = new Map<number, { x: number; y: number }>()
  const { on, dispose: disposeEvents } = eventScope()
  on(host, 'contextmenu', ((e: Event) => e.preventDefault()) as EventListener)
  on(host, 'pointerdown', ((e: PointerEvent) => {
    if (e.button !== 0 && e.button !== 1 && e.button !== 2) return
    setAutoRotate(false)
    if (pointers.size >= 2) return
    mode = e.button === 2 || e.button === 1 || e.altKey ? 'orbit' : 'pan'
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
    host.setPointerCapture?.(e.pointerId)
    flying = false
  }) as EventListener)
  on(host, 'pointermove', ((e: PointerEvent) => {
    const previous = pointers.get(e.pointerId)
    if (!previous) return
    const before = [...pointers.values()]
    const dx = e.clientX - previous.x, dy = e.clientY - previous.y
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pointers.size === 2) {
      const after = [...pointers.values()]
      const oldDistance = Math.hypot(before[0].x - before[1].x, before[0].y - before[1].y)
      const newDistance = Math.hypot(after[0].x - after[1].x, after[0].y - after[1].y)
      const centroidDx = (after[0].x + after[1].x - before[0].x - before[1].x) / 2
      az -= centroidDx * 0.005
      if (oldDistance > 8 && newDistance > 8) zoomT = Math.max(2, Math.min(48, zoomT * newDistance / oldDistance))
    } else if (mode === 'pan') panScreen(dx, dy)
    else if (mode === 'orbit') {
      az -= dx * 0.005
      elev = Math.max(0.18, Math.min(1.05, elev + dy * 0.003))
    }
  }) as EventListener)
  const releasePointer = ((e: PointerEvent) => {
    pointers.delete(e.pointerId)
    if (host.hasPointerCapture?.(e.pointerId)) host.releasePointerCapture(e.pointerId)
    // Remaining pointer already has its current coordinates: no one/two-finger jump.
    mode = pointers.size ? 'pan' : 'none'
  }) as EventListener
  on(host, 'pointerup', releasePointer)
  on(host, 'pointercancel', releasePointer)
  on(host, 'lostpointercapture', releasePointer)
  on(host, 'wheel', ((e: WheelEvent) => {
    setAutoRotate(false)
    e.preventDefault()
    zoomT = Math.max(2, Math.min(48, zoomT * (1 - e.deltaY * 0.0011)))
  }) as EventListener, { passive: false })
  on(window, 'keydown', ((e: KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return
    const tag = (e.target as HTMLElement)?.tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (e.target as HTMLElement)?.isContentEditable) return
    if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE'].includes(e.code)) {
      keys.add(e.code)
      e.preventDefault()
    }
  }) as EventListener)
  on(window, 'keyup', ((e: KeyboardEvent) => { keys.delete(e.code) }) as EventListener)
  on(window, 'blur', (() => { keys.clear(); pointers.clear(); mode = 'none'; setAutoRotate(false) }) as EventListener)
  on(window, 'resize', (() => {
    const w = host.clientWidth, h = host.clientHeight
    renderer.setSize(w, h); labelR.setSize(w, h)
    cam.left = -w / 2; cam.right = w / 2; cam.top = h / 2; cam.bottom = -h / 2
    cam.updateProjectionMatrix()
    zoomT = fitZoom()
  }) as EventListener)

  updateCam()
  tick()

  return {
    buildDay,
    select,
    setAutoRotate,
    front: () => { setAutoRotate(false); az = AZ0; elev = EL0 },
    zoomBy: (f) => { setAutoRotate(false); zoomT = Math.max(2, Math.min(48, zoomT * f)) },
    reset: () => {
      setAutoRotate(false)
      az = AZ0; elev = EL0
      focusT.set(0, 0.45, 0); flying = true
      zoomT = fitZoom()
    },
    setPaused: (p) => { paused = p },
    setSideOffset: (px) => { sideOffsetPx = px },
    dispose: () => {
      dead = true
      cancelAnimationFrame(raf)
      disposeEvents()
      clear()
      cache.forEach((m) => m.dispose())
      Object.values(G).forEach((g) => g.dispose())
      textures.forEach((texture) => texture.dispose())
      key.shadow.dispose()
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

/** '월 10/19' → '10/19 월' */
function fmtDate(d: string) {
  const parts = (d || '').trim().split(/\s+/)
  if (parts.length < 2) return d || ''
  return `${parts[1]} ${parts[0]}`
}

export default function AstraDioramaPage() {
  const hostRef = useRef<HTMLDivElement>(null)
  const labelRef = useRef<HTMLDivElement>(null)
  const eng = useRef<Engine | null>(null)
  const compassRef = useRef<HTMLSpanElement>(null)
  const [rotating, setRotating] = useState(false)
  const [dayIdx, setDayIdx] = useState(2)
  const [selIdx, setSelIdx] = useState(0)
  const [paused, setPaused] = useState(false)
  const [touring, setTouring] = useState(false)
  const [open, setOpen] = useState(true)

  useEffect(() => {
    if (!hostRef.current || !labelRef.current || !compassRef.current) return
    const e = createEngine(hostRef.current, labelRef.current, setSelIdx, compassRef.current, setRotating)
    eng.current = e
    return () => { e.dispose(); eng.current = null }
  }, [])

  // 사이드바가 열려 있으면 판을 화면 오른쪽으로 밀어서 가리지 않게
  useEffect(() => {
    const apply = () => {
      const wide = window.innerWidth > 900
      eng.current?.setSideOffset(open && wide ? SIDE_W / 2 + 10 : 0)
    }
    apply()
    const { on, dispose } = eventScope()
    on(window, 'resize', apply)
    return dispose
  }, [open])

  useEffect(() => { eng.current?.buildDay(dayIdx) }, [dayIdx])
  useEffect(() => { eng.current?.select(selIdx) }, [selIdx])
  useEffect(() => { eng.current?.setPaused(paused) }, [paused])

  const selectDay = useCallback((i: number) => { eng.current?.setAutoRotate(false); setTouring(false); setDayIdx(i); setSelIdx(0) }, [])

  // EXPLORE: 스팟을 차례로 훑는 자동 투어
  useEffect(() => {
    if (!touring) return
    const id = window.setInterval(() => {
      setSelIdx((s) => {
        const n = DAYS[dayIdx].stops.length
        if (s + 1 >= n) { setTouring(false); return s }
        return s + 1
      })
    }, 2400)
    return () => window.clearInterval(id)
  }, [touring, dayIdx])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (target?.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target?.tagName)) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key.startsWith('Arrow')) { eng.current?.setAutoRotate(false); e.preventDefault() }
      if (e.key === 'ArrowRight') selectDay(Math.min(dayIdx + 1, DAYS.length - 1))
      if (e.key === 'ArrowLeft') selectDay(Math.max(dayIdx - 1, 0))
      if (e.key === 'ArrowDown') setSelIdx((s) => Math.min(s + 1, DAYS[dayIdx].stops.length - 1))
      if (e.key === 'ArrowUp') setSelIdx((s) => Math.max(s - 1, 0))
    }
    const { on, dispose } = eventScope()
    on(window, 'keydown', onKey as EventListener)
    return dispose
  }, [dayIdx, selectDay])

  const day = DAYS[dayIdx]
  const stop = (day.stops[selIdx] ?? day.stops[0]) as StopView
  const tag = stop.eat ? 'EAT' : stop.stay ? 'STAY' : 'STOP'
  const dateLabel = typeof day.d === 'string' ? fmtDate(day.d) : ''

  return (
    <div className="astra-root">
      <div className="astra-scene" ref={hostRef} />
      <div className="astra-labels" ref={labelRef} />
      <div className="astra-vignette" aria-hidden />

      <header className="astra-top">
        <div className="astra-brand">
          <p className="line">
            <span className="en">Tokyo Walk</span>
            <span className="bar" aria-hidden />
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
            className={'explore' + (touring ? ' on' : '')}
            onClick={() => { eng.current?.setAutoRotate(false); setTouring((v) => !v) }}
          >
            <span className="dot" /> {touring ? 'TOURING' : 'EXPLORE'}
          </button>
          <a className="pill alt" href="/pokemon.html">픽셀 ↗</a>
          <Link className="pill" to="/map">실제 지도 ↗</Link>
        </div>
      </header>

      <aside className={'astra-side' + (open ? ' open' : '')}>
        <button type="button" className="astra-side-toggle" onClick={() => { eng.current?.setAutoRotate(false); setOpen((v) => !v) }}>
          {open ? '접기' : '일정 보기'}
        </button>
        <div className="astra-side-body">
          <div className="astra-day-head">
            <p className="day-kicker">DAY {day.no}</p>
            <h2>{day.t}</h2>
            <p className="region">{day.region} · {dateLabel}</p>
          </div>
          <ol className="astra-stops">
            {day.stops.map((s: { name: string; time: string; eat?: number }, i: number) => (
              <li key={i}>
                <button
                  type="button"
                  className={'astra-stop' + (i === selIdx ? ' on' : '') + (s.eat ? ' eat' : '')}
                  onClick={() => { eng.current?.setAutoRotate(false); setSelIdx(i) }}
                >
                  <span className="ix">{i + 1}</span>
                  <span className="meta">
                    <span className="nm">{s.name}</span>
                    <span className="tm">{s.time}</span>
                  </span>
                </button>
              </li>
            ))}
          </ol>
          <article className="astra-card">
            <p className="place">PLACE {String(selIdx + 1).padStart(2, '0')} · {tag}</p>
            <h3>{stop.name}</h3>
            {stop.jp && <p className="jp">{stop.jp}</p>}
            <p className="body">{stop.why || stop.note}</p>
          </article>
        </div>
      </aside>

      <nav className="astra-chapters" aria-label="일차 선택">
        {DAYS.map((d: { no: string; d: string }, i: number) => (
          <button
            key={d.no}
            type="button"
            className={'astra-ch' + (i === dayIdx ? ' on' : '')}
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
          <button type="button" className="astra-compass" aria-label="정면으로 복귀" title="정면으로 복귀" onClick={() => eng.current?.front()}>
            <span ref={compassRef} className="astra-compass-dial" aria-hidden="true"><b>N</b>▲</span>
          </button>
          <button type="button" aria-pressed={rotating} onClick={() => { setTouring(false); eng.current?.setAutoRotate(!rotating) }}>
            {rotating ? '360° 회전 중' : '360° 둘러보기'}
          </button>
        </div>
        <div className="row">
          <button type="button" onClick={() => eng.current?.zoomBy(1.2)} aria-label="확대">＋</button>
          <button type="button" onClick={() => eng.current?.zoomBy(0.84)} aria-label="축소">−</button>
          <button type="button" onClick={() => eng.current?.reset()}>전체 보기</button>
          <button type="button" onClick={() => { eng.current?.setAutoRotate(false); setPaused((p) => !p) }}>
            {paused ? '움직임 재생' : '움직임 멈춤'}
          </button>
        </div>
        <p className="astra-help">드래그 이동 · 우클릭/Alt 회전 · 두 손가락 회전·핀치 확대 · WASD · ← → 날짜</p>
      </div>

      <p className="astra-foot">여행을 담은 미니어처 · 축척과 위치는 실제와 다릅니다</p>
    </div>
  )
}
