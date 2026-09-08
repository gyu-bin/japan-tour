/** 시간대 조명 — initLights() 는 initCore() 이후에 호출 */
import * as THREE from 'three'
import { scene, renderer, sceneEl } from './core.js'

const LIGHT = {
  morning: {
    sky: ['#cfe0e8', '#f7f2e6'], fog: 0xf5efe3, water: 0xa9c6d4,
    hemi: [0xfdf6e8, 0xdfe0cc, 1.45], sun: [0xfff6e6, 0.45, 150, 52], glow: 0, expo: 1.0, shadow: 0.16
  },
  dawn: {
    sky: ['#b9c3dd', '#f9e2cf'], fog: 0xf6e2d0, water: 0xc3b6c9,
    hemi: [0xf6ecf2, 0xe3cfba, 1.3], sun: [0xffdcbb, 0.5, 95, 20], glow: 0.2, expo: 1.02, shadow: 0.2
  },
  sunset: {
    sky: ['#a9bcd4', '#f7d3ac'], fog: 0xf3d5b4, water: 0xc4b4b6,
    hemi: [0xfdeadb, 0xe6c8a4, 1.25], sun: [0xffc79a, 0.55, 250, 18], glow: 0.3, expo: 1.02, shadow: 0.22
  },
  evening: {
    sky: ['#7080a4', '#d3b6a4'], fog: 0xc4ac9c, water: 0x8e93ab,
    hemi: [0xcfc4d8, 0xa8927f, 0.85], sun: [0xffcda3, 0.38, 268, 12], glow: 0.45, expo: 1.02, shadow: 0.2
  },
  night: {
    sky: ['#242e47', '#4b5471'], fog: 0x454e69, water: 0x39415c,
    hemi: [0x5f6d94, 0x2f344a, 0.62], sun: [0x9fb0d4, 0.22, 210, 58], glow: 0.9, expo: 1.0, shadow: 0.14
  },
  midnight: {
    sky: ['#1a2338', '#3b4460'], fog: 0x363e58, water: 0x2b3350,
    hemi: [0x505d84, 0x282d40, 0.55], sun: [0x93a3c9, 0.2, 190, 62], glow: 1.0, expo: 1.0, shadow: 0.12
  }
}

export let hemiLight = null
export let sun = null
export let glowLevel = 0
export let shadowLevel = 0.2
const glowMats = []
let shadowMesh = null
let seaMesh = null

export function initLights() {
  if (!scene) throw new Error('initCore() first')
  if (hemiLight) return

  hemiLight = new THREE.HemisphereLight(0xeaf4ff, 0xd8cbb0, 0.95)
  scene.add(hemiLight)
  sun = new THREE.DirectionalLight(0xfff2dc, 1.5)
  sun.position.set(-34, 48, 22)
  sun.castShadow = true
  sun.shadow.mapSize.set(2048, 2048)
  sun.shadow.camera.left = -70
  sun.shadow.camera.right = 70
  sun.shadow.camera.top = 70
  sun.shadow.camera.bottom = -70
  sun.shadow.camera.far = 200
  sun.shadow.bias = -0.0004
  scene.add(sun)
}

export function applyLight(name) {
  const L = LIGHT[name] || LIGHT.morning
  sceneEl.style.background = `linear-gradient(180deg, ${L.sky[0]} 0%, ${L.sky[1]} 68%)`
  document.body.style.background = L.sky[1]
  scene.fog.color.setHex(L.fog)
  hemiLight.color.setHex(L.hemi[0])
  hemiLight.groundColor.setHex(L.hemi[1])
  hemiLight.intensity = L.hemi[2]
  sun.color.setHex(L.sun[0])
  sun.intensity = L.sun[1]
  const az = (L.sun[2] * Math.PI) / 180
  const el = (L.sun[3] * Math.PI) / 180
  const d = 70
  sun.position.set(
    Math.cos(az) * Math.cos(el) * d,
    Math.sin(el) * d,
    Math.sin(az) * Math.cos(el) * d,
  )
  renderer.toneMappingExposure = L.expo
  glowLevel = L.glow
  shadowLevel = L.shadow ?? 0.2
  glowMats.forEach((m) => {
    m.emissiveIntensity = 0.42 * glowLevel
  })
  if (shadowMesh) shadowMesh.material.opacity = shadowLevel
  if (seaMesh) seaMesh.material.color.setHex(L.water ?? 0xa9c6d4)
  document.body.classList.toggle('night', L.glow >= 0.5)
}

export function registerGlowMat(m) {
  glowMats.push(m)
}
export function setShadowMesh(m) {
  shadowMesh = m
}
export function setSeaMesh(m) {
  seaMesh = m
}
export function resetLightTargets() {
  glowMats.length = 0
  shadowMesh = null
  seaMesh = null
}

export function disposeLights() {
  hemiLight = null
  sun = null
  glowMats.length = 0
  shadowMesh = null
  seaMesh = null
  glowLevel = 0
  shadowLevel = 0.2
}

export { LIGHT, glowMats }
