/** 씬의 기본값과 공유 헬퍼
 *
 *  three 인스턴스(scene/renderer/camera/world)와 어디서나 쓰는 소도구를 한곳에 모은다.
 *  다른 모듈은 전부 여기서 가져다 쓴다.
 */
import * as THREE from 'three';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';

/* ============ three 기본 ============ */
const sceneEl = document.getElementById('scene');
const scene = new THREE.Scene();
// 하늘은 3D 배경이 아니라 캔버스 뒤 CSS 그라데이션이 담당한다 (공짜이고 전환도 부드럽다).
// three 쪽은 안개 색만 지평선 색에 맞춰 주면 경계가 안 끊긴다.
// 안개는 수평선만 부드럽게 하는 용도다. 예전 값(95/175)은 세계가 작을 때 쓰던 것이라
// 바다를 깔자 화면 대부분이 안개로 지워졌다.
scene.fog = new THREE.Fog(0xe9e6df, 280, 620);

const renderer = new THREE.WebGLRenderer({antialias: true, alpha: true, powerPreference: 'high-performance'});
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
// 그림자를 거의 안 쓴다 (평면 일러스트 톤). 접지 그림자가 접지감을 대신한다.
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
// 프리셋마다 노출을 조금씩 다르게 쓴다. Linear 는 색을 안 비틀면서 밝기만 조절한다.
renderer.toneMapping = THREE.LinearToneMapping;
sceneEl.appendChild(renderer.domElement);

const labelRenderer = new CSS2DRenderer({element: document.getElementById('labels')});
labelRenderer.setSize(innerWidth, innerHeight);

const AR = () => Math.max(innerWidth || 0, 320) / Math.max(innerHeight || 0, 320);
let viewSize = 36;
const camera = new THREE.OrthographicCamera(-viewSize * AR(), viewSize * AR(), viewSize, -viewSize, -400, 900);

const world = new THREE.Group();
scene.add(world);

/* ============ 팔레트 & 지오메트리 ============ */
/* 세계 팔레트 — UI 와 같은 크림·잉크·코랄 계열. 지붕의 코랄만 악센트로 쓴다. */
const WALLS = [0xf8f4ea, 0xf2ece0, 0xeae3d4, 0xf5efe4, 0xede6d8];
const ROOFS = [0xe8734a, 0xd9633f, 0xc9a24b, 0xe08a5c, 0xb8563a];
const GREENS = [0x9db98a, 0x8aa87a, 0xaec49b, 0x7d9a70];
const G = {
  box: new THREE.BoxGeometry(1, 1, 1),
  cyl: new THREE.CylinderGeometry(1, 1, 1, 10),
  cone4: new THREE.ConeGeometry(1, 1, 4),
  cone: new THREE.ConeGeometry(1, 1, 14),
  sph: new THREE.SphereGeometry(1, 12, 10),
  ico: new THREE.IcosahedronGeometry(1, 0),
  torus: new THREE.TorusGeometry(1, 0.09, 8, 40)
};
/* 접지 그림자 — 물체가 땅에 얹혀 보이게 하는 부드러운 원판.
 * 방향광 그림자만으로는 접지감이 약해서 바로 밑에 한 장씩 깔아 준다.
 * 전부 InstancedMesh 하나로 묶어서 드로우콜은 1이다. */
const SHADOW_TEX = (() => {
  const s = 64;
  const cv = document.createElement('canvas');
  cv.width = cv.height = s;
  const ctx = cv.getContext('2d');
  const grd = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grd.addColorStop(0, 'rgba(0,0,0,0.42)');
  grd.addColorStop(0.55, 'rgba(0,0,0,0.20)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, s, s);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
})();
const shadowSpots = [];   // [x, z, 반지름]

const rnd = (a, b) => a + Math.random() * (b - a);
const pick = a => a[(Math.random() * a.length) | 0];
const mat = (c, opts = {}) => new THREE.MeshStandardMaterial({color: c, roughness: 0.95, metalness: 0, ...opts});

function mesh(geo, m, sx, sy, sz, x, y, z, cast = true) {
  const o = new THREE.Mesh(geo, m);
  o.scale.set(sx, sy, sz);
  o.position.set(x, y, z);
  o.castShadow = cast;
  o.receiveShadow = true;
  return o;
}


export {
  sceneEl, scene, renderer, labelRenderer, AR, viewSize, camera, world,
  WALLS, ROOFS, GREENS, G, SHADOW_TEX, shadowSpots, rnd, pick, mat, mesh
};
