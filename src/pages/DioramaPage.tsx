/**
 * 여행 디오라마 — 3D 아이소메트릭 미니어처
 *
 * 외부 3D 모델 없이 코드 도형으로만 도시를 만든다.
 * 카메라는 낮은 부감(elevation ≈ π·0.155)의 OrthographicCamera.
 * UI는 왼쪽 절반, 디오라마 판은 오른쪽에 대각선으로 걸친다.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import * as THREE from 'three'
import { CSS2DObject, CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js'
import { DAYS, projectDay } from '../diorama/data.js'
import './DioramaPage.css'

/* ============ 상수 ============ */
const PLATE_R = 23            // 판 반경 (한 변 46)
const SPOT_R = 15             // 스팟이 퍼지는 최대 반경
const ROADS = [-18, -13, -8, -3, 2, 7, 12, 17]
const CAM_AZ0 = Math.PI * 0.62
const CAM_EL = Math.PI * 0.155
const CAM_DIST = 110
const ZOOM0 = 22

/* 날짜별 분위기 팔레트 */
const THEMES: Record<string, {
  plate: number; road: number; walls: number[]; roofWarm: number[]; roofCool: number[]
  warmP: number; gableP: number; tall: number; empty: number; treeP: number; sea?: boolean; green?: boolean
}> = {
  night: {
    plate: 0xfaf8f4, road: 0xe9e4da,
    walls: [0xf6efe3, 0xf3e8dd, 0xf7e9e4, 0xefe9dc, 0xf4e4d7],
    roofWarm: [0xd9714f, 0xe08a5c, 0xcf6a45, 0xe2926b], roofCool: [0x8b9bb0, 0x7f8ea3],
    warmP: 0.7, gableP: 0.7, tall: 1.0, empty: 0.07, treeP: 0.18,
  },
  asakusa: {
    plate: 0xfaf7f0, road: 0xeae4d6,
    walls: [0xf7efe0, 0xf3e6d2, 0xf6e8e0, 0xefe6d4, 0xf6ecd9],
    roofWarm: [0xd9714f, 0xcf6a45, 0xc75f3e, 0xe08a5c], roofCool: [0x8b9bb0],
    warmP: 0.82, gableP: 0.85, tall: 0.85, empty: 0.07, treeP: 0.2,
  },
  odaiba: {
    plate: 0xf6f8f8, road: 0xe2e7ea,
    walls: [0xf2f6f8, 0xe9f0f4, 0xf5f2ec, 0xedf2ef, 0xf7f4ee],
    roofWarm: [0xe08a5c, 0xd9714f], roofCool: [0x8b9bb0, 0x7f8ea3, 0x94a8bb],
    warmP: 0.5, gableP: 0.45, tall: 1.15, empty: 0.08, treeP: 0.14, sea: true,
  },
  roppongi: {
    plate: 0xf7f6f3, road: 0xe6e3dd,
    walls: [0xf1efe9, 0xecebe6, 0xf4f1ea, 0xe8e9e6, 0xf0ece2],
    roofWarm: [0xd9714f, 0xe08a5c], roofCool: [0x8b9bb0, 0x7f8ea3, 0x6f7f95],
    warmP: 0.55, gableP: 0.35, tall: 1.6, empty: 0.06, treeP: 0.12,
  },
  fuji: {
    plate: 0xe7eedd, road: 0xd8ddcb,
    walls: [0xf7efe0, 0xf3e6d2, 0xf1ece0, 0xefe6d4],
    roofWarm: [0xd9714f, 0xcf6a45, 0xb8563a, 0xe08a5c], roofCool: [0x7f8ea3],
    warmP: 0.8, gableP: 0.92, tall: 0.6, empty: 0.3, treeP: 0.55, green: true,
  },
}

/* ============ 엔진 ============ */
type Engine = {
  buildDay: (i: number) => void
  setSelected: (i: number) => void
  setPaused: (p: boolean) => void
  zoomBy: (f: number) => void
  resetView: () => void
  dispose: () => void
}

function createEngine(
  host: HTMLDivElement,
  labelHost: HTMLDivElement,
  onSelect: (i: number) => void,
): Engine {
  const scene = new THREE.Scene()
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' })
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
  renderer.setSize(host.clientWidth, host.clientHeight)
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  renderer.outputColorSpace = THREE.SRGBColorSpace
  host.appendChild(renderer.domElement)

  const labelRenderer = new CSS2DRenderer({ element: labelHost })
  labelRenderer.setSize(host.clientWidth, host.clientHeight)

  const camera = new THREE.OrthographicCamera(
    -host.clientWidth / 2, host.clientWidth / 2,
    host.clientHeight / 2, -host.clientHeight / 2, -1000, 2000,
  )
  camera.zoom = ZOOM0

  /* 조명 — PointLight 금지. 이 셋이 전부다. */
  scene.add(new THREE.AmbientLight(0xffffff, 0.86))
  const sun = new THREE.DirectionalLight(0xfff4e2, 0.85)
  sun.position.set(-30, 46, 18)
  sun.castShadow = true
  sun.shadow.mapSize.set(2048, 2048)
  sun.shadow.camera.left = -32; sun.shadow.camera.right = 32
  sun.shadow.camera.top = 32; sun.shadow.camera.bottom = -32
  sun.shadow.camera.far = 200
  sun.shadow.bias = -0.0006
  scene.add(sun)
  scene.add(new THREE.HemisphereLight(0xdfeaf4, 0xd8cfc0, 0.42))

  const world = new THREE.Group()
  scene.add(world)

  /* 공유 지오메트리 — 재사용, dispose 금지 */
  const G = {
    box: new THREE.BoxGeometry(1, 1, 1),
    cone4: new THREE.ConeGeometry(0.72, 1, 4),  // 45° 돌려 박공지붕
    cone: new THREE.ConeGeometry(1, 1, 14),
    cyl: new THREE.CylinderGeometry(1, 1, 1, 10),
    sph: new THREE.SphereGeometry(1, 10, 8),
    torus: new THREE.TorusGeometry(1, 0.07, 8, 36),
    plane: new THREE.PlaneGeometry(1, 1),
    circle: new THREE.CircleGeometry(1, 28),
  }
  Object.values(G).forEach((g) => { g.userData.shared = true })

  /* 머티리얼 캐시 — 색상별 재사용 */
  const matCache = new Map<string, THREE.Material>()
  const mat = (c: number, opts: { basic?: boolean; opacity?: number } = {}) => {
    const key = `${c}:${opts.basic ? 'b' : 's'}:${opts.opacity ?? 1}`
    let m = matCache.get(key)
    if (!m) {
      m = opts.basic
        ? new THREE.MeshBasicMaterial({ color: c, transparent: (opts.opacity ?? 1) < 1, opacity: opts.opacity ?? 1 })
        : new THREE.MeshStandardMaterial({ color: c, roughness: 0.92, metalness: 0 })
      matCache.set(key, m)
    }
    return m
  }
  const rnd = (a: number, b: number) => a + Math.random() * (b - a)
  const pick = <T,>(arr: T[]) => arr[(Math.random() * arr.length) | 0]

  function mesh(geo: THREE.BufferGeometry, m: THREE.Material, sx: number, sy: number, sz: number, x: number, y: number, z: number, shadow = true) {
    const o = new THREE.Mesh(geo, m)
    o.scale.set(sx, sy, sz)
    o.position.set(x, y, z)
    o.castShadow = shadow
    o.receiveShadow = true
    return o
  }

  /* ---- 카메라 상태 ---- */
  let az = CAM_AZ0
  let zoom = ZOOM0
  let zoomT = ZOOM0
  const focus = new THREE.Vector3()
  const focusT = new THREE.Vector3()
  const _dir = new THREE.Vector3()
  const _right = new THREE.Vector3()
  const _look = new THREE.Vector3()
  const UP = new THREE.Vector3(0, 1, 0)

  function updateCamera() {
    _dir.set(Math.cos(CAM_EL) * Math.cos(az), Math.sin(CAM_EL), Math.cos(CAM_EL) * Math.sin(az))
    _right.crossVectors(_dir, UP).normalize()
    // UI가 왼쪽 절반을 쓰므로 판은 오른쪽으로 — 시선점을 왼쪽으로 민다
    const shiftPx = host.clientWidth > 900 ? host.clientWidth * 0.17 : 0
    _look.copy(focus).addScaledVector(_right, shiftPx / zoom)
    camera.position.copy(_look).addScaledVector(_dir, CAM_DIST)
    camera.lookAt(_look)
    camera.zoom = zoom
    camera.updateProjectionMatrix()
  }

  /* ---- 애니메이션 대상 (매 빌드 리셋) ---- */
  type Walker = { g: THREE.Group; axis: 'x' | 'z'; c: number; t: number; spd: number; off: number }
  type Car = { g: THREE.Group; axis: 'x' | 'z'; c: number; t: number; spd: number; dir: number }
  let walkers: Walker[] = []
  let cars: Car[] = []
  let spinners: { o: THREE.Object3D; spd: number }[] = []
  let rings: { g: THREE.Group }[] = []
  let labels: { obj: CSS2DObject; el: HTMLDivElement }[] = []
  let spotPos: THREE.Vector3[] = []
  let selIdx = 0
  let paused = false

  /* ---- 판 + 도로 ---- */
  function buildPlate(theme: (typeof THEMES)['night']) {
    const a = PLATE_R, r = 6
    const s = new THREE.Shape()
    s.moveTo(-a + r, -a)
    s.lineTo(a - r, -a); s.quadraticCurveTo(a, -a, a, -a + r)
    s.lineTo(a, a - r); s.quadraticCurveTo(a, a, a - r, a)
    s.lineTo(-a + r, a); s.quadraticCurveTo(-a, a, -a, a - r)
    s.lineTo(-a, -a + r); s.quadraticCurveTo(-a, -a, -a + r, -a)
    const geo = new THREE.ExtrudeGeometry(s, { depth: 1.6, bevelEnabled: false })
    geo.rotateX(-Math.PI / 2)
    geo.translate(0, 0, 0)  // 회전 후 y: 0(윗면) ~ -1.6? → 실제로는 0~1.6이 -y로 감
    const plate = new THREE.Mesh(geo, mat(theme.plate))
    plate.position.y = 0
    plate.receiveShadow = true
    // ExtrudeGeometry rotateX(-90) 결과 윗면이 y=1.6 → 내려서 윗면을 y=0에
    const bb = new THREE.Box3().setFromObject(plate)
    plate.position.y = -bb.max.y
    world.add(plate)

    // 도로 격자
    for (const c of ROADS) {
      world.add(mesh(G.box, mat(theme.road), 42, 0.05, 1.5, 0, 0.025, c, false))
      world.add(mesh(G.box, mat(theme.road), 1.5, 0.05, 42, c, 0.025, 0, false))
    }
  }

  /* ---- 건물 타입별 생성 ---- */
  type WinBuf = THREE.Matrix4[]
  const _m = new THREE.Matrix4()
  const _q = new THREE.Quaternion()
  const _p = new THREE.Vector3()
  const _s = new THREE.Vector3(1, 1, 1)

  function pushWindows(buf: WinBuf, x: number, z: number, w: number, d: number, h: number, floors: number, cols: number) {
    for (const side of [1, -1] as const) {
      for (let ci = 0; ci < cols; ci++) {
        for (let fi = 0; fi < floors; fi++) {
          const fy = floors <= 1 ? h * 0.55 : 0.45 + fi * (h - 0.7) / (floors - 1)
          _p.set(x - w / 2 + (w / (cols + 1)) * (ci + 1), fy, z + side * (d / 2 + 0.014))
          _q.setFromEuler(new THREE.Euler(0, side === 1 ? 0 : Math.PI, 0))
          _s.set(0.22, 0.32, 1)
          buf.push(_m.compose(_p, _q, _s).clone())
        }
      }
      // ±x 면
      for (let ci = 0; ci < Math.max(1, cols - 1); ci++) {
        for (let fi = 0; fi < floors; fi++) {
          const fy = floors <= 1 ? h * 0.55 : 0.45 + fi * (h - 0.7) / (floors - 1)
          _p.set(x + side * (w / 2 + 0.014), fy, z - d / 2 + (d / cols) * (ci + 0.5))
          _q.setFromEuler(new THREE.Euler(0, side === 1 ? -Math.PI / 2 : Math.PI / 2, 0))
          _s.set(0.2, 0.3, 1)
          buf.push(_m.compose(_p, _q, _s).clone())
        }
      }
    }
  }

  function addGableRoof(x: number, z: number, w: number, d: number, h: number, roofC: number, rot = Math.PI / 4) {
    const rh = rnd(0.55, 0.95)
    const roof = mesh(G.cone4, mat(roofC), Math.max(w, d) * 1.08, rh, Math.max(w, d) * 1.08, x, h + rh / 2, z)
    roof.rotation.y = rot
    world.add(roof)
    // 처마 띠
    world.add(mesh(G.box, mat(roofC), w * 1.12, 0.08, d * 1.12, x, h + 0.04, z))
  }

  function addFlatRoof(x: number, z: number, w: number, d: number, h: number, roofC: number, parapet = true) {
    world.add(mesh(G.box, mat(roofC), w * 0.98, 0.1, d * 0.98, x, h + 0.05, z))
    if (parapet) {
      world.add(mesh(G.box, mat(0xddd6c8), w * 0.98, 0.14, 0.06, x, h + 0.16, z + d * 0.46))
      world.add(mesh(G.box, mat(0xddd6c8), w * 0.98, 0.14, 0.06, x, h + 0.16, z - d * 0.46))
      world.add(mesh(G.box, mat(0xddd6c8), 0.06, 0.14, d * 0.98, x + w * 0.46, h + 0.16, z))
      world.add(mesh(G.box, mat(0xddd6c8), 0.06, 0.14, d * 0.98, x - w * 0.46, h + 0.16, z))
    }
  }

  /** 박공 주택 — 낮은 기와집 */
  function bldgHouse(x: number, z: number, theme: (typeof THEMES)['night'], buf: WinBuf) {
    const w = rnd(0.9, 1.25), d = rnd(0.85, 1.15), h = rnd(1.0, 1.7)
    const wall = pick(theme.walls)
    const roofC = Math.random() < theme.warmP ? pick(theme.roofWarm) : pick(theme.roofCool)
    world.add(mesh(G.box, mat(wall), w, h, d, x, h / 2, z))
    // 현관
    world.add(mesh(G.box, mat(0x6a5644), 0.28, 0.48, 0.06, x, 0.24, z + d / 2 + 0.03))
    addGableRoof(x, z, w, d, h, roofC, Math.random() < 0.5 ? Math.PI / 4 : 0)
    pushWindows(buf, x, z, w, d, h, Math.max(1, Math.floor(h / 0.8)), 2)
  }

  /** 상점 — 1층 큰 유리 + 간판 */
  function bldgShop(x: number, z: number, theme: (typeof THEMES)['night'], buf: WinBuf) {
    const w = rnd(1.1, 1.5), d = rnd(0.9, 1.2), h = rnd(1.3, 2.0)
    const wall = pick(theme.walls)
    const signC = pick([0xd9714f, 0x4a76a8, 0xd7b25a, 0xb84a3a, 0x6f9a5f])
    world.add(mesh(G.box, mat(wall), w, h, d, x, h / 2, z))
    // 1층 쇼윈도
    world.add(mesh(G.plane, mat(0xb8d0e4, { basic: true, opacity: 0.85 }), w * 0.7, 0.55, 1, x, 0.55, z + d / 2 + 0.02, false))
    // 간판
    world.add(mesh(G.box, mat(signC), w * 0.85, 0.22, 0.1, x, 1.05, z + d / 2 + 0.06))
    const roofC = Math.random() < 0.6 ? pick(theme.roofWarm) : pick(theme.roofCool)
    if (Math.random() < 0.55) addGableRoof(x, z, w, d, h, roofC)
    else addFlatRoof(x, z, w, d, h, roofC, false)
    pushWindows(buf, x, z, w, d, h, Math.max(1, Math.floor((h - 0.8) / 0.7)), 2)
  }

  /** L자형 건물 */
  function bldgL(x: number, z: number, theme: (typeof THEMES)['night'], buf: WinBuf) {
    const h = rnd(1.4, 2.4)
    const wall = pick(theme.walls)
    const roofC = Math.random() < theme.warmP ? pick(theme.roofWarm) : pick(theme.roofCool)
    const w1 = rnd(1.1, 1.4), d1 = rnd(0.55, 0.7)
    const w2 = rnd(0.5, 0.7), d2 = rnd(1.0, 1.3)
    world.add(mesh(G.box, mat(wall), w1, h, d1, x, h / 2, z - 0.2))
    world.add(mesh(G.box, mat(wall), w2, h, d2, x + 0.35, h / 2, z + 0.15))
    addFlatRoof(x, z - 0.2, w1, d1, h, roofC)
    addFlatRoof(x + 0.35, z + 0.15, w2, d2, h, roofC)
    pushWindows(buf, x, z - 0.2, w1, d1, h, Math.max(1, Math.floor(h / 0.75)), 2)
  }

  /** 계단식 건물 — 층마다 뒤로 물러남 */
  function bldgStep(x: number, z: number, theme: (typeof THEMES)['night'], buf: WinBuf) {
    const wall = pick(theme.walls)
    const roofC = pick(theme.roofCool)
    const levels = 2 + ((Math.random() * 2) | 0)
    let y = 0
    for (let i = 0; i < levels; i++) {
      const w = 1.3 - i * 0.22, d = 1.15 - i * 0.18, h = rnd(0.7, 1.0)
      world.add(mesh(G.box, mat(wall), w, h, d, x, y + h / 2, z))
      pushWindows(buf, x, z, w, d, h, 1, Math.max(1, 3 - i))
      y += h
    }
    addFlatRoof(x, z, 1.3 - (levels - 1) * 0.22, 1.15 - (levels - 1) * 0.18, y, roofC)
  }

  /** 중층 아파트 — 발코니 줄 */
  function bldgMidrise(x: number, z: number, theme: (typeof THEMES)['night'], buf: WinBuf) {
    const w = rnd(1.2, 1.6), d = rnd(0.95, 1.25), h = rnd(2.4, 4.0) * Math.max(1, theme.tall * 0.7)
    const wall = pick(theme.walls)
    world.add(mesh(G.box, mat(wall), w, h, d, x, h / 2, z))
    // 발코니
    const floors = Math.min(5, Math.max(2, Math.floor(h / 0.85)))
    for (let fi = 0; fi < floors; fi++) {
      const fy = 0.7 + fi * (h - 0.9) / Math.max(floors - 1, 1)
      world.add(mesh(G.box, mat(0xe8e4da), w * 0.85, 0.06, 0.18, x, fy, z + d / 2 + 0.08))
      world.add(mesh(G.box, mat(0xc8c2b4), w * 0.85, 0.14, 0.03, x, fy + 0.1, z + d / 2 + 0.16))
    }
    addFlatRoof(x, z, w, d, h, pick(theme.roofCool))
    // 옥상 물탱크
    if (Math.random() < 0.45) {
      world.add(mesh(G.cyl, mat(0xb8c4d0), 0.22, 0.35, 0.22, x + w * 0.2, h + 0.3, z))
    }
    pushWindows(buf, x, z, w, d, h, floors, 3)
  }

  /** 초고층 — 유리 커튼월 + 안테나 */
  function bldgTower(x: number, z: number, theme: (typeof THEMES)['night'], buf: WinBuf) {
    const w = rnd(0.9, 1.2), d = rnd(0.85, 1.1), h = rnd(4.5, 7.5) * theme.tall
    const wall = pick([0xe8ebea, 0xdfe4e6, 0xf0efea, ...theme.walls.slice(0, 2)])
    world.add(mesh(G.box, mat(wall), w, h, d, x, h / 2, z))
    // 커튼월 세로 줄
    for (let i = 0; i < 3; i++) {
      const ox = -w / 2 + (w / 4) * (i + 1)
      world.add(mesh(G.box, mat(0xb0c4d4, { basic: true, opacity: 0.7 }), 0.08, h * 0.9, 0.02, ox, h / 2, z + d / 2 + 0.01, false))
    }
    addFlatRoof(x, z, w, d, h, 0xc8cdd2)
    world.add(mesh(G.box, mat(0x9aa8b4), w * 0.35, 0.5, d * 0.35, x, h + 0.35, z))
    world.add(mesh(G.cyl, mat(0x8a96a2), 0.04, 0.9, 0.04, x, h + 1.0, z))
    pushWindows(buf, x, z, w, d, h, Math.min(8, Math.floor(h / 0.7)), 2)
  }

  /** 창고/저층 박스 — 골판 지붕 */
  function bldgWarehouse(x: number, z: number, theme: (typeof THEMES)['night'], buf: WinBuf) {
    const w = rnd(1.3, 1.8), d = rnd(1.0, 1.4), h = rnd(0.9, 1.4)
    world.add(mesh(G.box, mat(pick([0xe4dfd4, 0xd8d4c8, ...theme.walls])), w, h, d, x, h / 2, z))
    // 삼각 박공(가로 방향)
    const roof = mesh(G.cone4, mat(pick(theme.roofCool)), w * 0.55, 0.55, d * 1.05, x, h + 0.25, z)
    roof.rotation.y = 0
    world.add(roof)
    world.add(mesh(G.box, mat(0x6a7a8a), 0.5, 0.55, 0.04, x, 0.35, z + d / 2 + 0.02))
    pushWindows(buf, x, z, w, d, h, 1, 2)
  }

  function buildCity(theme: (typeof THEMES)['night'], clears: { x: number; z: number; r: number }[], seaX: number | null) {
    const windowMats: WinBuf = []
    const bounds = [-21, ...ROADS, 21]

    for (let bi = 0; bi < bounds.length - 1; bi++) {
      for (let bj = 0; bj < bounds.length - 1; bj++) {
        const x0 = bounds[bi] + 1.25, x1 = bounds[bi + 1] - 1.25
        const z0 = bounds[bj] + 1.25, z1 = bounds[bj + 1] - 1.25
        if (x1 - x0 < 1 || z1 - z0 < 1) continue
        for (let x = x0; x <= x1; x += 1.4) {
          for (let z = z0; z <= z1; z += 1.4) {
            if (Math.abs(x) > 20.3 || Math.abs(z) > 20.3) continue
            if (seaX !== null && x > seaX) continue
            if (clears.some((c) => (x - c.x) ** 2 + (z - c.z) ** 2 < c.r * c.r)) continue
            if (Math.random() < theme.empty) {
              if (Math.random() < theme.treeP) addTree(x + rnd(-0.2, 0.2), z + rnd(-0.2, 0.2))
              continue
            }
            const dist = Math.hypot(x, z)
            const center = dist < 9
            const r = Math.random()
            // 테마·위치에 따라 건물 타입 비중 다르게
            if (theme.green && r < 0.55) bldgHouse(x, z, theme, windowMats)
            else if (theme.gableP > 0.7 && r < 0.4) bldgHouse(x, z, theme, windowMats)
            else if (r < 0.18) bldgShop(x, z, theme, windowMats)
            else if (r < 0.28) bldgL(x, z, theme, windowMats)
            else if (r < 0.38) bldgStep(x, z, theme, windowMats)
            else if (r < 0.48) bldgWarehouse(x, z, theme, windowMats)
            else if (center && theme.tall > 1.1 && r < 0.72) bldgTower(x, z, theme, windowMats)
            else if (center || theme.tall > 1.0) bldgMidrise(x, z, theme, windowMats)
            else if (r < 0.75) bldgHouse(x, z, theme, windowMats)
            else bldgShop(x, z, theme, windowMats)
          }
        }
      }
    }

    if (windowMats.length) {
      const inst = new THREE.InstancedMesh(G.plane, mat(0x9db8d4, { basic: true, opacity: 0.72 }), windowMats.length)
      windowMats.forEach((m, i) => inst.setMatrixAt(i, m))
      inst.instanceMatrix.needsUpdate = true
      world.add(inst)
    }
  }

  function addTree(x: number, z: number) {
    const s = rnd(0.75, 1.3)
    const kind = Math.random()
    world.add(mesh(G.cyl, mat(0x8a6a4c), 0.08 * s, 0.45 * s, 0.08 * s, x, 0.22 * s, z))
    if (kind < 0.45) {
      // 원뿔 침엽수
      world.add(mesh(G.cone, mat(pick([0x7fa06a, 0x6f9a5f, 0x5e8a55])), 0.4 * s, 0.9 * s, 0.4 * s, x, 0.85 * s, z))
      world.add(mesh(G.cone, mat(0x7fa06a), 0.28 * s, 0.55 * s, 0.28 * s, x, 1.35 * s, z))
    } else if (kind < 0.8) {
      // 둥근 활엽수
      world.add(mesh(G.sph, mat(pick([0x8cb078, 0x7fa06a, 0x9bc085])), 0.48 * s, 0.42 * s, 0.48 * s, x, 0.85 * s, z))
    } else {
      // 벚/단풍 톤
      world.add(mesh(G.sph, mat(pick([0xe8a0b0, 0xd4a87a, 0xc9b88a])), 0.45 * s, 0.4 * s, 0.45 * s, x, 0.82 * s, z))
    }
  }

  /* ---- 랜드마크 (디테일) ---- */
  function lmPagoda(x: number, z: number) {
    const g = new THREE.Group()
    // 기단
    g.add(mesh(G.box, mat(0xcfc6b4), 3.2, 0.25, 3.2, 0, 0.12, 0))
    g.add(mesh(G.box, mat(0xb8ae9a), 2.9, 0.18, 2.9, 0, 0.3, 0))
    for (let i = 0; i < 5; i++) {
      const w = 2.2 - i * 0.32
      const y = 0.55 + i * 1.15
      // 몸체
      g.add(mesh(G.box, mat(0xb84a3a), w * 0.72, 0.7, w * 0.72, 0, y, 0))
      // 난간
      g.add(mesh(G.box, mat(0xd7b25a), w * 0.95, 0.08, 0.06, 0, y - 0.28, w * 0.38))
      g.add(mesh(G.box, mat(0xd7b25a), w * 0.95, 0.08, 0.06, 0, y - 0.28, -w * 0.38))
      // 지붕 — 처마 넓게
      const roof = mesh(G.cone4, mat(0x4a4038), w * 1.55, 0.55, w * 1.55, 0, y + 0.5, 0)
      roof.rotation.y = Math.PI / 4
      g.add(roof)
      // 처마 밑 금색 띠
      g.add(mesh(G.box, mat(0xd7b25a), w * 1.15, 0.06, w * 1.15, 0, y + 0.28, 0))
    }
    // 상륜 (소린)
    g.add(mesh(G.cyl, mat(0xd7b25a), 0.08, 1.4, 0.08, 0, 6.5, 0))
    for (let i = 0; i < 4; i++) {
      g.add(mesh(G.cyl, mat(0xd7b25a), 0.18 - i * 0.03, 0.06, 0.18 - i * 0.03, 0, 6.0 + i * 0.18, 0))
    }
    g.add(mesh(G.sph, mat(0xd7b25a), 0.12, 0.12, 0.12, 0, 7.25, 0))
    g.position.set(x, 0, z)
    world.add(g)
    return g
  }

  function lmKaminarimon(x: number, z: number) {
    const g = new THREE.Group()
    // 붉은 기둥
    for (const sx of [-1.4, 1.4]) {
      g.add(mesh(G.cyl, mat(0xb84a3a), 0.28, 2.6, 0.28, sx, 1.3, 0))
      g.add(mesh(G.box, mat(0xd7b25a), 0.55, 0.12, 0.55, sx, 0.06, 0)) // 주춧돌
    }
    // 가로 들보
    g.add(mesh(G.box, mat(0xb84a3a), 3.6, 0.35, 0.55, 0, 2.55, 0))
    g.add(mesh(G.box, mat(0xd7b25a), 3.8, 0.12, 0.65, 0, 2.75, 0))
    // 지붕
    const roof = mesh(G.cone4, mat(0x4a4038), 4.6, 0.85, 1.8, 0, 3.35, 0)
    roof.rotation.y = Math.PI / 4
    g.add(roof)
    // 큰 빨간 등롱
    g.add(mesh(G.cyl, mat(0xc0392b), 0.55, 1.1, 0.55, 0, 1.55, 0.15))
    g.add(mesh(G.cyl, mat(0xd7b25a), 0.58, 0.08, 0.58, 0, 2.12, 0.15))
    g.add(mesh(G.cyl, mat(0xd7b25a), 0.58, 0.08, 0.58, 0, 1.0, 0.15))
    // 좌우 작은 등롱
    for (const sx of [-0.9, 0.9]) {
      g.add(mesh(G.cyl, mat(0xc0392b), 0.18, 0.4, 0.18, sx, 2.2, 0.4))
    }
    g.position.set(x, 0, z)
    world.add(g)
    return g
  }

  function lmTower(x: number, z: number) {
    // 도쿄타워 스타일 — 사다리꼴 격자 + 전망대 2단
    const g = new THREE.Group()
    const red = mat(0xd45a3a)
    const white = mat(0xf4f0e8)
    // 4개 다리 (하단 넓게)
    for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
      for (let i = 0; i < 5; i++) {
        const t = i / 5
        const spread = 1.5 * (1 - t)
        const y0 = i * 1.15, y1 = (i + 1) * 1.15
        const leg = mesh(G.cyl, i % 2 === 0 ? red : white, 0.08, 1.2, 0.08, dx * spread, (y0 + y1) / 2, dz * spread)
        leg.rotation.z = -dx * 0.14 * (1 - t)
        leg.rotation.x = dz * 0.14 * (1 - t)
        g.add(leg)
      }
    }
    // 가로 보강
    for (let i = 1; i <= 4; i++) {
      const t = i / 5
      const s = 1.5 * (1 - t)
      const y = i * 1.15
      g.add(mesh(G.box, i % 2 ? red : white, s * 2, 0.06, 0.06, 0, y, -s))
      g.add(mesh(G.box, i % 2 ? red : white, s * 2, 0.06, 0.06, 0, y, s))
      g.add(mesh(G.box, i % 2 ? red : white, 0.06, 0.06, s * 2, -s, y, 0))
      g.add(mesh(G.box, i % 2 ? red : white, 0.06, 0.06, s * 2, s, y, 0))
    }
    // 전망대
    g.add(mesh(G.cyl, white, 1.2, 0.55, 1.2, 0, 5.0, 0))
    g.add(mesh(G.cyl, mat(0xb8c8d8, { basic: true, opacity: 0.8 }), 1.05, 0.35, 1.05, 0, 5.0, 0))
    g.add(mesh(G.cyl, white, 0.75, 0.4, 0.75, 0, 6.6, 0))
    // 안테나
    g.add(mesh(G.cyl, red, 0.07, 2.4, 0.07, 0, 8.0, 0))
    g.add(mesh(G.cyl, white, 0.12, 0.15, 0.12, 0, 7.1, 0))
    g.add(mesh(G.sph, red, 0.1, 0.1, 0.1, 0, 9.25, 0))
    g.position.set(x, 0, z)
    world.add(g)
    return g
  }

  function lmWheel(x: number, z: number) {
    const g = new THREE.Group()
    const wheel = new THREE.Group()
    // 이중 링
    wheel.add(mesh(G.torus, mat(0x8b9bb0), 2.5, 2.5, 2.5, 0, 0, 0))
    const inner = mesh(G.torus, mat(0xb0bcc8), 2.0, 2.0, 2.0, 0, 0, 0)
    // torus scale은 radius를 scale로 흉내 — 안쪽 링은 별도
    wheel.add(inner)
    const cabinCs = [0xd9714f, 0x6f9a5f, 0x4a76a8, 0xd7b25a, 0xb84a3a, 0x7f8ea3, 0xe08a5c, 0x5a8aaa]
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2
      const spoke = mesh(G.cyl, mat(0xb9c2cf), 0.04, 4.9, 0.04, 0, 0, 0)
      spoke.rotation.z = a
      wheel.add(spoke)
      const cab = new THREE.Group()
      cab.add(mesh(G.box, mat(cabinCs[i % cabinCs.length]), 0.42, 0.48, 0.36, 0, 0, 0))
      cab.add(mesh(G.plane, mat(0xc5daf0, { basic: true, opacity: 0.8 }), 0.28, 0.28, 1, 0, 0.05, 0.19, false))
      cab.position.set(Math.cos(a) * 2.5, Math.sin(a) * 2.5, 0)
      wheel.add(cab)
    }
    // 허브
    wheel.add(mesh(G.cyl, mat(0x6f7f95), 0.25, 0.3, 0.25, 0, 0, 0))
    wheel.position.y = 3.2
    g.add(wheel)
    // A자 지지대
    for (const sx of [-1, 1]) {
      const leg = mesh(G.cyl, mat(0x7f8ea3), 0.12, 3.4, 0.12, sx * 1.1, 1.5, 0)
      leg.rotation.z = sx * 0.32
      g.add(leg)
    }
    g.add(mesh(G.box, mat(0x6f7f95), 2.4, 0.2, 0.5, 0, 0.1, 0))
    g.position.set(x, 0, z)
    world.add(g)
    spinners.push({ o: wheel, spd: 0.22 })
    return g
  }

  function lmBridge(x0: number, x1: number, z: number) {
    const g = new THREE.Group()
    const len = x1 - x0
    const mid = x0 + len / 2
    // 상판 (2층)
    g.add(mesh(G.box, mat(0xd8d4c8), len, 0.14, 1.3, mid, 1.6, z))
    g.add(mesh(G.box, mat(0xc8c4b8), len, 0.1, 1.1, mid, 2.0, z))
    // 난간
    g.add(mesh(G.box, mat(0xf0ece2), len, 0.08, 0.05, mid, 1.75, z + 0.6))
    g.add(mesh(G.box, mat(0xf0ece2), len, 0.08, 0.05, mid, 1.75, z - 0.6))
    // 주탑 2개
    for (const tx of [x0 + len * 0.28, x0 + len * 0.72]) {
      g.add(mesh(G.box, mat(0xf1ede2), 0.35, 4.2, 0.35, tx, 2.1, z))
      g.add(mesh(G.box, mat(0xd7b25a), 0.5, 0.15, 0.5, tx, 4.25, z))
      // 케이블 부채꼴
      for (let k = -3; k <= 3; k++) {
        if (k === 0) continue
        const cab = mesh(G.cyl, mat(0xa8b4c0), 0.025, Math.abs(k) * 0.55 + 0.8, 0.025,
          tx + k * 0.35, 3.2 - Math.abs(k) * 0.15, z)
        cab.rotation.z = -Math.sign(k) * (0.6 + Math.abs(k) * 0.12)
        g.add(cab)
      }
    }
    // 교각
    for (const tx of [x0 + len * 0.15, x0 + len * 0.5, x0 + len * 0.85]) {
      g.add(mesh(G.cyl, mat(0xc8c4b8), 0.2, 1.4, 0.2, tx, 0.7, z))
    }
    world.add(g)
    return g
  }

  function lmLawson(x: number, z: number) {
    const g = new THREE.Group()
    // 본체
    g.add(mesh(G.box, mat(0xf7f7f3), 2.0, 1.1, 1.5, 0, 0.55, 0))
    // 파란 띠 + 하늘색 띠 (로손 시그니처)
    g.add(mesh(G.box, mat(0x1a4a9c), 2.05, 0.28, 1.55, 0, 1.2, 0))
    g.add(mesh(G.box, mat(0x6eb8e8), 2.05, 0.12, 1.55, 0, 1.4, 0))
    // 정면 유리
    g.add(mesh(G.plane, mat(0xb8d4ec, { basic: true, opacity: 0.85 }), 1.5, 0.7, 1, 0, 0.55, 0.76, false))
    // 출입문
    g.add(mesh(G.box, mat(0x8ab0cc), 0.45, 0.75, 0.04, 0.55, 0.4, 0.76))
    // 측면 LAWSON 느낌 세로 간판
    g.add(mesh(G.box, mat(0x1a4a9c), 0.08, 1.0, 0.35, -1.05, 0.7, 0))
    // 주차장 노란 선
    g.add(mesh(G.box, mat(0xe8c84a), 0.8, 0.02, 0.06, 1.4, 0.02, 0.5, false))
    g.add(mesh(G.box, mat(0xe8c84a), 0.8, 0.02, 0.06, 1.4, 0.02, -0.5, false))
    g.position.set(x, 0, z)
    world.add(g)
    return g
  }

  function lmTorii(x: number, z: number) {
    const g = new THREE.Group()
    const red = mat(0xc0392b)
    // 기둥
    g.add(mesh(G.cyl, red, 0.14, 2.4, 0.14, -0.85, 1.2, 0))
    g.add(mesh(G.cyl, red, 0.14, 2.4, 0.14, 0.85, 1.2, 0))
    // 가사기 (맨 위 가로대, 양끝 살짝 위로)
    g.add(mesh(G.box, red, 2.6, 0.14, 0.28, 0, 2.5, 0))
    g.add(mesh(G.box, red, 0.35, 0.1, 0.28, -1.35, 2.58, 0))
    g.add(mesh(G.box, red, 0.35, 0.1, 0.28, 1.35, 2.58, 0))
    // 누키 (아래 가로대)
    g.add(mesh(G.box, red, 2.0, 0.12, 0.2, 0, 2.0, 0))
    // 시마키
    g.add(mesh(G.box, red, 2.2, 0.08, 0.22, 0, 2.28, 0))
    // 주춧돌
    g.add(mesh(G.cyl, mat(0xcfc6b4), 0.22, 0.15, 0.22, -0.85, 0.07, 0))
    g.add(mesh(G.cyl, mat(0xcfc6b4), 0.22, 0.15, 0.22, 0.85, 0.07, 0))
    g.position.set(x, 0, z)
    world.add(g)
    return g
  }

  function lmRopeway(x: number, z: number) {
    const g = new THREE.Group()
    // 낮은 탑 / 높은 탑
    for (const [sx, h, py] of [[-2.8, 2.4, 1.2], [2.8, 4.6, 2.3]] as const) {
      g.add(mesh(G.box, mat(0x8a6a4c), 0.3, h, 0.3, sx, py, 0))
      g.add(mesh(G.box, mat(0xa08060), 0.55, 0.12, 0.55, sx, h, 0))
      // 다리
      g.add(mesh(G.box, mat(0x7a5a44), 0.12, h * 0.6, 0.12, sx - 0.35, py * 0.4, 0.3))
      g.add(mesh(G.box, mat(0x7a5a44), 0.12, h * 0.6, 0.12, sx + 0.35, py * 0.4, -0.3))
    }
    // 케이블
    const cable = mesh(G.cyl, mat(0x5a524a), 0.035, 6.0, 0.035, 0, 3.4, 0)
    cable.rotation.z = Math.atan2(2.2, 5.6) + Math.PI / 2
    g.add(cable)
    // 곤돌라
    const gondola = new THREE.Group()
    gondola.add(mesh(G.box, mat(0xd9714f), 0.55, 0.5, 0.42, 0, 0, 0))
    gondola.add(mesh(G.plane, mat(0xc5daf0, { basic: true, opacity: 0.85 }), 0.35, 0.28, 1, 0, 0.05, 0.22, false))
    gondola.add(mesh(G.cyl, mat(0x5a524a), 0.04, 0.35, 0.04, 0, 0.4, 0))
    gondola.position.set(0.2, 2.95, 0)
    g.add(gondola)
    g.position.set(x, 0, z)
    world.add(g)
    return g
  }

  function lmFuji(x: number, z: number) {
    const g = new THREE.Group()
    // 산체 (살짝 비대칭 느낌을 위해 두 원뿔)
    g.add(mesh(G.cone, mat(0x7a8fa3), 6.5, 7.0, 6.5, 0, 3.5, 0))
    g.add(mesh(G.cone, mat(0x8a9fb0), 5.5, 5.5, 5.5, 0.3, 3.8, -0.2))
    // 눈 덮인 정상
    g.add(mesh(G.cone, mat(0xf7f8f8), 2.8, 2.8, 2.8, 0, 6.0, 0))
    g.add(mesh(G.cone, mat(0xffffff), 1.5, 1.3, 1.5, 0, 6.9, 0))
    // 능선 그림자 띠
    g.add(mesh(G.cone, mat(0x6a7f93), 6.2, 0.4, 6.2, 0, 1.8, 0))
    // 산기슭 나무 몇 그루
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + 0.3
      const tr = 5.2
      const tx = Math.cos(a) * tr, tz = Math.sin(a) * tr
      g.add(mesh(G.cyl, mat(0x8a6a4c), 0.08, 0.4, 0.08, tx, 0.2, tz))
      g.add(mesh(G.cone, mat(0x5e8a55), 0.35, 0.7, 0.35, tx, 0.7, tz))
    }
    g.position.set(x, 0, z)
    world.add(g)
    return g
  }

  function lmPlane(x: number, z: number) {
    const g = new THREE.Group()
    // 활주로
    world.add(mesh(G.box, mat(0xc8c4b8), 9, 0.05, 2.4, x, 0.025, z, false))
    world.add(mesh(G.box, mat(0xf0ece2), 8.5, 0.02, 0.12, x, 0.05, z, false)) // 중앙선
    for (let i = -3; i <= 3; i++) {
      world.add(mesh(G.box, mat(0xf0ece2), 0.5, 0.02, 0.08, x + i * 1.2, 0.05, z + 1.0, false))
      world.add(mesh(G.box, mat(0xf0ece2), 0.5, 0.02, 0.08, x + i * 1.2, 0.05, z - 1.0, false))
    }
    // 관제탑
    const tower = new THREE.Group()
    tower.add(mesh(G.box, mat(0xe8e4da), 0.5, 1.8, 0.5, 0, 0.9, 0))
    tower.add(mesh(G.box, mat(0x4a76a8), 0.85, 0.45, 0.85, 0, 2.0, 0))
    tower.add(mesh(G.plane, mat(0xb8d0e4, { basic: true, opacity: 0.8 }), 0.7, 0.3, 1, 0, 2.0, 0.44, false))
    tower.position.set(x - 3.5, 0, z + 2.2)
    g.add(tower)

    // 비행기
    const plane = new THREE.Group()
    const fus = mesh(G.cyl, mat(0xf4f4f0), 0.28, 3.0, 0.28, 0, 0, 0)
    fus.rotation.z = Math.PI / 2
    plane.add(fus)
    // 기수
    const nose = mesh(G.cone, mat(0xf4f4f0), 0.28, 0.55, 0.28, 1.7, 0, 0)
    nose.rotation.z = -Math.PI / 2
    plane.add(nose)
    // 주익 (좌우 대칭)
    plane.add(mesh(G.box, mat(0xe4e2da), 0.7, 0.07, 3.6, 0.1, 0.02, 0))
    // 미익
    plane.add(mesh(G.box, mat(0xd9714f), 0.45, 0.75, 0.08, -1.35, 0.38, 0))
    plane.add(mesh(G.box, mat(0xe4e2da), 0.4, 0.06, 1.2, -1.3, 0.06, 0))
    // 엔진
    const engL = mesh(G.cyl, mat(0xb0b4b8), 0.12, 0.42, 0.12, 0.25, -0.15, 0.95)
    engL.rotation.z = Math.PI / 2
    const engR = mesh(G.cyl, mat(0xb0b4b8), 0.12, 0.42, 0.12, 0.25, -0.15, -0.95)
    engR.rotation.z = Math.PI / 2
    plane.add(engL, engR)
    // 창문 줄
    for (let i = 0; i < 5; i++) {
      plane.add(mesh(G.sph, mat(0x4a76a8, { basic: true }), 0.06, 0.06, 0.06, 0.6 - i * 0.35, 0.12, 0.22))
    }
    plane.position.set(x + 0.8, 0.55, z)
    g.add(plane)
    world.add(g)
    return g
  }

  /* ---- 사람 · 차 ---- */
  function addWalkers(n: number) {
    const cs = [0xd9714f, 0x4a76a8, 0x6f9a5f, 0xd7b25a, 0x8a6a4c, 0xb84a3a]
    for (let i = 0; i < n; i++) {
      const g = new THREE.Group()
      const c = pick(cs)
      g.add(mesh(G.cyl, mat(c), 0.09, 0.28, 0.09, 0, 0.14, 0))
      g.add(mesh(G.sph, mat(0xf0d5bd), 0.09, 0.09, 0.09, 0, 0.36, 0))
      world.add(g)
      walkers.push({
        g, axis: Math.random() < 0.5 ? 'x' : 'z', c: pick(ROADS),
        t: Math.random(), spd: rnd(0.008, 0.02) * (Math.random() < 0.5 ? 1 : -1), off: rnd(-0.5, 0.5),
      })
    }
  }
  function addCars(n: number) {
    const cs = [0xd9714f, 0x4a76a8, 0xd7b25a, 0xf1ede2, 0x6f7f95]
    for (let i = 0; i < n; i++) {
      const g = new THREE.Group()
      const c = pick(cs)
      g.add(mesh(G.box, mat(c), 0.72, 0.2, 0.36, 0, 0.14, 0))
      g.add(mesh(G.box, mat(0xe9eef3), 0.34, 0.16, 0.3, -0.04, 0.31, 0))
      world.add(g)
      cars.push({ g, axis: Math.random() < 0.5 ? 'x' : 'z', c: pick(ROADS), t: Math.random(), spd: rnd(2.5, 4.5), dir: Math.random() < 0.5 ? 1 : -1 })
    }
  }

  /* ---- 스팟 링 + 라벨 ---- */
  function addSpot(i: number, pos: THREE.Vector3, stop: { name: string; eat?: number }) {
    const acc = stop.eat ? 0xd9714f : 0x4a76a8
    const rg = new THREE.Group()
    const ring = mesh(G.torus, mat(acc, { basic: true }), 1.1, 1.1, 1.1, 0, 0.07, 0, false)
    ring.rotation.x = Math.PI / 2
    rg.add(ring)
    const disc = mesh(G.circle, mat(acc, { basic: true, opacity: 0.16 }), 1.1, 1.1, 1, 0, 0.05, 0, false)
    disc.rotation.x = -Math.PI / 2
    rg.add(disc)
    rg.position.copy(pos)
    world.add(rg)
    rings.push({ g: rg })

    const el = document.createElement('div')
    el.className = 'dio-pin' + (stop.eat ? ' eat' : '')
    el.innerHTML = `<span class="no">${i + 1}</span><span class="nm">${stop.name}</span>`
    el.onclick = () => onSelect(i)
    const obj = new CSS2DObject(el)
    // 같은 자리(숙소 출발·복귀 등)에 겹치면 라벨을 층으로 쌓는다
    const dup = spotPos.slice(0, i).filter((p) => p.distanceTo(pos) < 0.5).length
    obj.position.set(pos.x, 2.5 + dup * 1.1, pos.z)
    world.add(obj)
    labels.push({ obj, el })
  }

  /* ---- 월드 클리어 ---- */
  function clearWorld() {
    labels.forEach((l) => l.el.remove())
    labels = []; walkers = []; cars = []; spinners = []; rings = []; spotPos = []
    world.traverse((o) => {
      const m = o as THREE.Mesh
      if (m.isMesh && m.geometry && !m.geometry.userData.shared) m.geometry.dispose()
    })
    world.clear()
  }

  /* ---- 하루 빌드 ---- */
  function buildDay(di: number) {
    clearWorld()
    const day = DAYS[di]
    const theme = THEMES[day.theme as string] ?? THEMES.night

    // 실측 상대 위치 → 판 위 좌표 (방위 유지, 반경 압축)
    const proj = projectDay(day)
    const pts: { x: number; z: number }[] = proj.stops.map((s: { km: { x: number; z: number } }) => ({
      x: s.km.x - proj.center.x, z: s.km.z - proj.center.z,
    }))
    const lmPt = proj.lm ? { x: proj.lm.x - proj.center.x, z: proj.lm.z - proj.center.z } : null
    const rmax = Math.max(...pts.map((p) => Math.hypot(p.x, p.z)), lmPt ? Math.hypot(lmPt.x, lmPt.z) : 0, 0.001)
    const norm = (p: { x: number; z: number }) => {
      const r = Math.hypot(p.x, p.z)
      const rr = SPOT_R * Math.pow(r / rmax, 0.62)
      const k = r > 0 ? rr / r : 0
      return new THREE.Vector3(p.x * k, 0, p.z * k)
    }
    spotPos = pts.map(norm)

    const clears: { x: number; z: number; r: number }[] = spotPos.map((p) => ({ x: p.x, z: p.z, r: 2.3 }))

    // 랜드마크 위치
    let lmv = lmPt ? norm(lmPt) : new THREE.Vector3(-12, 0, -10)
    const lr = Math.hypot(lmv.x, lmv.z)
    if (lr > 16) lmv = lmv.multiplyScalar(16 / lr)  // 반드시 판 위에

    const seaX = theme.sea ? 10 : null
    buildPlate(theme)
    if (theme.sea) {
      world.add(mesh(G.box, mat(0x9dc3d8), 10.5, 0.08, 41.5, 15.4, 0.04, 0, false))
      lmBridge(4.5, 15.5, -6)
    }

    // 랜드마크
    const lmClear = { plane: 5, pagoda: 3.4, wheel: 3.6, tower: 3, fuji: 7 }[day.landmark as string] ?? 3
    clears.push({ x: lmv.x, z: lmv.z, r: lmClear })
    switch (day.landmark) {
      case 'plane': lmPlane(lmv.x, lmv.z); break
      case 'pagoda':
        lmPagoda(lmv.x, lmv.z)
        lmKaminarimon(lmv.x + 4.2, lmv.z + 1.5)
        clears.push({ x: lmv.x + 4.2, z: lmv.z + 1.5, r: 2.6 })
        break
      case 'wheel': lmWheel(lmv.x, lmv.z); break
      case 'tower': lmTower(lmv.x, lmv.z); break
      case 'fuji': {
        lmFuji(lmv.x, lmv.z)
        if (di === 4) {
          lmRopeway(lmv.x + 7.5, lmv.z + 2)
          clears.push({ x: lmv.x + 7.5, z: lmv.z + 2, r: 3.4 })
        } else {
          lmTorii(lmv.x + 6.5, lmv.z + 3)
          clears.push({ x: lmv.x + 6.5, z: lmv.z + 3, r: 2 })
        }
        const lawson = day.stops.findIndex((s: { name: string }) => s.name.includes('로손'))
        if (lawson >= 0) lmLawson(spotPos[lawson].x + 1.6, spotPos[lawson].z + 0.6)
        break
      }
    }

    buildCity(theme, clears, seaX)

    // 공원 스팟엔 나무 군락
    day.stops.forEach((s: { name: string }, i: number) => {
      if (/공원/.test(s.name)) {
        for (let k = 0; k < 7; k++) {
          addTree(spotPos[i].x + rnd(-1.8, 1.8), spotPos[i].z + rnd(-1.8, 1.8))
        }
      }
    })

    addWalkers(14)
    addCars(6)
    day.stops.forEach((s: { name: string; eat?: number }, i: number) => addSpot(i, spotPos[i], s))

    focusT.set(0, 0, 0)
    focus.copy(focusT)
    zoomT = ZOOM0
    setSelected(0)
  }

  function setSelected(i: number) {
    selIdx = i
    if (spotPos[i]) focusT.copy(spotPos[i])
    labels.forEach((l, k) => {
      l.el.classList.toggle('sel', k === i)
      l.el.classList.toggle('dim', k !== i)
    })
  }

  /* ---- 루프 ---- */
  const clock = new THREE.Clock()
  let last = 0
  let rafId = 0
  let disposed = false

  function tick() {
    if (disposed) return
    const t = clock.getElapsedTime()
    const dt = Math.min(t - last, 0.05)
    last = t

    focus.lerp(focusT, 1 - Math.pow(0.002, dt))
    zoom += (zoomT - zoom) * (1 - Math.pow(0.0005, dt))
    updateCamera()

    if (!paused) {
      walkers.forEach((w) => {
        w.t = (w.t + w.spd * dt * 10 + 1) % 1
        const s = -20 + w.t * 40
        const bob = Math.abs(Math.sin(t * 8 + w.off * 10)) * 0.05
        if (w.axis === 'x') w.g.position.set(s, bob, w.c + w.off)
        else w.g.position.set(w.c + w.off, bob, s)
      })
      cars.forEach((c) => {
        c.t = (c.t + (c.spd * c.dir * dt) / 40 + 1) % 1
        const s = -20 + c.t * 40
        if (c.axis === 'x') {
          c.g.position.set(s, 0, c.c + 0.45 * c.dir)
          c.g.rotation.y = c.dir > 0 ? 0 : Math.PI
        } else {
          c.g.position.set(c.c + 0.45 * c.dir, 0, s)
          c.g.rotation.y = c.dir > 0 ? -Math.PI / 2 : Math.PI / 2
        }
      })
    }
    spinners.forEach((sp) => { sp.o.rotation.z = t * sp.spd })
    rings.forEach((r, i) => {
      const k = i === selIdx ? 1 + Math.abs(Math.sin(t * 3)) * 0.18 : 1
      r.g.scale.set(k, 1, k)
    })

    renderer.render(scene, camera)
    labelRenderer.render(scene, camera)
    rafId = requestAnimationFrame(tick)
  }

  /* ---- 입력 ---- */
  let dragging = false
  let px = 0
  const cleanups: (() => void)[] = []
  const on = <K extends keyof HTMLElementEventMap>(el: HTMLElement | Window, type: string, fn: EventListenerOrEventListenerObject, opts?: AddEventListenerOptions) => {
    el.addEventListener(type as K, fn as EventListener, opts)
    cleanups.push(() => el.removeEventListener(type as K, fn as EventListener, opts))
  }

  on(host, 'pointerdown', ((e: PointerEvent) => {
    dragging = true
    px = e.clientX
    host.setPointerCapture?.(e.pointerId)
  }) as EventListener)
  on(host, 'pointermove', ((e: PointerEvent) => {
    if (!dragging) return
    az -= (e.clientX - px) * 0.005
    px = e.clientX
  }) as EventListener)
  on(host, 'pointerup', (() => { dragging = false }) as EventListener)
  on(host, 'pointercancel', (() => { dragging = false }) as EventListener)
  on(host, 'wheel', ((e: WheelEvent) => {
    e.preventDefault()
    zoomT = Math.max(10, Math.min(60, zoomT * (1 - e.deltaY * 0.0012)))
  }) as EventListener, { passive: false })
  on(window, 'resize', (() => {
    const w = host.clientWidth, h = host.clientHeight
    renderer.setSize(w, h)
    labelRenderer.setSize(w, h)
    camera.left = -w / 2; camera.right = w / 2
    camera.top = h / 2; camera.bottom = -h / 2
    camera.updateProjectionMatrix()
  }) as EventListener)

  updateCamera()
  tick()

  return {
    buildDay,
    setSelected,
    setPaused: (p) => { paused = p },
    zoomBy: (f) => { zoomT = Math.max(10, Math.min(60, zoomT * f)) },
    resetView: () => { az = CAM_AZ0; zoomT = ZOOM0; focusT.set(0, 0, 0) },
    dispose: () => {
      disposed = true
      cancelAnimationFrame(rafId)
      cleanups.forEach((fn) => fn())
      clearWorld()
      matCache.forEach((m) => m.dispose())
      Object.values(G).forEach((g) => g.dispose())
      renderer.dispose()
      renderer.domElement.remove()
      labelHost.replaceChildren()
    },
  }
}

/* ============ React 컴포넌트 ============ */
export default function DioramaPage() {
  const hostRef = useRef<HTMLDivElement>(null)
  const labelRef = useRef<HTMLDivElement>(null)
  const engineRef = useRef<Engine | null>(null)
  const [dayIdx, setDayIdx] = useState(0)
  const [selIdx, setSelIdx] = useState(0)
  const [paused, setPaused] = useState(false)

  useEffect(() => {
    if (!hostRef.current || !labelRef.current) return
    const engine = createEngine(hostRef.current, labelRef.current, (i) => setSelIdx(i))
    engineRef.current = engine
    return () => {
      engine.dispose()
      engineRef.current = null
    }
  }, [])

  useEffect(() => {
    engineRef.current?.buildDay(dayIdx)
  }, [dayIdx])

  useEffect(() => {
    engineRef.current?.setSelected(selIdx)
  }, [selIdx])

  useEffect(() => {
    engineRef.current?.setPaused(paused)
  }, [paused])

  const selectDay = useCallback((i: number) => {
    setDayIdx(i)
    setSelIdx(0)
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') selectDay(Math.min(dayIdx + 1, DAYS.length - 1))
      if (e.key === 'ArrowLeft') selectDay(Math.max(dayIdx - 1, 0))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [dayIdx, selectDay])

  const day = DAYS[dayIdx]
  const route = day.stops.map((s: { name: string }) => s.name).join(' → ')

  return (
    <div className="dio-root">
      <div className="dio-scene" ref={hostRef} />
      <div className="dio-labels" ref={labelRef} />

      {/* 좌상단 타이틀 카드 */}
      <div className="dio-head">
        <p className="eyebrow">
          TOKYO · KAWAGUCHIKO / 5 NIGHTS 6 DAYS · DAY {day.no} · {day.d}
        </p>
        <div className="title-row">
          <span className="day-no">{day.no}</span>
          <h1>{day.t}</h1>
        </div>
        <p className="region">{day.region}</p>
        <p className="route">{route}</p>
        <div className="chips">
          {day.stops.map((s: { name: string; time: string; eat?: number }, i: number) => (
            <button
              key={i}
              type="button"
              className={'chip' + (i === selIdx ? ' sel' : '') + (s.eat ? ' eat' : '')}
              onClick={() => setSelIdx(i)}
            >
              <span className="n">{i + 1}</span>
              <span className="t">{s.time}</span>
              {s.name}
            </button>
          ))}
        </div>
      </div>

      {/* 우상단 */}
      <div className="dio-alts">
        <Link to="/map">실제 지도</Link>
        <a href="/pokemon.html">픽셀</a>
        <a href="/pokemon2.html">골드</a>
        <Link to="/">메인 디오라마</Link>
      </div>

      {/* 하단 날짜 선택 */}
      <div className="dio-pager">
        <button type="button" className="arrow" onClick={() => selectDay(Math.max(dayIdx - 1, 0))} aria-label="이전 일차">‹</button>
        {DAYS.map((d: { no: string; d: string }, i: number) => (
          <button
            key={d.no}
            type="button"
            className={'pday' + (i === dayIdx ? ' on' : '')}
            onClick={() => selectDay(i)}
          >
            <span className="no">{d.no}</span>
            <span className="dt">{d.d.split(' ')[1]}</span>
          </button>
        ))}
        <button type="button" className="arrow" onClick={() => selectDay(Math.min(dayIdx + 1, DAYS.length - 1))} aria-label="다음 일차">›</button>
      </div>

      {/* 우하단 컨트롤 */}
      <div className="dio-ctrl">
        <button type="button" onClick={() => engineRef.current?.zoomBy(1.25)} aria-label="확대">＋</button>
        <button type="button" onClick={() => engineRef.current?.zoomBy(0.8)} aria-label="축소">−</button>
        <button type="button" onClick={() => engineRef.current?.resetView()}>시점 초기화</button>
        <button type="button" onClick={() => setPaused((p) => !p)}>{paused ? '움직임 재생' : '움직임 멈춤'}</button>
      </div>

      {/* 좌하단 안내 */}
      <p className="dio-help">
        <b>드래그</b> 회전 · <b>휠</b> 확대·축소 · <b>← →</b> 날짜
      </p>
    </div>
  )
}
