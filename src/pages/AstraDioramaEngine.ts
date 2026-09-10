/**
 * Astra diorama Three.js engine (plain .ts — keep JSX out of this file)
 */
import * as THREE from 'three'
import { CSS2DObject, CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js'
import { DAYS, projectDay } from '../diorama/data.js'

type LightPreset = {
  sky: [string, string]; fog: number
  hemi: number; key: number; fill: number; rimL: number; keyColor: number; warmP: number
}
const LIGHT_PRESETS: Record<string, LightPreset> = {
  midnight: { sky: ['#141b28', '#2a3548'], fog: 0x18202c, hemi: 0.9, key: 0.4, fill: 0.3, rimL: 0.25, keyColor: 0xaac4e0, warmP: 0.55 },
  dawn: { sky: ['#514c68', '#e8b399'], fog: 0x858195, hemi: 1.2, key: 0.7, fill: 0.4, rimL: 0.3, keyColor: 0xffc9a0, warmP: 0.25 },
  morning: { sky: ['#bcdcf0', '#eef6fa'], fog: 0xd8e6f0, hemi: 1.45, key: 1, fill: 0.5, rimL: 0.15, keyColor: 0xffffff, warmP: 0.04 },
  sunset: { sky: ['#bd7967', '#fbdca0'], fog: 0xe3b899, hemi: 1.15, key: 0.85, fill: 0.45, rimL: 0.35, keyColor: 0xffb070, warmP: 0.2 },
  evening: { sky: ['#2a3550', '#4a5570'], fog: 0x303a54, hemi: 1, key: 0.5, fill: 0.35, rimL: 0.28, keyColor: 0xc0b0e0, warmP: 0.45 },
  night: { sky: ['#161c28', '#2d3a4e'], fog: 0x1a2230, hemi: 0.85, key: 0.4, fill: 0.3, rimL: 0.2, keyColor: 0x9db6c8, warmP: 0.6 },
}

const HALF = 36
const OPPOSITE: Record<string, string> = { midnight: 'morning', morning: 'midnight', dawn: 'sunset', sunset: 'dawn', evening: 'morning', night: 'sunset' }
const ROADS = [-30, -24, -18, -12, -6, 0, 6, 12, 18, 24, 30]
const AZ0 = Math.PI / 4
const EL0 = 0.62 // ~35.5° classic isometric
const DIST = 120
const ZOOM0 = 12
const SPAN = 22 // stop / landmark layout radius


/** Irregular snowline for Fuji lathe cap — module scope avoids nested redeclare noise. */
function scallopFujiSnowCap(geo: THREE.BufferGeometry) {
  const attr = geo.getAttribute('position')
  if (!(attr instanceof THREE.BufferAttribute) && !(attr instanceof THREE.InterleavedBufferAttribute)) return
  for (let i = 0; i < attr.count; i++) {
    if (attr.getY(i) > 4.51) continue
    const a = Math.atan2(attr.getZ(i), attr.getX(i))
    const dip = (Math.sin(a * 7) + Math.sin(a * 11) * 0.4) * 0.16
    const radius = 1.57 + dip * 0.65
    attr.setXYZ(i, Math.cos(a) * radius, 4.5 - dip, Math.sin(a) * radius)
  }
  geo.computeVertexNormals()
}


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

export function eventScope() {
  const offs: Set<() => void> = new Set()
  const on = (el: HTMLElement | Window, type: string, fn: EventListener, opts?: AddEventListenerOptions) => {
    el.addEventListener(type, fn, opts)
    const off = () => { el.removeEventListener(type, fn, opts); offs.delete(off) }
    offs.add(off)
    return off
  }
  return { on, dispose: () => { offs.forEach((off) => off()) } }
}

export type Engine = {
  setAlternateLight: (active: boolean) => void
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

export function createEngine(host: HTMLDivElement, labelsEl: HTMLDivElement, onPick: (i: number) => void, compass: HTMLSpanElement, onRotate: (active: boolean) => void): Engine {
  const scene = new THREE.Scene()
  let lightPreset = LIGHT_PRESETS.night
  let displayedLight = lightPreset
  let alternateLight = false, currentDay = 0
  let refreshWindows: (() => void) | null = null
  let moonSprite: THREE.Sprite | null = null
  let lightingTween: { from: LightPreset; to: LightPreset; elapsed: number } | null = null
  const lightColor = new THREE.Color()
  function applyLight(lp: LightPreset) {
    displayedLight = lp
    host.style.background = `radial-gradient(ellipse 70% 60% at 60% 46%, ${lp.sky[1]} 0%, ${lp.sky[0]} 75%)`
    if (scene.fog instanceof THREE.Fog) scene.fog.color.setHex(lp.fog)
    hemi.intensity = lp.hemi; key.intensity = lp.key; key.color.setHex(lp.keyColor)
    fill.intensity = lp.fill; rimL.intensity = lp.rimL
  }
  function setAlternateLight(active: boolean) {
    alternateLight = active
    const base = DAYS[currentDay].light as string
    const name = (active ? OPPOSITE[base] : base) ?? 'night'
    const next = LIGHT_PRESETS[name] ?? LIGHT_PRESETS.night
    lightingTween = { from: displayedLight, to: next, elapsed: 0 }
    lightPreset = next
    host.dataset.light = name
    refreshWindows?.()
    if (moonSprite) moonSprite.visible = next.warmP >= 0.45
    world.traverse((o) => {
      if (o instanceof THREE.Mesh && o.material instanceof THREE.MeshStandardMaterial) {
        o.material.emissiveIntensity = next.warmP < 0.1 ? 0 : 0.4
        if (typeof o.material.userData.leaf === 'number') o.material.color.setHex(o.material.userData.leaf).offsetHSL(0, next.warmP < 0.1 ? 0.06 : 0, 0)
      }
    })
  }
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
    // wing 지오메트리 제거 — 비행기 주익은 box 사용 (3각 기둥은 날개가 깨져 보임)
    templeRoof: (() => {
      const templePositions: number[] = [], templeIndices: number[] = []
      const levels = [[0.5, 0.12], [0.4, 0], [0.24, 0.3], [0.05, 0.7]]
      levels.forEach(([r, y], level) => {
        for (const [x, z] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) templePositions.push(x * r, y, z * r)
        if (level < levels.length - 1) for (let side = 0; side < 4; side++) {
          const a = level * 4 + side, b = level * 4 + (side + 1) % 4
          templeIndices.push(a, a + 4, b, b, a + 4, b + 4)
        }
      })
      templeIndices.push(12, 15, 14, 12, 14, 13)
      const templeGeo = new THREE.BufferGeometry()
      templeGeo.setAttribute('position', new THREE.Float32BufferAttribute(templePositions, 3)); templeGeo.setIndex(templeIndices); templeGeo.computeVertexNormals()
      return templeGeo
    })(),
    circle: new THREE.CircleGeometry(1, 40),
    torus: new THREE.TorusGeometry(1, 0.08, 8, 36),
    skytree: (() => {
      const skytreePositions: number[] = [], skytreeIndices: number[] = []
      const sides = 48, levels = 24
      for (let j = 0; j <= levels; j++) {
        const t = j / levels, radius = 1.12 * (1 - t) + 0.25 * t
        for (let i = 0; i <= sides; i++) {
          const a = i / sides * Math.PI * 2
          const sector = ((a + Math.PI / 3) % (Math.PI * 2 / 3)) - Math.PI / 3
          const triangle = 0.5 / Math.cos(sector)
          const r = radius * (triangle * (1 - t) + t)
          skytreePositions.push(Math.cos(a) * r, t * 10.8, Math.sin(a) * r)
          if (j < levels && i < sides) {
            const n = j * (sides + 1) + i
            skytreeIndices.push(n, n + sides + 1, n + 1, n + 1, n + sides + 1, n + sides + 2)
          }
        }
      }
      const skytreeGeo = new THREE.BufferGeometry()
      skytreeGeo.setAttribute('position', new THREE.Float32BufferAttribute(skytreePositions, 3))
      skytreeGeo.setIndex(skytreeIndices); skytreeGeo.computeVertexNormals()
      return skytreeGeo
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
  const cache: Map<string, THREE.Material> = new Map()
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
  function pick<T>(a: T[]): T { return a[(Math.random() * a.length) | 0] }
  // Only call with newly-created static city meshes; animated objects stay independent.
  type BatchMesh = THREE.Mesh<THREE.BufferGeometry, THREE.Material>
  function batchScenery(objects: THREE.Object3D[]) {
    const batches: Map<string, BatchMesh[]> = new Map()
    for (const o of objects) {
      if (!(o instanceof THREE.Mesh) || o instanceof THREE.InstancedMesh || Array.isArray(o.material)) continue
      const key = `${o.geometry.uuid}:${o.material.uuid}:${o.castShadow}:${o.receiveShadow}`
      const list = batches.get(key) ?? []
      list.push(o as BatchMesh); batches.set(key, list)
    }
    batches.forEach((list) => {
      if (list.length < 3) return
      const first = list[0], mesh = new THREE.InstancedMesh(first.geometry, first.material, list.length)
      list.forEach((o, i) => { o.updateMatrix(); mesh.setMatrixAt(i, o.matrix); world.remove(o) })
      mesh.castShadow = first.castShadow; mesh.receiveShadow = first.receiveShadow
      mesh.instanceMatrix.needsUpdate = true; world.add(mesh)
    })
  }

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
  let selectionTime = 0
  const keys: Set<string> = new Set()
  const right = new THREE.Vector3()
  const fwd = new THREE.Vector3()
  let dayOffs: (() => void)[] = []
  let pins: { el: HTMLElement; obj: CSS2DObject }[] = []
  let landmarkLabels: { el: HTMLElement; primary: boolean }[] = []
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
    refreshWindows = null; moonSprite = null; lightingTween = null
    animations = []; animationTime = 0
    dayOffs.forEach((off) => off()); dayOffs = []
    const shared: Set<THREE.BufferGeometry> = new Set(Object.values(G))
    const released: Set<THREE.BufferGeometry> = new Set()
    world.traverse((o) => {
      if (o instanceof THREE.InstancedMesh) o.dispose()
      if ((o instanceof THREE.Mesh || o instanceof THREE.Points) && !shared.has(o.geometry) && !released.has(o.geometry)) {
        released.add(o.geometry); o.geometry.dispose()
      }
    })
    while (world.children.length) world.remove(world.children[0])
    labelsEl.querySelectorAll('.astra-pin, .astra-lm').forEach((n) => n.remove())
    pins = []; people = []; cars = []; wheels = []; rings = []; spots = []
    landmarkLabels = []
    pathMat?.dispose(); haloMat?.dispose()
    pathMat = null; haloMat = null
  }

  function plate(th: Theme, seaX: number | null) {
    const roads = currentDay >= 4 ? [-30, 30] : ROADS
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
    for (const r of roads) {
      world.add(M(G.box, mat(th.road), landLen, 0.04, 1.15, (landR + (-HALF + 0.3)) / 2, 0.12, r))
      if (seaX === null || r < seaX - 0.8) world.add(M(G.box, mat(th.road), 1.15, 0.04, HALF * 2 - 0.6, r, 0.12, 0))
    }
    const curbs: Part[] = []
    for (const r of roads) for (const side of [-1, 1]) {
      curbs.push({ x: (landR - HALF + 0.3) / 2, y: 0.13, z: r + side * 0.61, sx: landLen, sy: 0.06, sz: 0.08 })
      if (seaX === null || r < seaX - 0.8) curbs.push({ x: r + side * 0.61, y: 0.13, z: 0, sx: 0.08, sy: 0.06, sz: HALF * 2 - 0.6 })
    }
    instances(world, G.box, mat(new THREE.Color(th.road).multiplyScalar(0.82).getHex()), curbs).castShadow = false
    const paint: Part[] = []
    for (const road of roads) {
      for (let v = -HALF + 1; v < landR; v += 1.5) {
        if (!ROADS.some((cross) => Math.abs(v - cross) < 1.5)) paint.push({ x: v, y: 0.151, z: road, sx: 0.65, sy: 0.008, sz: 0.045 })
      }
      if (seaX !== null && road >= seaX - 0.8) continue
      for (let v = -HALF + 1; v < HALF - 1; v += 1.5) {
        if (!ROADS.some((cross) => Math.abs(v - cross) < 1.5)) paint.push({ x: road, y: 0.151, z: v, sx: 0.045, sy: 0.008, sz: 0.65 })
      }
      for (const cross of roads) for (const side of [-1, 1]) for (let stripe = 0; stripe < 4; stripe++) {
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
    mat(leaf, { rough: 0.95 }).userData.leaf = leaf
    g.add(M(G.sph, mat(leaf, { rough: 0.95 }), rnd(0.35, 0.55), rnd(0.32, 0.48), rnd(0.35, 0.55), 0, lush ? 0.7 : 0.55, 0))
    if (lush && Math.random() < 0.4) g.add(M(G.sph, mat(leaf, { rough: 0.95 }), 0.28, 0.25, 0.28, 0.25, 0.55, 0.1))
    g.position.set(x, 0, z)
    world.add(g)
  }

  function city(th: Theme, clears: { x: number; z: number; r: number }[], seaX: number | null, buf: Win = []) {
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
      const windowMeshes: THREE.InstancedMesh[] = []
      const samples = buf.map((w) => ({ w, chance: Math.random(), shade: Math.random() }))
      const place = (list: Win, color: number, lit: boolean) => {
        if (!list.length) return
        const inst = new THREE.InstancedMesh(G.plane, mat(color, { basic: lit, opacity: 0.78, rough: 0.4 }), list.length)
        const glow = new THREE.InstancedMesh(G.plane, mat(color, { basic: true, opacity: 0.12, map: softTexture }), list.length)
        glow.visible = lit
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
        windowMeshes.push(inst, glow)
      }
      refreshWindows = () => {
        windowMeshes.forEach((mesh) => { world.remove(mesh); mesh.dispose() })
        windowMeshes.length = 0
        const warm: Win = [], amber: Win = [], cool: Win = [], dark: Win = []
        samples.forEach(({ w, chance, shade }) => {
          if (lightPreset.warmP < 0.1 || chance >= lightPreset.warmP) dark.push(w)
          else if (shade < 0.3) cool.push(w)
          else if (shade < 0.65) amber.push(w)
          else warm.push(w)
        })
        place(dark, 0x7891a3, false)
        place(warm, 0xf0e0c0, true)
        place(amber, 0xe9bd85, true)
        place(cool, 0xa8c8e0, true)
      }
      refreshWindows()
    }
  }

  function addLmLabel(x: number, z: number, y: number, title: string, jp?: string) {
    const el = document.createElement('div')
    el.className = 'astra-lm'
    const primary = ['후지산', '카와구치호', '롯폰기 모리타워', '센소지 오층탑', '가미나리몬', '우에노 공원', '아키하바라', '도쿄타워', '대관람차', '하네다공항', '레인보우 브리지', '도쿄 스카이트리'].includes(title)
    landmarkLabels.push({ el, primary })
    el.innerHTML = `<span class="t">${title}</span>${jp ? `<span class="j">${jp}</span>` : ''}`
    const obj = new CSS2DObject(el)
    obj.position.set(x, y, z)
    world.add(obj)
    if (y >= 4) {
      const halo = M(G.plane, mat(0xf5c798, { basic: true, map: softTexture, opacity: 0.055 }), 5, 5, 1, x, 0.2, z)
      halo.rotation.x = -Math.PI / 2; halo.castShadow = false; world.add(halo)
      animations.push(() => { halo.visible = lightPreset.warmP >= 0.4 })
    }
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
    boat.name = 'cruising-boat'
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
    boatFleet(x, z, 3.2, 1.45, 0.39, 2)
    waterDetails(x, z, 6.1, 3.7, 0.27)
  }

  // Bounded elliptical lanes keep hulls, wakes and ripples inside the water.
  function boatFleet(x: number, z: number, rx: number, rz: number, y: number, count: number) {
    for (let i = 0; i < count; i++) {
      const boat = new THREE.Group()
      boat.name = 'cruising-boat'
      boat.add(M(G.sph, mat(0xf1eee4), 0.8, 0.18, 0.3, 0, 0.06, 0))
      boat.add(M(G.box, mat(0xf1eee4), 0.7, 0.3, 0.42, -0.1, 0.24, 0))
      boat.add(M(G.box, mat(0x668a9d), 0.5, 0.16, 0.44, -0.08, 0.32, 0))
      boat.add(M(G.box, mat(i % 2 ? 0x637e8a : 0xe07a5f), 0.8, 0.07, 0.5, -0.1, 0.44, 0))
      const wake = M(G.plane, mat(0xd9edf0, { basic: true, map: softTexture, opacity: 0.2 }), 1.6, 0.65, 1, -1.1, -0.08, 0)
      wake.rotation.x = -Math.PI / 2; boat.add(wake)
      boat.traverse((o) => { o.castShadow = false }); world.add(boat)
      const ripple = M(G.torus, mat(0xd5e9ee, { basic: true, opacity: 0.12 }), 1, 1, 1, 0, y - 0.08, 0)
      ripple.rotation.x = -Math.PI / 2; ripple.castShadow = false; world.add(ripple)
      animations.push((t) => {
        const a = t * (0.045 + i * 0.014) + i * Math.PI * 0.8
        const lane = 1 - i * 0.16
        boat.position.set(x + Math.cos(a) * rx * lane, y + Math.sin(t + i) * 0.02, z + Math.sin(a) * rz * lane)
        boat.rotation.y = Math.atan2(-rz * Math.cos(a), -rx * Math.sin(a))
        const phase = (t * 0.45 + i * 0.33) % 1
        ripple.position.set(boat.position.x, y - 0.1, boat.position.z)
        ripple.scale.setScalar(0.2 + phase * 0.7)
        ripple.visible = phase < 0.85
      })
    }
  }

  function waterDetails(x: number, z: number, rx: number, rz: number, y: number) {
    const parts: Part[] = []
    for (let i = 0; i < 36; i++) {
      const a = i * 2.39996, r = Math.sqrt((i + 0.5) / 36) * 0.86
      parts.push({ x: x + Math.cos(a) * rx * r, z: z + Math.sin(a) * rz * r, y, sx: 0.25 + (i % 4) * 0.16, sy: 0.009, sz: 0.028 })
    }
    const waves = instances(world, G.box, mat(0xc6e1e5, { basic: true, opacity: 0.2 }), parts)
    waves.castShadow = false
    const dummy = new THREE.Object3D()
    animations.push((t) => {
      parts.forEach((p, i) => {
        dummy.position.set(p.x + Math.sin(t * 0.28 + i) * 0.13, y, p.z + Math.cos(t * 0.19 + i) * 0.1)
        dummy.scale.set(p.sx * (0.85 + Math.sin(t * 0.6 + i) * 0.25), 0.009, 0.028)
        dummy.updateMatrix(); waves.setMatrixAt(i, dummy.matrix)
      })
      waves.instanceMatrix.needsUpdate = true
    })
    const reflection = M(G.plane, mat(0xf0ce9f, { basic: true, opacity: 0.1, map: softTexture }), rx * 0.6, rz * 1.5, 1, x, y + 0.006, z)
    reflection.rotation.x = -Math.PI / 2; reflection.castShadow = false; world.add(reflection)
    animations.push((t) => { reflection.visible = lightPreset.warmP >= 0.2; reflection.scale.x = rx * (0.5 + Math.sin(t * 0.4) * 0.08) })
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

  function lmPagoda(x: number, z: number, scale = 1) {
    const g = new THREE.Group()
    const red = 0xb84438, dark = 0x2a221c, gold = 0xd4af37
    g.add(M(G.box, mat(0xf0e6d4), 2.6, 0.25, 2.6, 0, 0.12, 0))
    for (let i = 0; i < 5; i++) {
      const s = 2.4 - i * 0.35, y = 0.55 + i * 1.15
      g.add(M(G.box, mat(red), s * 0.72, 0.7, s * 0.72, 0, y, 0))
      g.add(M(G.box, mat(dark), s * 1.35, 0.1, s * 1.35, 0, y + 0.4, 0))
      g.add(M(G.templeRoof, mat(0x4e5961), s * 1.45, 0.7, s * 1.45, 0, y + 0.42, 0))
      for (const a of [-1, 1]) for (const b of [-1, 1]) g.add(M(G.box, mat(0x913e30), 0.09, 0.72, 0.09, a * s * 0.37, y, b * s * 0.37))
      g.add(M(G.box, mat(dark), s * 1.15, 0.08, 0.12, 0, y + 0.48, s * 0.62))
      g.add(M(G.box, mat(dark), s * 1.15, 0.08, 0.12, 0, y + 0.48, -s * 0.62))
      g.add(M(G.box, mat(dark), 0.12, 0.08, s * 1.15, s * 0.62, y + 0.48, 0))
      g.add(M(G.box, mat(dark), 0.12, 0.08, s * 1.15, -s * 0.62, y + 0.48, 0))
    }
    g.add(M(G.cyl, mat(gold), 0.12, 1.4, 0.12, 0, 6.6, 0))
    g.add(M(G.sph, mat(gold, { basic: true }), 0.22, 0.22, 0.22, 0, 7.35, 0))
    g.position.set(x, 0, z)
    g.scale.setScalar(scale)
    world.add(g)
    addLmLabel(x, z, 8.2 * scale, '센소지 오층탑', '五重塔')
  }

  function lmGate(x: number, z: number, scale = 1) {
    const g = new THREE.Group()
    const red = 0xb84438
    g.add(M(G.box, mat(red), 0.45, 3.0, 0.45, -1.7, 1.5, 0))
    g.add(M(G.box, mat(red), 0.45, 3.0, 0.45, 1.7, 1.5, 0))
    g.add(M(G.box, mat(red), 4.2, 0.45, 0.7, 0, 2.85, 0))
    g.add(M(G.box, mat(0x2a221c), 4.8, 0.22, 0.9, 0, 3.25, 0))
    g.add(M(G.box, mat(0x2a221c), 5.0, 0.12, 0.5, 0, 3.45, 0))
    g.add(M(G.templeRoof, mat(0x46515b), 5.2, 1, 2.1, 0, 3.35, 0))
    g.add(M(G.cyl, mat(0xc45c45), 0.55, 1.3, 0.55, 0, 1.5, 0.15))
    g.add(M(G.cyl, mat(0xf0e6d4), 0.5, 0.2, 0.5, 0, 2.15, 0.15))
    g.add(M(G.box, mat(0x2a221c), 0.35, 0.45, 0.05, 0, 1.5, 0.72))
    g.position.set(x, 0, z)
    g.scale.setScalar(scale)
    world.add(g)
    addLmLabel(x, z, 4.2 * scale, '가미나리몬', '雷門')
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
    animations.push(() => { leds.visible = lightPreset.warmP >= 0.1 })
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
    boatFleet(26, 15, 5, 12, 0.3, 3)
    waterDetails(25, 0, 9, 31, 0.22)
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

  function lmFuji(x: number, z: number, scale = 1) {
    const g = new THREE.Group()
    g.add(M(G.cone, mat(0x6a8a68, { rough: 0.95 }), 3.2, 1.4, 3.2, -2.5, 0.7, 1.5))
    g.add(M(G.cone, mat(0x5e7e5c, { rough: 0.95 }), 2.8, 1.2, 2.8, 2.8, 0.6, 1.2))
    const profile = [[6.2, 0], [5.1, 0.65], [3.8, 1.7], [2.6, 3.05], [1.55, 4.5], [0.65, 5.9], [0.38, 6.1], [0, 6.08]]
    const mountain = new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), 48)
    g.add(M(mountain, mat(0x8295a8, { rough: 0.95 }), 1, 1, 1, 0, 0, 0))
    const fujiSnow = new THREE.LatheGeometry([new THREE.Vector2(1.57, 4.5), new THREE.Vector2(0.67, 5.9), new THREE.Vector2(0.4, 6.12), new THREE.Vector2(0, 6.1)], 48)
    scallopFujiSnowCap(fujiSnow)
    g.add(M(fujiSnow, mat(0xf1f3ef), 1, 1, 1, 0, 0.015, 0))
    g.scale.setScalar(scale)
    g.position.set(x, 0, z)
    world.add(g)
    addLmLabel(x, z, 7.4 * scale, '후지산', '富士山')
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
    animations.push((t) => { const u = Math.sin(t * 0.18); car.position.set(u * 2.8, 3.6 + u * 0.72, 0) })
    g.position.set(x, 0, z)
    world.add(g)
    addLmLabel(x, z, 5.8, '후지산 로프웨이', 'ロープウェイ')
  }

  function lmAirport(x: number, z: number, scale = 1) {
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
    animations.push(() => { runway.visible = lightPreset.warmP >= 0.1 })
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
    if (scale === 1) {
      addLmLabel(x, z - 1.8, 0.6, '활주로 유도등', '滑走路灯')
      addLmLabel(x - 5.2, z + 2.2, 4.8, '관제탑 회전등', '管制塔ビーコン')
    }
    const plane = new THREE.Group()
    const fus = M(G.cyl, mat(0xf2f4f7), 0.3, 3.8, 0.3, 0, 0, 0)
    fus.rotation.z = Math.PI / 2
    plane.add(fus)
    const nose = M(G.cone, mat(0xf2f4f7), 0.3, 0.75, 0.3, 2.15, 0, 0)
    nose.rotation.z = -Math.PI / 2
    plane.add(nose)
    // 주익: 좌우 대칭 박스 (예전 3각 기둥 wing 지오메트리는 한쪽만 날개처럼 보임)
    plane.add(M(G.box, mat(0xdde4ec), 0.85, 0.08, 3.8, 0.15, 0.02, 0))
    // 날개 끝 살짝 접힌 느낌
    plane.add(M(G.box, mat(0xc8d0da), 0.28, 0.06, 0.35, 0.05, 0.08, 1.85))
    plane.add(M(G.box, mat(0xc8d0da), 0.28, 0.06, 0.35, 0.05, 0.08, -1.85))
    // 수직·수평 미익
    plane.add(M(G.box, mat(0xe07a5f), 0.55, 0.85, 0.1, -1.65, 0.42, 0))
    plane.add(M(G.box, mat(0xdde4ec), 0.45, 0.07, 1.35, -1.55, 0.08, 0))
    // 엔진 (동체와 같은 축)
    const engL = M(G.cyl, mat(0xb0b4b8), 0.13, 0.48, 0.13, 0.35, -0.18, 0.95)
    engL.rotation.z = Math.PI / 2
    const engR = M(G.cyl, mat(0xb0b4b8), 0.13, 0.48, 0.13, 0.35, -0.18, -0.95)
    engR.rotation.z = Math.PI / 2
    plane.add(engL, engR)
    for (let i = 0; i < 4; i++) plane.add(M(G.sph, mat(0x4a90b8, { basic: true }), 0.06, 0.06, 0.06, 0.7 - i * 0.4, 0.12, 0.22))
    plane.position.set(1.8, 0.55, 0)
    g.add(plane)
    plane.name = 'departing-aircraft'
    const red = M(G.sph, mat(0xe86d64, { basic: true }), 0.055, 0.055, 0.055, 0.05, 0.05, 1.95)
    const green = M(G.sph, mat(0x7abf9b, { basic: true }), 0.055, 0.055, 0.055, 0.05, 0.05, -1.95)
    plane.add(red, green)
    plane.traverse((o) => { o.castShadow = false })
    animations.push((t) => {
      const phase = t % 22
      const run = Math.min(phase / 6, 1)
      const climb = Math.max(0, phase - 6)
      plane.position.set(-3 + 6 * run * run + climb * 3.1, 0.55 + climb * 1.65, 0)
      plane.rotation.z = climb > 0 ? Math.min(climb * 0.12, 0.22) : 0
      plane.visible = x + plane.position.x * scale < HALF + 7
      red.visible = green.visible = lightPreset.warmP > 0.1 && Math.sin(t * 8) > 0
      beam.visible = lightPreset.warmP > 0.1
    })
    g.position.set(x, 0, z)
    g.scale.setScalar(scale)
    if (scale !== 1) {
      g.position.y = 0.55
      const parked = plane.clone()
      parked.name = 'parked-aircraft'
      parked.position.set(-1, 0.55, -7)
      g.add(parked)
    }
    world.add(g)
    addLmLabel(x, z, 4.2 * scale, '하네다공항', '羽田空港')
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

  function addPath(pts: THREE.Vector3[], accent: number, authored?: THREE.Vector3[]) {
    if (pts.length < 2) return
    const line = authored ?? routePolyline(pts)
    pathMat = new THREE.MeshBasicMaterial({ color: 0xff8c5a, transparent: true, opacity: 0.95, depthTest: false, depthWrite: false })
    haloMat = new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.16, depthWrite: false })
    const grp = new THREE.Group()
    const W = currentDay === 0 ? 0.23 : 0.35, Y = currentDay === 0 ? 0.83 : 0.34
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
    const segments = line.slice(1).map((b, i) => ({ a: line[i], b, length: b.distanceTo(line[i]) })).filter((s) => s.length > 0.001)
    const total = segments.reduce((sum, s) => sum + s.length, 0)
    if (total > 0) {
      const flow = new THREE.InstancedMesh(G.sph, mat(0xffeccb, { basic: true }), 5)
      flow.renderOrder = 6; flow.castShadow = false; world.add(flow)
      const dummy = new THREE.Object3D()
      animations.push((t) => {
        for (let i = 0; i < 5; i++) {
          let distance = (t * 2.2 + total * i / 5) % total
          for (const s of segments) {
            if (distance <= s.length) {
              dummy.position.lerpVectors(s.a, s.b, distance / s.length); dummy.position.y = Y + 0.06
              dummy.scale.set(0.17, 0.08, 0.17); dummy.updateMatrix(); flow.setMatrixAt(i, dummy.matrix)
              break
            }
            distance -= s.length
          }
        }
        flow.instanceMatrix.needsUpdate = true
      })
    }
  }

  function atmosphere(th: Theme) {
    for (let i = 0; i < 3; i++) {
      const shadow = M(G.plane, mat(0x617787, { basic: true, map: softTexture, opacity: 0.045 }), 12, 7, 1, 0, 0.19, 0)
      shadow.rotation.x = -Math.PI / 2; shadow.castShadow = false; world.add(shadow)
      animations.push((t) => {
        shadow.visible = lightPreset.warmP < 0.3
        shadow.position.set(Math.sin(t * 0.018 + i * 2) * 22, 0.19, -18 + i * 18)
      })
    }
    if (!th.green) {
      const moon = new THREE.Sprite(mat(0xffffff, { sprite: true, map: moonTexture }) as THREE.SpriteMaterial)
      moonSprite = moon
      moon.visible = lightPreset.warmP >= 0.45
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
      const flakeXYZ = new Float32Array(50 * 3)
      for (let i = 0; i < 50; i++) { flakeXYZ[i * 3] = rnd(-HALF, HALF); flakeXYZ[i * 3 + 1] = rnd(1, 15); flakeXYZ[i * 3 + 2] = rnd(-HALF, HALF) }
      const flakeGeo = new THREE.BufferGeometry()
      flakeGeo.setAttribute('position', new THREE.BufferAttribute(flakeXYZ, 3))
      const flakes = new THREE.Points(flakeGeo, mat(0xf3f5ff, { points: true, map: softTexture, opacity: 0.7 }) as THREE.PointsMaterial)
      world.add(flakes)
      animations.push((t, dt) => {
        // October's dawn carries warm leaf-like flecks; cool evenings keep the existing snow.
        flakes.material.color.setHex(lightPreset.keyColor === LIGHT_PRESETS.dawn.keyColor ? 0xe6be89 : 0xf3f5ff)
        for (let i = 0; i < 50; i++) {
          flakeXYZ[i * 3] += Math.sin(t * 0.5 + i) * dt * 0.18
          flakeXYZ[i * 3 + 1] -= dt * (0.25 + i % 5 * 0.06)
          if (flakeXYZ[i * 3 + 1] < 0.25) flakeXYZ[i * 3 + 1] = 15
        }
        flakeGeo.attributes.position.needsUpdate = true
      })
    }
  }

  let trafficRight = HALF - 2
  function addLife(seaX: number | null) {
    trafficRight = seaX === null ? HALF - 2 : seaX - 1.5
    const landRoads = (currentDay >= 3 ? [-30, 30] : currentDay === 2 ? [-30, -24] : ROADS).filter((r) => r < trafficRight)
    const pcs = [0xe07a5f, 0x4a90b8, 0x6fa06a, 0xd4af37, 0x6d7f96]
    for (let i = 0; i < 36; i++) {
      const g = new THREE.Group()
      g.add(M(G.cyl, mat(pick(pcs)), 0.07, 0.28, 0.07, 0, 0.14, 0))
      g.add(M(G.sph, mat(0xf0d5bd), 0.08, 0.08, 0.08, 0, 0.36, 0))
      world.add(g)
      people.push({ g, axis: Math.random() < 0.5 ? 'x' : 'z', c: pick(landRoads), t: Math.random(), spd: rnd(0.012, 0.025) * (Math.random() < 0.5 ? 1 : -1), off: rnd(-0.35, 0.35) })
    }
    for (let i = 0; i < 18; i++) {
      const g = new THREE.Group()
      const taxi = currentDay < 4 && i < 5
      g.name = taxi ? 'city-taxi' : 'city-car'
      g.add(M(G.box, mat(taxi ? 0xf0c93e : pick(pcs)), 0.72, 0.2, 0.36, 0, 0.24, 0))
      g.add(M(G.box, mat(0xe9eef3), 0.34, 0.16, 0.3, -0.04, 0.3, 0))
      if (taxi) {
        g.add(M(G.box, mat(0x29333c), 0.38, 0.04, 0.31, -0.04, 0.4, 0))
        g.add(M(G.box, mat(0xffe9a2, { emissive: 0xffd16b }), 0.17, 0.09, 0.1, -0.04, 0.46, 0))
      }
      for (const ax of [-0.23, 0.23]) for (const side of [-1, 1]) g.add(M(G.sph, mat(0x35404a), 0.08, 0.08, 0.04, ax, 0.19, side * 0.18))
      world.add(g)
      cars.push({ g, axis: Math.random() < 0.5 ? 'x' : 'z', c: pick(landRoads), t: Math.random(), spd: rnd(2.6, 4.5), dir: Math.random() < 0.5 ? 1 : -1 })
    }
    if (currentDay >= 4) for (let i = 0; i < 2; i++) {
      const g = new THREE.Group()
      g.name = 'highway-bus'
      g.add(M(G.box, mat(0xf3eee4), 1.65, 0.55, 0.52, 0, 0.49, 0))
      g.add(M(G.box, mat(i ? 0x668ca0 : 0xe07a5f), 1.67, 0.12, 0.54, 0, 0.32, 0))
      const windows: Part[] = []
      for (const side of [-1, 1]) for (let k = 0; k < 5; k++) windows.push({ x: -0.6 + k * 0.29, y: 0.6, z: side * 0.27, sx: 0.23, sy: 0.22, sz: 0.02 })
      instances(g, G.box, mat(0x587a8e), windows)
      for (const ax of [-0.55, 0.55]) for (const side of [-1, 1]) g.add(M(G.sph, mat(0x35404a), 0.12, 0.12, 0.055, ax, 0.26, side * 0.25))
      world.add(g)
      // Outermost roads avoid the lake and mountain parcels.
      cars.push({ g, axis: 'x', c: i ? 30 : -30, t: 0.2 + i * 0.5, spd: 1.7 + i * 0.2, dir: i ? -1 : 1 })
    }
    if (currentDay === 1) cars.forEach((c, i) => { c.c = c.axis === 'x' && i % 2 ? 30 : 24 })
    if (currentDay === 1) people.forEach((p, i) => { p.c = i % 2 ? 18 : 24 })
    // A day can be built while paused: place traffic immediately, not at the origin.
    people.forEach((w) => {
      const s = -HALF + 2 + w.t * (w.axis === 'x' ? trafficRight + HALF - 2 : HALF * 2 - 4)
      w.g.position.set(w.axis === 'x' ? s : w.c + w.off, 0, w.axis === 'x' ? w.c + w.off : s)
    })
    cars.forEach((c) => {
      const s = -HALF + 2 + c.t * (c.axis === 'x' ? trafficRight + HALF - 2 : HALF * 2 - 4)
      c.g.position.set(c.axis === 'x' ? s : c.c + 0.35 * c.dir, 0, c.axis === 'x' ? c.c + 0.35 * c.dir : s)
      c.g.rotation.y = c.axis === 'x' ? (c.dir > 0 ? 0 : Math.PI) : (c.dir > 0 ? -Math.PI / 2 : Math.PI / 2)
    })
  }

  function bayTrain() {
    const track = new THREE.Group()
    track.add(M(G.box, mat(0xc0c9ce), 24, 0.22, 1.15, 21, 2.3, -7))
    for (const side of [-1, 1]) track.add(M(G.box, mat(0x82959f), 24, 0.07, 0.06, 21, 2.46, -7 + side * 0.34))
    for (let x = 10; x < 34; x += 4) track.add(M(G.box, mat(0xa3b3bc), 0.25, 2.2, 0.6, x, 1.15, -7))
    world.add(track)
    const train = new THREE.Group()
    train.name = 'yurikamome-train'
    const trainWindows: Part[] = []
    for (let i = 0; i < 3; i++) {
      const x = -i * 1.8
      train.add(M(G.box, mat(0xf0f3f2), 1.65, 0.6, 0.72, x, 0.34, 0))
      train.add(M(G.box, mat(0x688f9f), 1.67, 0.1, 0.74, x, 0.22, 0))
      for (const side of [-1, 1]) for (let w = 0; w < 3; w++) trainWindows.push({ x: x - 0.48 + w * 0.48, y: 0.48, z: side * 0.37, sx: 0.34, sy: 0.24, sz: 0.03 })
    }
    instances(train, G.box, mat(0x496c81), trainWindows)
    train.traverse((o) => { o.castShadow = false }); world.add(train)
    animations.push((t) => {
      const phase = (t * 0.055) % 2
      const progress = (1 - Math.cos(phase * Math.PI)) / 2
      train.position.set(14 + progress * 14, 2.47, -7)
    })
    addLmLabel(30, -7, 3.9, '유리카모메', 'ゆりかもめ')
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
    const pulse = M(G.torus, mat(accent, { basic: true, opacity: 0.38 }), 1, 1, 1, 0, 0.13, 0)
    pulse.rotation.x = -Math.PI / 2; rg.add(pulse)
    animations.push((t) => {
      pulse.visible = i === sel
      if (i !== sel) return
      const age = ((t - selectionTime) * 0.65) % 1
      pulse.scale.setScalar(0.7 + age * 1.2)
      ;(pulse.material as THREE.MeshBasicMaterial).opacity = 0.42 * (1 - age)
    })

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

  /** Authored Haneda chapter: three land masses, navigable canals and a skyline. */
  function buildHaneda() {
    let seed = 1701
    const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296 }
    const box = (c: number, sx: number, sy: number, sz: number, x: number, y: number, z: number) => world.add(M(G.box, mat(c), sx, sy, sz, x, y, z))
    box(0x25313d, 73.5, 1.8, 73.5, 0, -0.85, 0)
    box(0x43505b, 73.7, 0.15, 73.7, 0, -1.65, 0)
    world.add(M(G.box, mat(0x183e52, { rough: 0.23, metal: 0.45, env: true }), 72.8, 0.14, 72.8, 0, 0.02, 0))
    // The channels stay open: unlike a painted water patch, all roads end at quays.
    for (const [x, z, w, d] of [[-22, 20, 27, 29], [-22, -20, 27, 29], [20, 0, 29, 69]]) {
      box(0x6c7780, w, 0.55, d, x, 0.15, z)
      box(0x89949b, w, 0.08, d, x, 0.46, z)
      for (const side of [-1, 1]) {
        box(0xb0b7b7, w, 0.13, 0.18, x, 0.54, z + side * d / 2)
        box(0xb0b7b7, 0.18, 0.13, d, x + side * w / 2, 0.54, z)
      }
    }
    const roadParts: Part[] = [], markings: Part[] = [], lamps: Part[] = [], poles: Part[] = []
    const road = (x: number, z: number, length: number, alongX: boolean) => {
      roadParts.push({ x, y: 0.53, z, sx: alongX ? length : 1.8, sy: 0.045, sz: alongX ? 1.8 : length })
      for (let s = -length / 2 + 0.8; s < length / 2; s += 1.7) markings.push({ x: x + (alongX ? s : 0), y: 0.56, z: z + (alongX ? 0 : s), sx: alongX ? 0.55 : 0.055, sy: 0.008, sz: alongX ? 0.055 : 0.55 })
      for (let s = -length / 2 + 1.5; s < length / 2; s += 4.5) for (const side of [-1, 1]) {
        const px = x + (alongX ? s : side * 1.15), pz = z + (alongX ? side * 1.15 : s)
        poles.push({ x: px, y: 1.03, z: pz, sx: 0.045, sy: 1, sz: 0.045 })
        lamps.push({ x: px, y: 1.55, z: pz, sx: 0.11, sy: 0.045, sz: 0.16 })
      }
    }
    for (const x of [9, 18, 27]) road(x, 0, 66, false)
    for (const z of [-27, -18, -9, 0, 9, 18, 27]) road(20, z, 28, true)
    for (const x of [-29, -20, -11]) road(x, -20, 27, false)
    for (const z of [-27, -18, -9]) road(-22, z, 26, true)
    road(-22, 18, 26, true); road(-11, 20, 26, false)
    instances(world, G.box, mat(0x3f4c5a), roadParts)
    instances(world, G.box, mat(0xbfc4bd), markings).castShadow = false
    instances(world, G.box, mat(0x556571), poles)
    const lights = instances(world, G.box, mat(0xffdca0, { basic: true }), lamps)
    lights.castShadow = false
    animations.push(() => { lights.visible = lightPreset.warmP >= 0.1 })
    const pools = instances(world, G.plane, mat(0xf5cb88, { basic: true, opacity: 0.1, map: softTexture }), lamps.map((p) => ({ x: p.x, y: -p.z, z: 0.58, sx: 1.8, sy: 1.8, sz: 1 })))
    pools.rotation.x = -Math.PI / 2; pools.castShadow = false
    animations.push(() => { pools.visible = lightPreset.warmP >= 0.1 })
    const bridge = (z: number) => {
      box(0x697885, 18, 0.25, 2.3, 0, 0.64, z)
      for (const side of [-1, 1]) {
        box(0xb9c4c9, 18, 0.16, 0.08, 0, 0.98, z + side * 1.12)
        for (let x = -7; x <= 7; x += 2) box(0x8f9ea9, 0.06, 0.4, 0.06, x, 0.8, z + side * 1.12)
      }
      for (const x of [-5, 5]) box(0x7d8d9b, 0.5, 0.65, 1.8, x, 0.3, z)
      if (z === 18) for (const x of [-5, 5]) for (const side of [-1, 1]) {
        box(0xa7b8c4, 0.18, 3.5, 0.18, x, 2.4, z + side * 1.05)
        for (const direction of [-1, 1]) for (let k = 1; k <= 4; k++) {
          const a = new THREE.Vector3(x, 4.1 - k * 0.13, z + side * 1.05)
          const b = new THREE.Vector3(x + direction * k * 0.9, 0.9, z + side * 1.05)
          const delta = b.clone().sub(a), mid = a.clone().add(b).multiplyScalar(0.5)
          const cable = M(G.cyl, mat(0x899fad), 0.022, delta.length(), 0.022, mid.x, mid.y, mid.z)
          cable.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize())
          cable.castShadow = false; world.add(cable)
        }
      }
    }
    bridge(18); bridge(-18)
    // Airport terminal and apron are the foreground hero, not another city block.
    lmAirport(-24, 24, 1.65)
    box(0x5c6c7b, 23, 0.08, 6, -23, 0.55, 12)
    const apron: Part[] = []
    for (let i = 0; i < 18; i++) for (const side of [-1, 1]) apron.push({ x: -33 + i * 1.2, y: 0.61, z: 12 + side * 2.7, sx: 0.08, sy: 0.04, sz: 0.08 })
    const apronLights = instances(world, G.sph, mat(0x8ab9ed, { basic: true }), apron)
    apronLights.castShadow = false
    animations.push(() => { apronLights.visible = lightPreset.warmP >= 0.1 })
    box(0xced5d4, 4.5, 0.18, 2, -12, 1.45, 15)
    for (const x of [-13.8, -10.2]) box(0x8796a0, 0.1, 1, 0.1, x, 0.95, 15)
    // Glazed terminal hall, ribbed roof, jet bridges and service equipment.
    box(0x668292, 14.5, 2.5, 4.6, -24, 1.8, 29)
    box(0xbcc9cd, 15, 0.22, 5.1, -24, 3.17, 29)
    const terminalFrames: Part[] = [], terminalGlass: Part[] = [], roofRibs: Part[] = [], service: Part[] = []
    for (let i = 0; i < 22; i++) {
      const x = -30.7 + i * 0.64
      for (const side of [-1, 1]) {
        terminalFrames.push({ x, y: 1.8, z: 29 + side * 2.33, sx: 0.07, sy: 2.45, sz: 0.08 })
        terminalGlass.push({ x: x + 0.28, y: 1.83, z: 29 + side * 2.34, sx: 0.45, sy: 1.8, sz: 0.025 })
      }
      roofRibs.push({ x, y: 3.34, z: 29, sx: 0.09, sy: 0.14, sz: 5.15 })
    }
    for (let i = 0; i < 5; i++) {
      const x = -29.5 + i * 2.7
      box(0xacb9c1, 0.65, 0.7, 2.5, x, 1.5, 25.6)
      box(0x647b8c, 0.68, 0.18, 2.6, x, 1.94, 25.6)
      service.push({ x, y: 3.58, z: 29, sx: 1.1, sy: 0.48, sz: 1.3 })
      service.push({ x: x + 0.9, y: 0.77, z: 21, sx: 0.65, sy: 0.45, sz: 0.32 })
    }
    instances(world, G.box, mat(0xc7cfd0), terminalFrames)
    instances(world, G.box, mat(0xd5dddd), roofRibs)
    instances(world, G.box, mat(0x9cabb4), service)
    const terminalWindows = instances(world, G.box, mat(0xe9cc97, { emissive: 0xe0b478, rough: 0.3 }), terminalGlass)
    terminalWindows.castShadow = false
    // Port warehouses, cylindrical tanks and cranes along the western channel.
    for (let i = 0; i < 4; i++) {
      const x = -32 + i * 5.6
      box(0x7d8e9c, 4.1, 1.4, 2.5, x, 1.2, -7.5)
      box(0xc1c7c7, 4.3, 0.15, 2.7, x, 1.98, -7.5)
      world.add(M(G.cyl, mat(0x8d9da5), 0.75, 1.2, 0.75, x, 1.05, -11))
      box(0xac735c, 0.12, 3.5, 0.12, x, 2.25, -5.8)
      box(0xac735c, 2.8, 0.12, 0.12, x + 0.8, 3.9, -5.8)
    }
    const walls = [0x8996a1, 0x667583, 0xa2aaad, 0x526375]
    const batches: Part[][] = walls.map(() => [])
    const roofs: Part[] = [], equipment: Part[] = [], mullions: Part[] = [], pitched: Part[] = [], balconies: Part[] = []
    const windows: { part: Part; chance: number; shade: number }[] = []
    const foliage: Part[] = [], trunks: Part[] = []
    const plant = (x: number, z: number) => {
      trunks.push({ x, y: 0.84, z, sx: 0.075, sy: 0.7, sz: 0.075 })
      foliage.push({ x, y: 1.35 + random() * 0.2, z, sx: 0.5 + random() * 0.2, sy: 0.6, sz: 0.55 })
    }
    for (const x of [6.6, 33.3]) for (let z = -31; z <= 31; z += 2.2) {
      if (Math.abs(z - 18) > 2 && Math.abs(z + 18) > 2) plant(x, z)
    }
    // Park reserves frame the tower and break the otherwise dense skyline.
    box(0x425e51, 6.5, 0.06, 8, 13.5, 0.55, -13.5)
    lmTokyoTower(13.5, -13.5); lmSkytree(29, -29)
    for (let i = 0; i < 36; i++) {
      const a = random() * Math.PI * 2, r = 2 + random() * 1.2
      plant(13.5 + Math.cos(a) * r, -13.5 + Math.sin(a) * r)
    }
    for (let x = -32; x <= 32; x += 3) for (let rawZ = -31.5; rawZ <= 31.5; rawZ += 3) {
      const nearest = [-27, -18, -9, 0, 9, 18, 27].reduce((a, b) => Math.abs(rawZ - a) < Math.abs(rawZ - b) ? a : b)
      const z = rawZ + Math.sign(rawZ - nearest) * 0.55
      const east = x > 6, west = x < -9 && z < -13
      if (!east && !west) continue
      if ((east ? [9, 18, 27] : [-29, -20, -11]).some((r) => Math.abs(x - r) < 1.45)) continue
      if ([-27, -18, -9, 0, 9, 18, 27].some((r) => Math.abs(z - r) < 1.45)) continue
      if (Math.hypot(x - 13.5, z + 13.5) < 5.8 || Math.hypot(x - 29, z + 29) < 2.8) continue
      const h = west ? 1.8 + random() * 4 : z < -13 ? 5 + random() * 10 : 1.5 + random() * 4.5
      const w = 1.55 + random() * 0.65, d = 1.6 + random() * 0.55
      batches[Math.floor(random() * 4)].push({ x, y: 0.5 + h / 2, z, sx: w, sy: h, sz: d })
      roofs.push({ x, y: h + 0.56, z, sx: w + 0.13, sy: 0.12, sz: d + 0.13 })
      equipment.push({ x: x + w * 0.16, y: h + 0.78, z, sx: w * 0.32, sy: 0.34, sz: d * 0.38 })
      if (h < 3.5 && random() < 0.5) pitched.push({ x, y: h + 0.58, z: z - d / 2, sx: w + 0.2, sy: 0.7, sz: d + 0.2 })
      if (h < 7) for (let y = 1.2; y < h; y += 0.85) balconies.push({ x, y, z: z + d / 2 + 0.13, sx: w * 0.8, sy: 0.07, sz: 0.3 })
      for (const side of [-1, 1]) {
        mullions.push({ x: x + side * w / 2, y: h / 2 + 0.5, z: z + d / 2 + 0.015, sx: 0.045, sy: h, sz: 0.035 })
        for (let y = 0.95; y < h + 0.15; y += 0.55) for (let c = 0; c < 3; c++) {
          const u = (c - 1) * 0.43
          windows.push({ part: { x: x + u, y, z: z + side * (d / 2 + 0.025), sx: 0.27, sy: 0.28, sz: 0.02 }, chance: random(), shade: random() })
          windows.push({ part: { x: x + side * (w / 2 + 0.025), y, z: z + u, sx: 0.02, sy: 0.28, sz: 0.27 }, chance: random(), shade: random() })
        }
      }
      if (random() < 0.55) plant(x + 1.1, z + 1.1)
    }
    batches.forEach((parts, i) => instances(world, G.box, mat(walls[i], { rough: 0.58, metal: 0.12 }), parts))
    instances(world, G.box, mat(0x485969), roofs)
    instances(world, G.box, mat(0x9ca7ac), equipment)
    instances(world, G.wedge, mat(0x657482), pitched)
    instances(world, G.box, mat(0xa5b2ba), balconies)
    instances(world, G.box, mat(0xb1bbc1), mullions)
    instances(world, G.cyl, mat(0x786e5e), trunks)
    const leafMat = mat(0x446954, { rough: 0.95 }); leafMat.userData.leaf = 0x446954
    instances(world, G.sph, leafMat, foliage)
    const windowMeshes: THREE.InstancedMesh[] = []
    refreshWindows = () => {
      windowMeshes.forEach((m) => { world.remove(m); m.dispose() }); windowMeshes.length = 0
      const parts: Part[][] = [[], [], [], []]
      windows.forEach(({ part, chance, shade }) => parts[lightPreset.warmP < 0.1 || chance > lightPreset.warmP ? 0 : 1 + Math.floor(shade * 3)].push(part))
      ;[0x3b5369, 0xe7be80, 0xd7a563, 0xa3bdd0].forEach((color, i) => {
        const mesh = instances(world, G.box, mat(color, { basic: i > 0, rough: 0.3 }), parts[i])
        mesh.castShadow = false; windowMeshes.push(mesh)
      })
    }
    refreshWindows()
    waterDetails(-1.5, 0, 3.3, 32, 0.11)
    waterDetails(-23, 0, 10, 3.7, 0.11)
    const reflectionParts: Part[] = []
    for (let i = 0; i < 70; i++) reflectionParts.push({ x: -5.5 + random() * 10, y: 0.105, z: -32 + random() * 64, sx: 0.06 + random() * 0.13, sy: 0.007, sz: 0.2 + random() * 0.55 })
    const reflections = instances(world, G.box, mat(0xd0b38c, { basic: true, opacity: 0.22 }), reflectionParts)
    reflections.castShadow = false
    animations.push((t) => { reflections.visible = lightPreset.warmP > 0.1; reflections.position.x = Math.sin(t * 0.25) * 0.08 })
    boatFleet(-1, -1, 1.8, 11, 0.24, 2)
    const plaque = M(G.plane, mat(0xc5c8bf, { basic: true, map: inscriptionTexture }), 12, 1, 1, 21, -0.85, 36.79)
    world.add(plaque)
    spots = [new THREE.Vector3(-20, 0.65, 23), new THREE.Vector3(-11, 0.65, 18), new THREE.Vector3(27, 0.65, -22)]
    const route = [[-20, 23], [-20, 18], [-11, 18], [9, 18], [9, -9], [18, -9], [18, -18], [27, -18], [27, -22]].map(([x, z]) => new THREE.Vector3(x, 0, z))
    addPath(spots, 0xe97c69, route)
    for (let i = 0; i < 5; i++) {
      const taxi = new THREE.Group(); taxi.name = 'city-taxi'
      taxi.add(M(G.box, mat(0xe3ba4d), 0.8, 0.24, 0.4, 0, 0.15, 0))
      taxi.add(M(G.box, mat(0x374657), 0.4, 0.18, 0.34, 0, 0.34, 0))
      taxi.add(M(G.box, mat(0xffe1a6, { emissive: 0xf0c06f }), 0.14, 0.07, 0.12, 0, 0.47, 0))
      taxi.traverse((o) => { o.castShadow = false }); world.add(taxi)
      animations.push((t) => { taxi.position.set(-31 + ((t * 1.4 + i * 3.5) % 19), 0.64, 17.5) })
    }
    atmosphere(THEMES.night)
  }

  function buildAsakusa() {
    const th = THEMES.asakusa, buf: Win = []
    plate(th, 29)
    world.add(M(G.box, mat(0x699ca9, { rough: 0.35, metal: 0.25 }), 7.8, 0.12, 72, 32.8, 0.09, 0))
    waterDetails(32.5, 0, 2.5, 32, 0.17)
    world.add(M(G.box, mat(0xa4b4b6), 0.3, 0.25, 71, 29, 0.22, 0))
    const clears = [{ x: -6, z: -2, r: 16 }, { x: -23, z: -23, r: 9.8 }, { x: 17, z: -23, r: 8 }, { x: 21, z: -4, r: 3.5 }]
    // A quiet stone precinct gives the five-storey pagoda room to read clearly.
    world.add(M(G.box, mat(0xc8c2b3), 23, 0.12, 27, -6, 0.22, -2))
    world.add(M(G.box, mat(0xe2dbca), 3.2, 0.035, 25, -8, 0.3, -2))
    lmPagoda(-12, -6, 1.65)
    lmGate(-8, 10, 1.4)
    world.add(M(G.box, mat(0x954b3c), 7, 2.9, 4.8, -1, 1.7, -9))
    world.add(M(G.templeRoof, mat(0x606d76), 9.5, 3.2, 6.5, -1, 3.25, -9))
    world.add(M(G.box, mat(0xe0d5bd), 8, 0.3, 5.8, -1, 0.4, -9))
    const columns: Part[] = [], lanterns: Part[] = [], stones: Part[] = []
    for (let x = -4; x <= 2; x += 1) columns.push({ x, y: 1.85, z: -6.55, sx: 0.14, sy: 3, sz: 0.14 })
    for (let z = -13; z <= 9; z += 1.1) for (let x = -9; x <= -7; x += 0.7) stones.push({ x, y: 0.328, z, sx: 0.62, sy: 0.012, sz: 0.92 })
    instances(world, G.box, mat(0xb26048), columns)
    instances(world, G.box, mat(0xb8b3a9), stones).castShadow = false
    const lattice: Part[] = [], lanternBases: Part[] = [], lanternTops: Part[] = []
    for (let x = -3.7; x < 2; x += 0.24) lattice.push({ x, y: 1.65, z: -6.53, sx: 0.045, sy: 1.65, sz: 0.05 })
    instances(world, G.box, mat(0x574333), lattice)
    for (let step = 0; step < 4; step++) world.add(M(G.box, mat(0xc9c5b8), 5.6, 0.1, 0.45, -1, 0.28 + step * 0.07, -5.2 - step * 0.38))
    for (const x of [-10.4, -5.6]) for (let z = -1; z <= 8; z += 3) {
      lanternBases.push({ x, y: 0.75, z, sx: 0.2, sy: 0.85, sz: 0.2 })
      lanternTops.push({ x, y: 1.24, z, sx: 0.45, sy: 0.25, sz: 0.45 })
    }
    instances(world, G.box, mat(0x989e95), lanternBases)
    instances(world, G.box, mat(0xb8b9a5, { emissive: 0x8a7043 }), lanternTops)
    for (const x of [-13.7, -2.7]) for (let z = 0; z < 8; z += 2.2) {
      machiya(x, z, th, buf)
      lanterns.push({ x: x + 0.8, y: 1.15, z: z + 1, sx: 0.16, sy: 0.24, sz: 0.16 })
    }
    instances(world, G.cyl, mat(0xd87957, { emissive: 0x8a482a }), lanterns)
    addLmLabel(-8, 4, 2.6, '나카미세 상점가', '仲見世商店街')
    // Ueno's tree canopy and pond form a second, much softer silhouette.
    world.add(M(G.circle, mat(0x739272), 9.3, 9.3, 1, -23, 0.23, -23))
    world.children[world.children.length - 1].rotation.x = -Math.PI / 2
    const pond = M(G.circle, mat(0x7ca9ac, { rough: 0.3 }), 4, 2.7, 1, -22, 0.27, -22)
    pond.rotation.x = -Math.PI / 2; world.add(pond)
    waterDetails(-22, -22, 3.5, 2.2, 0.285)
    const trees: Part[] = [], trunks: Part[] = []
    for (let i = 0; i < 72; i++) {
      const a = i * 2.39996, r = 4.7 + (i % 9) * 0.4
      const x = -23 + Math.cos(a) * r, z = -23 + Math.sin(a) * r
      trees.push({ x, y: 1.4 + i % 3 * 0.2, z, sx: 0.7, sy: 0.8, sz: 0.7 })
      trunks.push({ x, y: 0.8, z, sx: 0.085, sy: 1, sz: 0.085 })
    }
    instances(world, G.cyl, mat(0x826e55), trunks)
    instances(world, G.sph, mat(0x679360), trees)
    addLmLabel(-23, -23, 3.5, '우에노 공원', '上野公園')
    // Akihabara is denser and taller, with stacked colour panels, never baked-in text.
    const tech = { ...th, tall: 1.6, walls: [0xc5cdd3, 0xb8c3cb, 0xd5d9d8], roofs: [0x687a8d] }
    for (let x = 11; x <= 23; x += 4) for (let z = -29; z <= -19; z += 4) {
      mid(x, z, tech, buf)
      for (let y = 0.8; y <= 4.8; y += 1.1) world.add(M(G.box, mat([0xc9674f, 0x4d819d, 0xd1aa52][Math.floor(y) % 3]), 0.6, 0.75, 0.06, x + 0.7, y, z + 1.1))
    }
    addLmLabel(17, -24, 7.5, '아키하바라', '秋葉原')
    lmSkytree(21, -4)
    spots = [[24, 24], [-8, 8], [-23, 15], [-19, 3], [-23, -18], [-5, -23], [17, -18], [24, 6], [24, 24]].map(([x, z]) => new THREE.Vector3(x, 0.28, z))
    clears.push(...spots.map((p) => ({ x: p.x, z: p.z, r: 2 })))
    pathClears(spots, clears)
    const cityStart = world.children.length
    city(th, clears, 29, buf)
    batchScenery(world.children.slice(cityStart))
    addPath(spots, th.accent)
    addLife(29)
    for (let i = 0; i < 10; i++) {
      const visitor = new THREE.Group()
      visitor.add(M(G.cyl, mat(i % 2 ? 0x667f8e : 0xbb785e), 0.08, 0.3, 0.08, 0, 0.16, 0))
      visitor.add(M(G.sph, mat(0xe1c7ad), 0.09, 0.09, 0.09, 0, 0.38, 0))
      visitor.traverse((o) => { o.castShadow = false }); world.add(visitor)
      animations.push((t) => { visitor.position.set(-8 + (i % 3 - 1) * 0.55, 0.33, -7 + ((t * 0.3 + i * 1.5) % 14)) })
    }
    atmosphere(th)
  }

  // Authored districts reserve generous negative space around each day's hero.
  function grove(x: number, z: number, rx: number, rz: number, count: number) {
    const crowns: Part[] = [], trunks: Part[] = []
    for (let i = 0; i < count; i++) {
      const a = i * 2.39996, r = Math.sqrt((i + 0.5) / count)
      const px = x + Math.cos(a) * r * rx, pz = z + Math.sin(a) * r * rz
      const h = 1.1 + (i % 5) * 0.23
      trunks.push({ x: px, y: h * 0.45, z: pz, sx: 0.09, sy: h * 0.8, sz: 0.09 })
      crowns.push({ x: px, y: h, z: pz, sx: 0.65, sy: h * 0.55, sz: 0.65 })
    }
    instances(world, G.cyl, mat(0x716451), trunks)
    instances(world, G.sph, mat(0x56765c), crowns)
  }

  function pavilion(x: number, z: number, w: number, d: number, h: number, buf: Win) {
    world.add(M(G.box, mat(0xaebbc3), w, h, d, x, h / 2 + 0.2, z))
    world.add(M(G.box, mat(0x657c8c), w + 0.4, 0.2, d + 0.4, x, h + 0.3, z))
    wins(buf, x, z, w, d, h, Math.max(2, Math.floor(h)), Math.max(3, Math.floor(w)), 0xc5ddeb)
    const ribs: Part[] = []
    for (let u = -w / 2; u <= w / 2; u += 0.85) ribs.push({ x: x + u, y: h / 2 + 0.2, z: z + d / 2 + 0.05, sx: 0.07, sy: h, sz: 0.12 })
    instances(world, G.box, mat(0xe2e4dc), ribs)
    for (const side of [-1, 1]) world.add(M(G.box, mat(0xd1b18d), w, 0.12, 0.8, x, 0.7, z + side * (d / 2 + 0.3)))
  }

  function buildOdaiba() {
    const th = THEMES.odaiba, buf: Win = []
    plate(th, 8)
    world.add(M(G.box, mat(0x457d91, { rough: 0.2, metal: 0.45, env: true }), 28.6, 0.16, 72, 22.3, 0.12, 0))
    world.add(M(G.box, mat(0xc1c6b8), 2.5, 0.12, 70, 6.8, 0.2, 0))
    world.add(M(G.box, mat(0x849fa5), 0.25, 0.4, 71, 8, 0.3, 0))
    lmBridge(4, 34, -7); bayTrain(); harbor(8)
    lmWheel(-1, 10); lmFujiTV(-14, -8); lmLiberty(3, 24)
    pavilion(-11, 15, 9, 6, 3.2, buf)
    pavilion(-12, 25, 10, 5, 2.5, buf)
    pavilion(-19, -22, 8, 6, 2.4, buf)
    addLmLabel(-19, -22, 4.2, '팀랩 플래닛', 'teamLab Planets')
    addLmLabel(-11, 15, 5, '아쿠아시티', 'AQUA CITY')
    grove(2, -20, 3, 8, 28); grove(-2, 26, 3, 4, 18)
    const lamps: Part[] = [], posts: Part[] = []
    for (let z = -32; z <= 32; z += 3) {
      posts.push({ x: 7, y: 1.05, z, sx: 0.065, sy: 1.8, sz: 0.065 })
      lamps.push({ x: 7, y: 2, z, sx: 0.2, sy: 0.15, sz: 0.2 })
    }
    instances(world, G.box, mat(0x6b7f89), posts)
    instances(world, G.sph, mat(0xffdda9, { emissive: 0xffbd72 }), lamps)
    spots = [[-30, 24], [-19, -18], [-11, 19], [-12, 29], [5, 24], [-24, 6], [-30, 24]].map(([x, z]) => new THREE.Vector3(x, 0.28, z))
    const clears = [{ x: -1, z: 10, r: 9 }, { x: -12, z: 21, r: 12 }, { x: -14, z: -8, r: 9 }, { x: -19, z: -22, r: 7 }, { x: 3, z: 24, r: 6 }, { x: 2, z: -20, r: 9 }, ...spots.map(p => ({ x: p.x, z: p.z, r: 2 }))]
    pathClears(spots, clears)
    const start = world.children.length
    city(th, clears, 5, buf); batchScenery(world.children.slice(start))
    addPath(spots, th.accent); addLife(8); atmosphere(th)
  }

  function buildRoppongi() {
    const th = { ...THEMES.roppongi, plate: 0x78878b, road: 0x566570, walls: [0x8295a4, 0xa2adb4, 0x6a8192, 0xc1c3be], roofs: [0x485e70, 0x63747f] }, buf: Win = []
    plate(th, null)
    world.add(M(G.box, mat(0x406676, { rough: 0.18, metal: 0.5 }), 23, 0.14, 24, -17, 0.22, -13))
    world.add(M(G.box, mat(0x60775e), 19, 0.23, 20, -17, 0.35, -13))
    grove(-18, -16, 8, 7, 85)
    lmMoat(-6, -13)
    world.add(M(G.box, mat(0xd6d1be), 5.4, 1.9, 3.5, -17, 1.4, -10))
    world.add(M(G.templeRoof, mat(0x44595b), 7, 2.3, 5, -17, 2.4, -10))
    addLmLabel(-17, -10, 5.8, '황거', 'Imperial Palace')
    lmMori(10, -9); lmTokyoTower(12, 13)
    world.add(M(G.box, mat(0x728572), 12, 0.15, 12, 12, 0.2, 13))
    grove(8, 16, 3, 2, 16); grove(16, 10, 2, 3, 18)
    pavilion(18, -9, 5, 7, 2, buf)
    pavilion(-19, 15, 8, 5, 2.3, buf)
    addLmLabel(-19, 15, 4.5, '가조엔 도쿄', 'Hotel Gajoen Tokyo')
    // Slender satellite towers frame Mori without competing with the orange lattice tower.
    for (const [x, z, h] of [[22, -21, 8], [15, -23, 10], [27, -12, 7], [25, 0, 8]]) pavilion(x, z, 3.3, 3.5, h, buf)
    spots = [[24, 24], [-6, -2], [-19, 19], [0, 12], [10, -4], [19, 6], [10, -4], [24, 24]].map(([x, z]) => new THREE.Vector3(x, 0.28, z))
    const clears = [{ x: -17, z: -13, r: 16 }, { x: 12, z: 13, r: 9 }, { x: 14, z: -10, r: 10 }, { x: 21, z: -20, r: 10 }, { x: 25, z: 0, r: 5 }, { x: -19, z: 15, r: 7 }, ...spots.map(p => ({ x: p.x, z: p.z, r: 2 }))]
    pathClears(spots, clears)
    const start = world.children.length
    city(th, clears, null, buf); batchScenery(world.children.slice(start))
    addPath(spots, th.accent); addLife(null); atmosphere(th)
  }

  function buildKawaguchiko(departure: boolean) {
    const th = { ...THEMES.fuji, empty: 0.78, plate: 0x9ba88b, road: 0x879486 }, buf: Win = []
    plate(th, null)
    lmFuji(-13, -15, 1.95)
    // Broad lake and a continuous bank separate the village from Fuji's foothills.
    for (const [rx, rz, y, color] of [[13, 8, 0.19, 0x748b74], [12.3, 7.3, 0.24, 0x5c8f9e]]) {
      const disc = M(G.circle, mat(color, { rough: 0.22, metal: 0.25 }), rx, rz, 1, -14, y, 10)
      disc.rotation.x = -Math.PI / 2; world.add(disc)
    }
    waterDetails(-14, 10, 11.2, 6.3, 0.27); boatFleet(-14, 10, 8, 3.8, 0.4, 2)
    addLmLabel(-14, 10, 1.7, '카와구치호', 'Lake Kawaguchi')
    grove(-25, -7, 3, 7, 35); grove(-1, -16, 3, 8, 38)
    grove(-24, 22, 4, 2, 22); grove(-2, 21, 3, 3, 20)
    lmRyokan(-19, 25); lmLawson(10, 7); lmTorii(-25, 3); lmRope(7, -9)
    const shorePath: Part[] = []
    for (let i = 0; i < 66; i++) {
      const a = i / 66 * Math.PI * 2
      shorePath.push({ x: -14 + Math.cos(a) * 13.4, y: 0.18, z: 10 + Math.sin(a) * 8.4, sx: 0.8, sy: 0.06, sz: 0.5, ry: -a })
    }
    instances(world, G.box, mat(0xbab49a), shorePath).castShadow = false
    world.add(M(G.box, mat(0x8b7760), 5, 0.15, 0.9, -7, 0.33, 13))
    for (let x = -9; x <= -5; x += 1) world.add(M(G.box, mat(0x6b685b), 0.12, 0.5, 0.12, x, 0.25, 13))
    const coordinates = departure
      ? [[-19, 28], [-25, 3], [10, 9], [12, 24], [24, 6], [24, 0], [24, -20]]
      : [[24, 26], [12, 24], [10, 9], [4, 18], [7, -6], [-19, 28]]
    spots = coordinates.map(([x, z]) => new THREE.Vector3(x, 0.28, z))
    const route = (departure
      ? [[-19, 28], [-29, 28], [-29, 3], [-25, 3], [-29, 3], [-29, 28], [12, 28], [12, 9], [10, 9], [12, 9], [12, 24], [24, 24], [24, 6], [24, 0], [24, -20]]
      : [[24, 26], [12, 26], [12, 24], [12, 9], [10, 9], [12, 9], [12, 18], [4, 18], [12, 18], [12, -6], [7, -6], [12, -6], [12, 28], [-19, 28]])
      .map(([x, z]) => new THREE.Vector3(x, 0.28, z))
    // Local access lanes are authored with the itinerary, not a city-wide grid.
    for (let i = 1; i < route.length; i++) {
      const a = route[i - 1], b = route[i]
      world.add(M(G.box, mat(th.road), Math.abs(a.x - b.x) + 1, 0.035, Math.abs(a.z - b.z) + 1, (a.x + b.x) / 2, 0.15, (a.z + b.z) / 2))
    }
    const clears = [{ x: -13, z: -15, r: 15 }, { x: -14, z: 10, r: 14 }, { x: -19, z: 25, r: 6 }, { x: 7, z: -9, r: 6 }, { x: 10, z: 7, r: 4 }, ...spots.map(p => ({ x: p.x, z: p.z, r: 2 }))]
    for (let i = 1; i < route.length; i++) {
      const a = route[i - 1], b = route[i], n = Math.ceil(a.distanceTo(b) / 2)
      for (let j = 0; j <= n; j++) { const p = a.clone().lerp(b, j / Math.max(n, 1)); clears.push({ x: p.x, z: p.z, r: 0.2 }) }
    }
    if (departure) {
      clears.push({ x: 24, z: -24, r: 10 }, { x: 24, z: 0, r: 9 })
      lmAirport(24, -25); lmGovernment(21, -2)
      pavilion(28, 5, 3, 4, 5, buf); pavilion(18, 4, 3, 3, 3.6, buf)
      addLmLabel(24, 6, 7, '신주쿠 · 귀국길', 'Shinjuku → Haneda')
    } else {
      for (const [x, z] of [[19, 18], [23, 16], [19, 23], [4, 21]]) machiya(x, z, th, buf)
      addLmLabel(4, 18, 2.8, '호토 마을', 'Hōtō Village')
    }
    const start = world.children.length
    city(th, clears, null, buf); batchScenery(world.children.slice(start))
    addPath(spots, th.accent, route); addLife(null); atmosphere(th)
  }

  function buildDay(di: number) {
    currentDay = di
    setAutoRotate(false)
    clear()
    const day = DAYS[di]
    const th = THEMES[day.theme as string] ?? THEMES.night
    const lightName = (alternateLight ? OPPOSITE[day.light as string] : day.light as string) ?? 'night'
    const lp = LIGHT_PRESETS[lightName] ?? LIGHT_PRESETS.night
    lightPreset = lp
    host.dataset.light = lightName
    applyLight(lp)
    if (di >= 0 && di <= 5) {
      if (di === 0) buildHaneda()
      else if (di === 1) buildAsakusa()
      else if (di === 2) buildOdaiba()
      else if (di === 3) buildRoppongi()
      else buildKawaguchiko(di === 5)
      world.traverse((o) => {
        if (o instanceof THREE.Mesh && o.material instanceof THREE.MeshStandardMaterial) o.material.emissiveIntensity = lp.warmP < 0.1 ? 0 : 0.4
      })
      animations.forEach((animate) => animate(0, 0))
      people.forEach(({ g }) => g.traverse((o) => { o.castShadow = false }))
      cars.forEach(({ g }) => g.traverse((o) => { o.castShadow = false }))
      renderer.shadowMap.needsUpdate = true
      day.stops.forEach((s: { name: string; eat?: number }, i: number) => addSpot(i, spots[i], s, 0xe97c69))
      focusT.set(0, 0.45, 0); focus.copy(focusT); flying = false
      zoomT = fitZoom(); select(0)
      return
    }

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
    if (di === 5) {
      clears.push({ x: 24, z: -24, r: 7 })
      lmAirport(24, -24)
    }
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
      bayTrain()
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
    addLife(seaX)
    atmosphere(th)
    world.traverse((o) => {
      if (o instanceof THREE.Mesh && o.material instanceof THREE.MeshStandardMaterial) {
        o.material.emissiveIntensity = lp.warmP < 0.1 ? 0 : 0.4
        if (typeof o.material.userData.leaf === 'number') o.material.color.setHex(o.material.userData.leaf).offsetHSL(0, lp.warmP < 0.1 ? 0.06 : 0, 0)
      }
    })
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
    selectionTime = animationTime
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
  let statsAt = 0, statsFrames = 0
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
    if (lightingTween) {
      const tween = lightingTween
      tween.elapsed = Math.min(0.3, tween.elapsed + dt)
      const p = 1 - Math.pow(1 - tween.elapsed / 0.3, 3)
      const mix = (a: number, b: number) => THREE.MathUtils.lerp(a, b, p)
      const color = (a: number | string, b: number | string) => lightColor.set(a).lerp(new THREE.Color(b), p)
      applyLight({
        sky: [`#${color(tween.from.sky[0], tween.to.sky[0]).getHexString()}`, `#${color(tween.from.sky[1], tween.to.sky[1]).getHexString()}`],
        fog: color(tween.from.fog, tween.to.fog).getHex(), keyColor: color(tween.from.keyColor, tween.to.keyColor).getHex(),
        hemi: mix(tween.from.hemi, tween.to.hemi), key: mix(tween.from.key, tween.to.key),
        fill: mix(tween.from.fill, tween.to.fill), rimL: mix(tween.from.rimL, tween.to.rimL), warmP: tween.to.warmP,
      })
      if (tween.elapsed >= 0.3) lightingTween = null
    }
    if (!paused) {
      people.forEach((w) => {
        w.t = (w.t + w.spd * dt * 10 + 1) % 1
        const s = -HALF + 2 + w.t * (w.axis === 'x' ? trafficRight + HALF - 2 : roadSpan), bob = Math.abs(Math.sin(t * 9 + w.off * 10)) * 0.04
        if (w.axis === 'x') w.g.position.set(s, bob, w.c + w.off)
        else w.g.position.set(w.c + w.off, bob, s)
      })
      cars.forEach((c) => {
        const span = c.axis === 'x' ? trafficRight + HALF - 2 : roadSpan
        c.t = (c.t + (c.spd * c.dir * dt) / span + 1) % 1
        const s = -HALF + 2 + c.t * span
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
    const showDetails = zoom > fitZoom() * 1.25
    landmarkLabels.forEach(({ el, primary }) => { el.style.opacity = primary || showDetails ? '1' : '0' })
    if (import.meta.env.DEV) {
      statsFrames++
      if (elapsed - statsAt >= 1) {
        const vehicles: { kind: string; position: number[] }[] = []
        world.traverse((o) => {
          if (['city-taxi', 'highway-bus', 'cruising-boat', 'departing-aircraft', 'yurikamome-train'].includes(o.name)) vehicles.push({ kind: o.name, position: o.position.toArray().map((v) => +v.toFixed(3)) })
        })
        host.dataset.sceneStats = JSON.stringify({ day: currentDay + 1, paused, time: +t.toFixed(3), fps: Math.round(statsFrames / (elapsed - statsAt)), calls: renderer.info.render.calls, geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures, animations: animations.length, vehicles })
        statsAt = elapsed; statsFrames = 0
      }
    }
    raf = requestAnimationFrame(tick)
  }

  let mode: 'none' | 'pan' | 'orbit' = 'none'
  const pointers: Map<number, { x: number; y: number }> = new Map()
  const { on, dispose: disposeEvents } = eventScope()
  on(host, 'contextmenu', ((e: Event) => e.preventDefault()) as EventListener)
  on(host, 'pointerdown', ((e: PointerEvent) => {
    if (e.button !== 0 && e.button !== 1 && e.button !== 2) return
    setAutoRotate(false)
    if (pointers.size >= 2) return
    mode = e.shiftKey && e.button === 0 ? 'pan' : 'orbit'
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
    mode = pointers.size ? 'orbit' : 'none'
  }) as EventListener
  on(host, 'pointerup', releasePointer)
  on(host, 'pointercancel', releasePointer)
  on(host, 'lostpointercapture', releasePointer)
  on(host, 'wheel', ((e: WheelEvent) => {
    setAutoRotate(false)
    e.preventDefault()
    const unit = e.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : e.deltaMode === WheelEvent.DOM_DELTA_PAGE ? host.clientHeight : 1
    const dx = e.deltaX * unit, dy = e.deltaY * unit
    // Trackpad horizontal swipes (or Shift + mouse wheel) orbit, never pan.
    // Choose the dominant axis to avoid accidental zoom during a diagonal swipe.
    if (!e.ctrlKey && (Math.abs(dx) > Math.abs(dy) || e.shiftKey)) {
      const horizontal = e.shiftKey && Math.abs(dy) > Math.abs(dx) ? dy : dx
      az -= Math.max(-160, Math.min(160, horizontal)) * 0.005
    } else {
      zoomT = Math.max(2, Math.min(48, zoomT * Math.exp(-Math.max(-300, Math.min(300, dy)) * 0.0011)))
    }
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
    setAlternateLight,
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

