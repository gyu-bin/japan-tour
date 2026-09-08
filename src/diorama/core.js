/** 씬의 기본값과 공유 헬퍼 — React 마운트 시 initCore() 로 초기화 */
import * as THREE from 'three'
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js'

export let sceneEl = null
export let scene = null
export let renderer = null
export let labelRenderer = null
export let camera = null
export let world = null
export let viewSize = 36

export const AR = () =>
  Math.max(innerWidth || 0, 320) / Math.max(innerHeight || 0, 320)

export const WALLS = [0xf8f4ea, 0xf2ece0, 0xeae3d4, 0xf5efe4, 0xede6d8]
export const ROOFS = [0xe8734a, 0xd9633f, 0xc9a24b, 0xe08a5c, 0xb8563a]
export const GREENS = [0x9db98a, 0x8aa87a, 0xaec49b, 0x7d9a70]

export const G = {
  box: new THREE.BoxGeometry(1, 1, 1),
  cyl: new THREE.CylinderGeometry(1, 1, 1, 10),
  cone4: new THREE.ConeGeometry(1, 1, 4),
  cone: new THREE.ConeGeometry(1, 1, 14),
  sph: new THREE.SphereGeometry(1, 12, 10),
  ico: new THREE.IcosahedronGeometry(1, 0),
  torus: new THREE.TorusGeometry(1, 0.09, 8, 40),
}

export const SHADOW_TEX = (() => {
  const s = 64
  const cv = document.createElement('canvas')
  cv.width = cv.height = s
  const ctx = cv.getContext('2d')
  const grd = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2)
  grd.addColorStop(0, 'rgba(0,0,0,0.42)')
  grd.addColorStop(0.55, 'rgba(0,0,0,0.20)')
  grd.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = grd
  ctx.fillRect(0, 0, s, s)
  const t = new THREE.CanvasTexture(cv)
  t.colorSpace = THREE.SRGBColorSpace
  return t
})()

export const shadowSpots = []

export const rnd = (a, b) => a + Math.random() * (b - a)
export const pick = (a) => a[(Math.random() * a.length) | 0]
export const mat = (c, opts = {}) =>
  new THREE.MeshStandardMaterial({ color: c, roughness: 0.95, metalness: 0, ...opts })

export function mesh(geo, m, sx, sy, sz, x, y, z, cast = true) {
  const o = new THREE.Mesh(geo, m)
  o.scale.set(sx, sy, sz)
  o.position.set(x, y, z)
  o.castShadow = cast
  o.receiveShadow = true
  return o
}

export function initCore(sceneElement, labelsElement) {
  if (renderer) disposeCore()

  sceneEl = sceneElement
  scene = new THREE.Scene()
  scene.fog = new THREE.Fog(0xe9e6df, 280, 620)

  renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: true,
    powerPreference: 'high-performance',
  })
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
  renderer.setSize(innerWidth, innerHeight)
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.LinearToneMapping
  sceneEl.appendChild(renderer.domElement)

  labelRenderer = new CSS2DRenderer({ element: labelsElement })
  labelRenderer.setSize(innerWidth, innerHeight)

  viewSize = 36
  camera = new THREE.OrthographicCamera(
    -viewSize * AR(),
    viewSize * AR(),
    viewSize,
    -viewSize,
    -400,
    900,
  )

  world = new THREE.Group()
  scene.add(world)

  return { sceneEl, scene, renderer, labelRenderer, camera, world }
}

export function disposeCore() {
  if (renderer) {
    renderer.dispose()
    renderer.domElement?.remove()
  }
  sceneEl = null
  scene = null
  renderer = null
  labelRenderer = null
  camera = null
  world = null
  shadowSpots.length = 0
}
