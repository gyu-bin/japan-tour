/** 시간대 조명
 *
 *  일차마다 실제 시각이 다르다 — Day 01 은 자정 도착이고 Day 06 은 새벽이다.
 *  하늘·태양·안개·창문불·접지 그림자 농도를 통째로 갈아끼운다.
 *  이미 지어진 씬도 다시 짓지 않고 따라오도록, 발광 머티리얼과 그림자·바다 메시를 여기서 들고 있는다.
 */
import * as THREE from 'three';
import { scene, renderer, sceneEl } from './core.js';

/* ============ 시간대 프리셋 ============
 * 일차마다 실제 시각이 다르다 — Day 01 은 자정 도착이고 Day 06 은 일출이다.
 * 여섯 장이 각자 다른 그림이 되도록 하늘·태양·안개·창문불을 통째로 바꾼다.
 *   sky   : [위, 아래] CSS 하늘 그라데이션
 *   fog   : 지평선에서 사라지는 색 (하늘 아래쪽과 맞춘다)
 *   hemi  : [하늘빛, 땅반사, 세기]
 *   sun   : [색, 세기, 방위각(도), 고도(도)]
 *   glow  : 창문·간판 발광 세기 (밤에만 켠다)
 *   expo  : 톤 노출
 */
/* 그림자를 거의 쓰지 않는다. 명암 대신 톤 차이로 면을 나눈다 — 이게 '렌더'가 아니라
 * '일러스트'로 읽히게 하는 핵심이다. 그래서 hemi 를 높게, sun 을 낮게 잡는다.
 * shadow 는 프리셋별 그림자 농도. */
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
};

const hemiLight = new THREE.HemisphereLight(0xeaf4ff, 0xd8cbb0, 0.95);
scene.add(hemiLight);
const sun = new THREE.DirectionalLight(0xfff2dc, 1.5);
sun.position.set(-34, 48, 22);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -70; sun.shadow.camera.right = 70;
sun.shadow.camera.top = 70; sun.shadow.camera.bottom = -70;
sun.shadow.camera.far = 200;
sun.shadow.bias = -0.0004;
scene.add(sun);

let glowLevel = 0;     // 창문·간판 발광 (밤 프리셋에서만 켜진다)
let shadowLevel = 0.2; // 접지 그림자 농도
const glowMats = [];   // 밤에 빛나는 건물 머티리얼 (시간대 전환 시 세기만 바꾼다)
let shadowMesh = null; // 접지 그림자 InstancedMesh
let seaMesh = null;    // 땅을 둘러싼 물

function applyLight(name) {
  const L = LIGHT[name] || LIGHT.morning;
  sceneEl.style.background = `linear-gradient(180deg, ${L.sky[0]} 0%, ${L.sky[1]} 68%)`;
  document.body.style.background = L.sky[1];
  scene.fog.color.setHex(L.fog);
  hemiLight.color.setHex(L.hemi[0]);
  hemiLight.groundColor.setHex(L.hemi[1]);
  hemiLight.intensity = L.hemi[2];
  sun.color.setHex(L.sun[0]);
  sun.intensity = L.sun[1];
  const az = L.sun[2] * Math.PI / 180, el = L.sun[3] * Math.PI / 180;
  const d = 70;
  sun.position.set(Math.cos(az) * Math.cos(el) * d, Math.sin(el) * d, Math.sin(az) * Math.cos(el) * d);
  renderer.toneMappingExposure = L.expo;
  glowLevel = L.glow;
  shadowLevel = L.shadow ?? 0.2;   // 접지 그림자 농도 — 평면 일러스트라 아주 옅게
  // 이미 지어진 씬도 다시 짓지 않고 바로 따라오게 한다
  glowMats.forEach(m => { m.emissiveIntensity = 0.42 * glowLevel; });
  if (shadowMesh) shadowMesh.material.opacity = shadowLevel;
  if (seaMesh) seaMesh.material.color.setHex(L.water ?? 0xa9c6d4);
  // 밤에는 라벨 칩도 어두운 바탕으로 (크림색 칩이 야경 위에서 눈을 찌른다)
  document.body.classList.toggle('night', L.glow >= 0.5);
}

/** 시간대가 바뀌면 세기만 조절할 대상들 */
export function registerGlowMat(m) { glowMats.push(m); }
export function setShadowMesh(m) { shadowMesh = m; }
export function setSeaMesh(m) { seaMesh = m; }
export function resetLightTargets() { glowMats.length = 0; shadowMesh = null; seaMesh = null; }

export { LIGHT, applyLight, hemiLight, sun, glowLevel, shadowLevel, glowMats };
