/** 디오라마 모형 — 건물·나무·랜드마크·비행기
 *
 *  "무엇을 어떻게 생기게 만드느냐"만 담당한다.
 *  어디에 놓을지(배치)는 index.html 의 buildDiorama 가 정한다.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { world, G, WALLS, ROOFS, GREENS, rnd, pick, mat, mesh, shadowSpots } from './core.js';
import { glowLevel, registerGlowMat } from './lighting.js';

/* 씬을 다시 지을 때 비우는 등록부 — 배열은 재할당하지 않고 비운다 (import 가 살아 있으므로) */
export const peoples = [];        // 산책하는 사람
export const stopBuildings = [];  // 스팟 건물
export const flyers = [];         // 비행기 (이륙 / 순항)

export function resetScenery() {
  peoples.length = 0;
  stopBuildings.length = 0;
  flyers.length = 0;
  shadowSpots.length = 0;
}

/* ============ CC0 GLB 에셋 (Kenney + Polygonal Mind) ============ */
const gltfLoader = new GLTFLoader();
const GLB = {};
const CITY_KEYS = [
  ['commercial', 'building-a'], ['commercial', 'building-b'], ['commercial', 'building-e'],
  ['commercial', 'building-g'], ['commercial', 'building-i'],
  ['commercial', 'building-skyscraper-a'], ['commercial', 'building-skyscraper-c'], ['commercial', 'building-skyscraper-e'],
  ['suburban', 'building-type-a'], ['suburban', 'building-type-c'], ['suburban', 'building-type-e'],
  ['suburban', 'building-type-h'], ['suburban', 'building-type-k']
];

function fitGlb(root, targetH, opts = {}) {
  const g = root.clone(true);
  g.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(g);
  const size = box.getSize(new THREE.Vector3());
  const s = targetH / Math.max(size.y, 0.001);
  g.scale.setScalar(s * (opts.scaleMul || 1));
  g.updateMatrixWorld(true);
  const box2 = new THREE.Box3().setFromObject(g);
  g.position.y -= box2.min.y;
  if (opts.yLift) g.position.y += opts.yLift;
  g.traverse(o => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
      if (o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach(m => {
          if (m.map) m.map.colorSpace = THREE.SRGBColorSpace;
          m.needsUpdate = true;
        });
      }
    }
  });
  return g;
}

async function preloadGlbs() {
  const jobs = [];
  const load = (key, url) => jobs.push(
    gltfLoader.loadAsync(url).then(gltf => { GLB[key] = gltf.scene; }).catch(e => console.warn('GLB fail', key, e))
  );
  CITY_KEYS.forEach(([pack, n]) => load('city:' + n,`/assets/glb/${pack}/${n}.glb`));
  ['temple-base','temple-roof','temple-roof2','temple-column'].forEach(n =>
    load(n,`/assets/glb/temple/${n}.glb`));
  load('water-tower', '/assets/glb/industrial/water-tower.glb');
  load('fountain', '/assets/glb/fantasy/fountain.glb');
  load('hedge', '/assets/glb/fantasy/hedge.glb');
  load('rock', '/assets/glb/fantasy/rock-large.glb');
  load('lantern', '/assets/glb/fantasy/lantern.glb');
  await Promise.all(jobs);
  pastelizeGlbTextures();
}

/* Kenney 건물이 칙칙한 진짜 원인은 colormap.png 텍스처 자체가 저채도 회색이라는 것이다.
 * 머티리얼 color 만 만져서는 못 밝힌다 (곱연산이라 흰색 위로 못 올라간다).
 * 그래서 로드 직후 텍스처를 캔버스에서 픽셀 단위로 보정한다. 12KB 짜리 4장이라 비용은 무시할 수준. */
function pastelizeGlbTextures() {
  const seen = new Set();
  Object.values(GLB).forEach(root => root.traverse(o => {
    if (!o.isMesh || !o.material) return;
    (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => {
      const tex = m.map;
      if (!tex || !tex.image || seen.has(tex.uuid)) return;
      seen.add(tex.uuid);
      try {
        const img = tex.image;
        const w = img.width || img.videoWidth, h = img.height || img.videoHeight;
        if (!w || !h) return;
        const cv = document.createElement('canvas');
        cv.width = w; cv.height = h;
        const ctx = cv.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0);
        const d = ctx.getImageData(0, 0, w, h);
        const px = d.data;
        const c = new THREE.Color();
        const hsl = { h: 0, s: 0, l: 0 };
        for (let i = 0; i < px.length; i += 4) {
          if (px[i + 3] === 0) continue;
          c.setRGB(px[i] / 255, px[i + 1] / 255, px[i + 2] / 255, THREE.SRGBColorSpace);
          c.getHSL(hsl);
          // 색상을 크림·코랄 대역으로 끌어모은다. 원래 색상은 흔적만 남긴다 —
          // 화면 전체가 좁은 팔레트 하나로 읽히는 게 이 톤의 핵심이라 여기서 통일한다.
          const target = 0.09;                 // 크림~테라코타 사이
          let dh = target - hsl.h;
          if (dh > 0.5) dh -= 1; else if (dh < -0.5) dh += 1;
          hsl.h = (hsl.h + dh * 0.72 + 1) % 1;
          hsl.s = Math.min(1, hsl.s * 0.5 + 0.05);
          hsl.l = Math.min(1, hsl.l * 0.42 + 0.52);
          c.setHSL(hsl.h, hsl.s, hsl.l, THREE.SRGBColorSpace);
          px[i] = Math.round(c.r * 255);
          px[i + 1] = Math.round(c.g * 255);
          px[i + 2] = Math.round(c.b * 255);
        }
        ctx.putImageData(d, 0, 0);
        tex.image = cv;
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.needsUpdate = true;
      } catch (e) {
        // 텍스처 보정에 실패해도 원본 그대로 쓰면 된다 — 치명적이지 않다
        console.warn('팔레트 보정 건너뜀', e);
      }
    });
  }));
}

function addGlbBuilding(x, z, big = false, theme = 'asakusa', scale = 1) {
  const all = CITY_KEYS.map(([, n]) => 'city:' + n).filter(k => GLB[k]);
  if (!all.length) { addBuildingPrim(x, z, big, scale); return; }
  const suburban = all.filter(k => k.includes('building-type'));
  const commercial = all.filter(k => !k.includes('building-type') && !k.includes('skyscraper'));
  const sky = all.filter(k => k.includes('skyscraper'));
  let pool;
  if (theme === 'fuji') pool = suburban.length ? suburban : all;
  else if (theme === 'odaiba' || theme === 'roppongi') {
    pool = big
      ? (sky.length ? sky : commercial).concat(commercial)
      : commercial.concat(sky);
  } else if (theme === 'night') {
    pool = commercial.concat(suburban);
  } else {
    // asakusa: 낮은 주택·상점 위주, 고층은 드물게
    pool = big && sky.length ? sky : suburban.concat(commercial);
  }
  if (!pool.length) pool = all;
  const key = pick(pool);
  const targetH = (theme === 'fuji'
    ? rnd(2.4, 4.0)
    : big ? rnd(7, 12) : rnd(3.0, 5.2)) * scale;
  const g = fitGlb(GLB[key], targetH);
  // 밤에는 건물이 스스로 빛나야 도시로 읽힌다. 자기 텍스처를 발광맵으로 쓴다.
  // 시간대를 바꿔도 다시 짓지 않도록 발광을 '항상' 걸어 두고 세기만 0 으로 둔다.
  g.traverse(o => {
    if (!o.isMesh || !o.material) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    const out = mats.map(m => {
      const c = m.clone();
      c.emissive = new THREE.Color(0xffd9a0);
      c.emissiveMap = c.map;
      c.emissiveIntensity = 0.42 * glowLevel;
      registerGlowMat(c);
      return c;
    });
    o.material = out.length === 1 ? out[0] : out;
  });
  g.position.x = x;
  g.position.z = z;
  g.rotation.y = (Math.random() * 4 | 0) * Math.PI / 2;
  g.userData.fill = true;
  world.add(g);
  shadowSpots.push([x, z, targetH * 0.42]);
}

function buildGlbPagoda(g) {
  if (GLB['temple-base']) g.add(fitGlb(GLB['temple-base'], 2.4));
  const roofs = ['temple-roof', 'temple-roof2', 'temple-roof', 'temple-roof2', 'temple-roof'];
  let y = 2.2;
  roofs.forEach((k, i) => {
    if (!GLB[k]) return;
    const roof = fitGlb(GLB[k], Math.max(1.6, 2.8 - i * 0.28), { scaleMul: 1 - i * 0.08 });
    roof.position.y = y;
    g.add(roof);
    y += 2.0 - i * 0.12;
  });
  if (GLB['temple-column']) {
    const col = fitGlb(GLB['temple-column'], 3.2);
    col.position.y = y * 0.3;
    g.add(col);
  }
  g.add(mesh(G.cyl, mat(0xc9a24b), 0.12, 2.4, 0.12, 0, y + 1.0, 0));
}


function addTree(x, z, s = 1) {
  const g = new THREE.Group();
  g.add(mesh(G.cyl, mat(0x9a7350), 0.16 * s, 0.9 * s, 0.16 * s, 0, 0.45 * s, 0));
  const fol = mesh(G.ico, mat(pick(GREENS), {flatShading: true}), 0.95 * s, 1.15 * s, 0.95 * s, 0, 1.55 * s, 0);
  g.add(fol);
  g.position.set(x, 0, z);
  g.rotation.y = rnd(0, Math.PI * 2);
  g.userData.fill = true;
  world.add(g);
  shadowSpots.push([x, z, 1.05 * s]);
}

function addBuildingPrim(x, z, big = false, scale = 1) {
  const w = rnd(2.2, 3.6) * (big ? 1.35 : 1) * scale;
  const d = rnd(2.2, 3.6) * (big ? 1.35 : 1) * scale;
  const h = (big ? rnd(3.6, 7.5) : rnd(1.5, 3.4)) * scale;
  const wall = pick(WALLS);
  const g = new THREE.Group();
  g.add(mesh(G.box, mat(wall), w, h, d, 0, h / 2, 0));
  // 레퍼런스처럼 대부분 주황 박공 지붕
  if (Math.random() < 0.88) {
    const rh = rnd(0.7, 1.35);
    const roof = mesh(G.cone4, mat(pick(ROOFS), {flatShading: true}),
      Math.hypot(w, d) * 0.58, rh, Math.hypot(w, d) * 0.58, 0, h + rh / 2, 0);
    roof.rotation.y = Math.PI / 4;
    g.add(roof);
  } else {
    g.add(mesh(G.box, mat(0xd9d2c6), w + 0.2, 0.18, d + 0.2, 0, h + 0.09, 0));
  }
  g.position.set(x, 0, z);
  g.userData.fill = true;
  world.add(g);
  shadowSpots.push([x, z, Math.max(w, d) * 0.7]);
}

function addPerson(curve) {
  const g = new THREE.Group();
  const cols = [0xe8734a, 0x5b8fb9, 0x7fb069, 0xc9a24b, 0xb06a8f];
  g.add(mesh(G.cyl, mat(pick(cols)), 0.16, 0.42, 0.16, 0, 0.21, 0));
  g.add(mesh(G.sph, mat(0xf4d8c2), 0.13, 0.13, 0.13, 0, 0.52, 0));
  world.add(g);
  peoples.push({g, t: Math.random(), spd: rnd(0.008, 0.02) * (Math.random() < 0.5 ? 1 : -1), off: rnd(-1.4, 1.4)});
}

/* ---- 랜드마크 (일차 히어로 — 실제 명소에 가까운 실루엣) ---- */
function lmPagoda(g) {
  // 센소지 오층탑 + 도리이 느낌
  const red = mat(0xb81f1f), dark = mat(0x4a2a1a), cream = mat(0xf3e6d0), goldM = mat(0xd4a84b);
  const stone = mat(0x9a958c);
  g.add(mesh(G.box, stone, 7.2, 0.55, 7.2, 0, 0.28, 0)); // 기단
  g.add(mesh(G.box, stone, 5.6, 0.35, 5.6, 0, 0.65, 0));
  for (let i = 0; i < 5; i++) {
    const s = 1 - i * 0.11;
    const y = 1.1 + i * 2.35;
    g.add(mesh(G.box, cream, 3.8 * s, 1.35, 3.8 * s, 0, y, 0));
    // 처마가 넓은 일본식 지붕
    const roof = mesh(G.cone4, red, 4.6 * s, 1.15, 4.6 * s, 0, y + 0.95, 0);
    roof.rotation.y = Math.PI / 4;
    g.add(roof);
    g.add(mesh(G.box, dark, 4.2 * s, 0.12, 4.2 * s, 0, y + 0.55, 0));
  }
  g.add(mesh(G.cyl, goldM, 0.14, 2.8, 0.14, 0, 13.6, 0));
  g.add(mesh(G.sph, goldM, 0.28, 0.28, 0.28, 0, 15.1, 0));
  // 도리이
  const t = new THREE.Group();
  [-2.0, 2.0].forEach(dx => t.add(mesh(G.cyl, dark, 0.26, 4.0, 0.26, dx, 2.0, 0)));
  t.add(mesh(G.box, red, 5.6, 0.42, 0.55, 0, 4.05, 0));
  t.add(mesh(G.box, red, 4.4, 0.28, 0.42, 0, 3.35, 0));
  t.position.set(0, 0, 7.2);
  g.add(t);
  // 본당 실루엣
  const hall = new THREE.Group();
  hall.add(mesh(G.box, cream, 6.5, 2.4, 4.2, 0, 1.5, 0));
  const hr = mesh(G.cone4, red, 5.8, 1.6, 5.8, 0, 3.4, 0);
  hr.rotation.y = Math.PI / 4;
  hall.add(hr);
  hall.position.set(-8.5, 0, -1);
  g.add(hall);
}

function lmWheel(g) {
  // 오다이바 대관람차 느낌 — 큰 원형 + 곤돌라 + A자 지지대
  const steel = mat(0xffffff, {metalness: 0.35, roughness: 0.45});
  const blue = mat(0x4aa3d9, {metalness: 0.2, roughness: 0.55});
  const base = mat(0xd8d2c6);
  g.add(mesh(G.box, base, 10, 0.5, 6, 0, 0.25, 0));
  const wheel = new THREE.Group();
  const R = 7.2;
  // 이중 림
  [[R, 0.22], [R * 0.72, 0.14]].forEach(([rad, th]) => {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(rad, th, 8, 48), steel);
    ring.castShadow = true;
    wheel.add(ring);
  });
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const sp = mesh(G.cyl, steel, 0.07, R * 2, 0.07, 0, 0, 0);
    sp.rotation.z = a;
    wheel.add(sp);
  }
  const gondolaCols = [0xe8734a, 0x5b8fb9, 0xc9a24b, 0x7fb069, 0xb06a8f, 0xffffff];
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2;
    const cab = mesh(G.box, mat(gondolaCols[i % gondolaCols.length]), 0.85, 1.05, 0.85,
      Math.cos(a) * R, Math.sin(a) * R, 0);
    wheel.add(cab);
  }
  wheel.position.set(0, R + 1.2, 0);
  wheel.name = 'wheelSpin';
  g.add(wheel);
  // A-frame legs
  [[-3.2, 0.35], [3.2, -0.35]].forEach(([dx, tilt]) => {
    const leg = mesh(G.cyl, blue, 0.28, R + 2.5, 0.28, dx, (R + 1.2) / 2, 0);
    leg.rotation.z = tilt;
    g.add(leg);
  });
  g.add(mesh(G.cyl, steel, 0.35, 1.2, 0.35, 0, R + 1.2, 0)); // hub
  // 바다 느낌 플랫폼
  const sea = new THREE.Mesh(new THREE.CircleGeometry(11, 36), mat(0x8ebfd4, {roughness: 0.3, metalness: 0.12}));
  sea.rotation.x = -Math.PI / 2;
  sea.position.set(0, 0.04, 8);
  sea.receiveShadow = true;
  g.add(sea);
}

function lmTower(g) {
  // 모리타워/시티뷰 — 세로로 긴 유리 고층 + 안테나
  const glass = mat(0xa8c4d8, {metalness: 0.45, roughness: 0.35});
  const dark = mat(0x3a4550, {metalness: 0.2, roughness: 0.6});
  const cream = mat(0xe8e4dc);
  g.add(mesh(G.box, cream, 7.5, 0.6, 7.5, 0, 0.3, 0)); // 기단/광장
  // 본관 (사각 타워)
  g.add(mesh(G.box, glass, 4.4, 16, 4.4, 0, 8.5, 0));
  g.add(mesh(G.box, dark, 4.6, 0.35, 4.6, 0, 16.7, 0)); // 옥상
  // 층 띠
  for (let i = 0; i < 10; i++) {
    g.add(mesh(G.box, mat(0xffffff, {transparent: true, opacity: 0.35}), 4.45, 0.08, 4.45, 0, 2.2 + i * 1.45, 0, false));
  }
  // 안테나 / 전망 스파이어
  g.add(mesh(G.cyl, dark, 0.35, 3.2, 0.35, 0, 18.5, 0));
  g.add(mesh(G.cyl, mat(0xc0392b), 0.12, 4.5, 0.12, 0, 21.5, 0));
  g.add(mesh(G.box, cream, 2.2, 1.4, 2.2, 0, 17.6, 0)); // 전망층
}

function lmFuji(g) {
  /* 후지산. 예전 비율(높이/지름 0.3)은 바위 덩어리로 보였다.
   * 실제 후지는 밑변 대비 완만하지만 실루엣이 또렷하다 — 세우고, 눈 경계를 흩는다. */
  const rockA = mat(0x5f7382, { flatShading: true });
  const rockB = mat(0x74899a, { flatShading: true });
  const snowM = mat(0xf8fbff, { flatShading: true, roughness: 0.75 });

  g.add(mesh(G.cone, rockA, 17, 17.5, 17, 0, 8.75, -2));      // 본체 — 훨씬 높게
  g.add(mesh(G.cone, rockB, 11.5, 12.5, 11.5, 0, 12.6, -2));  // 중턱 능선

  // 정상 설경: 원뿔 하나로 자르면 경계가 자로 그은 듯해서, 크기가 다른 조각을 겹쳐 흩는다
  g.add(mesh(G.cone, snowM, 5.4, 6.2, 5.4, 0, 15.5, -2));
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + 0.4;
    const rr = 4.3 + Math.sin(i * 2.3) * 1.1;
    g.add(mesh(G.cone, snowM, 1.5, 2.1, 1.5,
      Math.cos(a) * rr, 14.0 + Math.sin(i * 1.7) * 0.7, Math.sin(a) * rr - 2));
  }
  // 분화구 자리를 살짝 눌러 준다
  g.add(mesh(G.cyl, mat(0xd8e2ec, { flatShading: true }), 1.5, 0.5, 1.5, 0, 18.5, -2));
}

function lmPlane(g) {
  // 하네다 — 여객기 + 활주로 + 터미널 박스
  const white = mat(0xf4f6f8), blue = mat(0x2c5aa0), acc = mat(0xe8734a), asphalt = mat(0x6a6862);
  // 터미널
  g.add(mesh(G.box, mat(0xdde3ea), 14, 2.2, 4.5, -8, 1.1, -6));
  g.add(mesh(G.box, blue, 14.2, 0.25, 4.7, -8, 2.25, -6));
  // 활주로
  const rw = new THREE.Mesh(new THREE.PlaneGeometry(8, 32), asphalt);
  rw.rotation.x = -Math.PI / 2;
  rw.position.set(2, 0.05, 2);
  rw.receiveShadow = true;
  g.add(rw);
  for (let i = 0; i < 10; i++) {
    const dash = new THREE.Mesh(new THREE.PlaneGeometry(0.35, 1.6), mat(0xffffff));
    dash.rotation.x = -Math.PI / 2;
    dash.position.set(2, 0.07, -10 + i * 2.8);
    g.add(dash);
  }
  // 항공기
  const plane = new THREE.Group();
  const body = mesh(G.cyl, white, 0.85, 8.5, 0.85, 0, 0, 0);
  body.rotation.x = Math.PI / 2;
  plane.add(body);
  plane.add(mesh(G.sph, white, 0.85, 0.85, 1.15, 0, 0, 4.4));
  plane.add(mesh(G.box, white, 10.5, 0.14, 1.8, 0, 0, 0.2)); // wings
  plane.add(mesh(G.box, acc, 0.14, 2.0, 1.3, 0, 1.1, -3.6));
  plane.add(mesh(G.box, acc, 3.4, 0.12, 1.0, 0, 0.15, -3.6));
  plane.add(mesh(G.cyl, blue, 0.35, 0.5, 0.35, -2.8, -0.55, 0.8));
  plane.add(mesh(G.cyl, blue, 0.35, 0.5, 0.35, 2.8, -0.55, 0.8));
  plane.position.set(2, 1.35, 1);
  g.add(plane);

  // 이륙하는 기체 — 활주로 끝에서 가속해 떠오른다. 정지 기체는 게이트 느낌으로 남긴다.
  const takeoff = planeModel(1.0);
  takeoff.position.set(2, 1.35, -14);
  g.add(takeoff);
  flyers.push({ g: takeoff, kind: 'takeoff', t: Math.random(), spd: 0.085, origin: g });
}

/** 여객기 모형 하나 (랜드마크와 순항기가 공유) */
function planeModel(s = 1) {
  const white = mat(0xf7f5ef), blue = mat(0x3c5a86), acc = mat(0xe8734a);
  const p = new THREE.Group();
  const body = mesh(G.cyl, white, 0.85, 8.5, 0.85, 0, 0, 0);
  body.rotation.x = Math.PI / 2;
  p.add(body);
  p.add(mesh(G.sph, white, 0.85, 0.85, 1.15, 0, 0, 4.4));
  p.add(mesh(G.box, white, 10.5, 0.14, 1.8, 0, 0, 0.2));
  p.add(mesh(G.box, acc, 0.14, 2.0, 1.3, 0, 1.1, -3.6));
  p.add(mesh(G.box, acc, 3.4, 0.12, 1.0, 0, 0.15, -3.6));
  p.add(mesh(G.cyl, blue, 0.35, 0.5, 0.35, -2.8, -0.55, 0.8));
  p.add(mesh(G.cyl, blue, 0.35, 0.5, 0.35, 2.8, -0.55, 0.8));
  p.scale.setScalar(s);
  return p;
}

/** 상공을 가로지르는 순항기 — 하네다가 화면에 없어도 하늘에 뭔가 지나간다 */
function addCruisers(n, radius) {
  for (let i = 0; i < n; i++) {
    const p = planeModel(rnd(0.5, 0.8));
    p.userData.fill = true;
    world.add(p);
    const a = rnd(0, Math.PI * 2);
    flyers.push({
      g: p, kind: 'cruise', t: Math.random(), spd: rnd(0.018, 0.03),
      y: rnd(30, 42), a, span: radius * 2.6
    });
  }
}
const LM = {pagoda: lmPagoda, wheel: lmWheel, tower: lmTower, fuji: lmFuji, plane: lmPlane};


function inferStopKind(s) {
  const n = s.name;
  if (s.mode === 'bus' || /→|고속버스|버스/.test(n) && !/로프웨이/.test(n)) return 'bus';
  if (s.stay || /Section L|숙소|호텔|료칸|온천 ·|가이세키/.test(n)) return /온천|료칸|가이세키/.test(n) ? 'onsen' : 'hotel';
  if (/센소지|나카미세|사찰|신사/.test(n)) return 'temple';
  if (/해변|바다공원/.test(n)) return 'beach';
  if (/우에노 공원|공원|황거 러닝|일출/.test(n)) return 'park';
  if (/아메요코/.test(n)) return 'market';
  if (/아키하바라|전자/.test(n)) return 'elec';
  if (/teamLab|모리미술|시티뷰|미술관/.test(n)) return 'museum';
  if (/조이폴리스/.test(n)) return 'amuse';
  if (/로손|편의점/.test(n)) return 'conveni';
  if (/로프웨이/.test(n)) return 'ropeway';
  if (/택시/.test(n)) return 'taxi';
  if (/하네다|공항/.test(n)) return 'airport';
  if (/가조엔/.test(n)) return 'palace';
  if (/쇼핑|이세탄|돈키/.test(n)) return 'shop';
  if (s.eat || /몬자|스즈키|야키니쿠|라멘|스시|호토|점심|AFURI|히로키야|아쿠아시티/.test(n)) {
    if (/몬자/.test(n)) return 'foodMonja';
    if (/스즈키|말차|젤라토/.test(n)) return 'foodMatcha';
    if (/야키니쿠|토도로키|히로키야/.test(n)) return 'foodYaki';
    if (/라멘|AFURI/.test(n)) return 'foodRamen';
    if (/스시/.test(n)) return 'foodSushi';
    if (/호토/.test(n)) return 'foodHoto';
    return 'food';
  }
  return 'shop';
}

function sbRoof(g, w, d, y, col = 0xc45c3e) {
  const roof = mesh(G.cone4, mat(col, {flatShading: true}), Math.hypot(w, d) * 0.72, 1.1, Math.hypot(w, d) * 0.72, 0, y, 0);
  roof.rotation.y = Math.PI / 4;
  g.add(roof);
}

function sbHotel(g) {
  const wall = mat(0xe8e2d6), accent = mat(0x5b8fb9), dark = mat(0x6a6862);
  g.add(mesh(G.box, wall, 4.2, 5.2, 3.4, 0, 2.6, 0));
  for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) {
    g.add(mesh(G.box, mat(0x9ec4e0, {metalness: 0.2, roughness: 0.4}), 0.55, 0.45, 0.08,
      -1.35 + j * 1.35, 1.2 + i * 1.05, 1.72));
  }
  g.add(mesh(G.box, accent, 4.4, 0.35, 3.6, 0, 5.35, 0));
  g.add(mesh(G.box, dark, 1.1, 1.6, 0.12, 0, 0.8, 1.72)); // 출입구
  g.add(mesh(G.box, mat(0xc9a24b), 2.2, 0.12, 1.4, 0, 0.08, 2.4)); // 캐노피
}

function sbOnsen(g) {
  const wood = mat(0xb8895a), dark = mat(0x6b4a2e), steam = mat(0xffffff, {transparent: true, opacity: 0.35});
  g.add(mesh(G.box, wood, 5.0, 2.2, 3.6, 0, 1.1, 0));
  sbRoof(g, 5.2, 3.8, 2.7, 0x8b3a2a);
  // 노천탕
  g.add(mesh(G.cyl, mat(0x8a9588), 1.5, 0.45, 1.5, 2.8, 0.25, 1.2));
  g.add(mesh(G.cyl, mat(0x7eb6c9, {roughness: 0.25, metalness: 0.1}), 1.25, 0.2, 1.25, 2.8, 0.42, 1.2));
  g.add(mesh(G.sph, steam, 0.55, 0.7, 0.55, 2.8, 1.1, 1.2, false));
  g.add(mesh(G.sph, steam, 0.4, 0.55, 0.4, 3.1, 1.5, 1.0, false));
  g.add(mesh(G.box, dark, 0.9, 1.4, 0.1, -1.2, 0.7, 1.82));
}

function sbTemple(g) {
  // 가미나리몬 + 나카미세 상점 느낌 (오층탑은 일차 랜드마크)
  const red = mat(0xb81f1f), dark = mat(0x4a2a1a), cream = mat(0xf3e6d0), goldM = mat(0xd4a84b);
  g.add(mesh(G.box, cream, 5.5, 3.2, 2.2, 0, 1.6, 0));
  sbRoof(g, 6.2, 3.0, 3.6, 0xb81f1f);
  // 문 기둥
  [-2.2, 2.2].forEach(dx => g.add(mesh(G.cyl, dark, 0.28, 3.4, 0.28, dx, 1.7, 1.3)));
  g.add(mesh(G.box, red, 5.2, 0.45, 0.55, 0, 3.5, 1.3));
  g.add(mesh(G.box, goldM, 1.8, 0.9, 0.15, 0, 2.4, 1.35));
  // 상점가 박스
  for (let i = 0; i < 3; i++) {
    const sx = -4.5 + i * 1.6;
    g.add(mesh(G.box, mat(0xf0e6d4), 1.35, 1.5, 1.5, sx, 0.75, 3.2));
    g.add(mesh(G.box, mat(0xc45c3e), 1.45, 0.2, 1.6, sx, 1.55, 3.2));
  }
}

function sbPark(g) {
  const grass = mat(0xc5dc9e), path = mat(0xe8dfc8), water = mat(0x7eb6c9, {roughness: 0.25, metalness: 0.12});
  const disk = new THREE.Mesh(new THREE.CircleGeometry(4.2, 28), grass);
  disk.rotation.x = -Math.PI / 2;
  disk.position.y = 0.04;
  disk.receiveShadow = true;
  g.add(disk);
  const walk = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 5.5), path);
  walk.rotation.x = -Math.PI / 2;
  walk.position.set(0, 0.06, 0.4);
  g.add(walk);
  // 분수
  g.add(mesh(G.cyl, mat(0xb8b2a6), 1.1, 0.35, 1.1, 0, 0.2, -1.2));
  g.add(mesh(G.cyl, water, 0.9, 0.15, 0.9, 0, 0.38, -1.2));
  g.add(mesh(G.cyl, mat(0xd8d2c6), 0.18, 1.1, 0.18, 0, 0.9, -1.2));
  [[-2.4, 1.5], [2.2, 1.8], [-1.5, -2.5], [2.6, -1.8], [0.8, 2.6]].forEach(([x, z]) => {
    g.add(mesh(G.cyl, mat(0x8a6a45), 0.14, 0.9, 0.14, x, 0.45, z));
    g.add(mesh(G.ico, mat(pick(GREENS), {flatShading: true}), 0.85, 1.0, 0.85, x, 1.25, z));
  });
  // 벤치
  g.add(mesh(G.box, mat(0xa67c52), 1.4, 0.18, 0.45, -2.0, 0.45, 0.2));
  g.add(mesh(G.box, mat(0xa67c52), 1.4, 0.45, 0.12, -2.0, 0.7, 0.0));
}

function sbMarket(g) {
  const awning = [0xe8734a, 0xffffff, 0xe8734a, 0xffffff];
  for (let i = 0; i < 4; i++) {
    const x = -2.4 + i * 1.6;
    g.add(mesh(G.box, mat(0xf2e8d8), 1.4, 1.6, 1.8, x, 0.8, 0));
    for (let k = 0; k < 4; k++) {
      g.add(mesh(G.box, mat(awning[k % 4]), 0.35, 0.12, 1.9, x - 0.52 + k * 0.35, 1.7, 0));
    }
    g.add(mesh(G.box, mat(0xc0392b), 1.1, 0.55, 0.7, x, 0.55, 1.1)); // 과일 박스
  }
}

function sbElec(g) {
  const neon = [0xe74c3c, 0xf1c40f, 0x3498db, 0x2ecc71];
  for (let i = 0; i < 3; i++) {
    const x = -2.2 + i * 2.2;
    const h = 4.5 + i * 1.2;
    g.add(mesh(G.box, mat(0x3a4550), 1.8, h, 1.8, x, h / 2, 0));
    for (let y = 1; y < h - 0.5; y += 0.9) {
      // y 가 실수라 neon[(i+y)%4] 가 undefined 였다 — 네온이 실제로 안 빛나고 있었다
      const c = neon[(i + Math.round(y * 10)) % 4];
      g.add(mesh(G.box, mat(c, {emissive: c, emissiveIntensity: 0.35}), 1.5, 0.35, 0.12, x, y, 0.92));
    }
  }
  g.add(mesh(G.box, mat(0x2c3e50), 7.2, 0.2, 2.4, 0, 0.1, 1.4));
}

function sbMuseum(g) {
  // teamLab / 미술관 — 유리 박스 + 빛
  const glass = mat(0xa8d4f0, {metalness: 0.4, roughness: 0.25, transparent: true, opacity: 0.75});
  const glow = mat(0x6ec6ff, {emissive: 0x3aa0e8, emissiveIntensity: 0.45});
  g.add(mesh(G.box, mat(0xdde3ea), 5.5, 0.4, 5.5, 0, 0.2, 0));
  g.add(mesh(G.box, glass, 4.5, 3.8, 4.5, 0, 2.2, 0));
  g.add(mesh(G.box, glow, 3.2, 2.4, 3.2, 0, 2.0, 0, false));
  g.add(mesh(G.box, mat(0xffffff, {transparent: true, opacity: 0.5}), 4.7, 0.15, 4.7, 0, 4.15, 0, false));
}

function sbAmuse(g) {
  const col = [0xe8734a, 0x5b8fb9, 0xc9a24b, 0xb06a8f];
  g.add(mesh(G.box, mat(0xf0ebe3), 5.0, 2.8, 4.0, 0, 1.4, 0));
  sbRoof(g, 5.4, 4.4, 3.4, 0xe8734a);
  // 미니 관람차 장식
  const wheel = new THREE.Group();
  const R = 1.6;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(R, 0.1, 6, 24), mat(0xffffff, {metalness: 0.3}));
  wheel.add(ring);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    wheel.add(mesh(G.box, mat(col[i % 4]), 0.35, 0.4, 0.35, Math.cos(a) * R, Math.sin(a) * R, 0));
  }
  wheel.position.set(0, 4.6, 0);
  wheel.name = 'miniWheel';
  g.add(wheel);
}

function sbBeach(g) {
  const sand = mat(0xe8d5a8), sea = mat(0x7eb6c9, {roughness: 0.3, metalness: 0.15});
  const disk = new THREE.Mesh(new THREE.CircleGeometry(4.5, 28), sand);
  disk.rotation.x = -Math.PI / 2;
  disk.position.y = 0.04;
  g.add(disk);
  const water = new THREE.Mesh(new THREE.CircleGeometry(3.2, 28), sea);
  water.rotation.x = -Math.PI / 2;
  water.position.set(0, 0.06, 2.4);
  g.add(water);
  // 파라솔
  [[-1.8, -0.5], [1.5, -1.0]].forEach(([x, z], i) => {
    g.add(mesh(G.cyl, mat(0xffffff), 0.08, 1.6, 0.08, x, 0.8, z));
    const um = mesh(G.cone, mat(i ? 0xe8734a : 0xffffff), 1.2, 0.45, 1.2, x, 1.7, z);
    um.rotation.x = Math.PI;
    g.add(um);
  });
  // 여신상 실루엣
  g.add(mesh(G.cyl, mat(0x7a9e8e), 0.25, 1.8, 0.25, 2.8, 0.9, -1.5));
  g.add(mesh(G.sph, mat(0x7a9e8e), 0.28, 0.28, 0.28, 2.8, 1.95, -1.5));
  g.add(mesh(G.box, mat(0x7a9e8e), 0.15, 0.9, 0.15, 2.8, 2.4, -1.5));
}

function sbConveni(g) {
  // 로손 블루/화이트
  const blue = mat(0x0068b7), white = mat(0xf5f7fa);
  g.add(mesh(G.box, white, 4.0, 2.4, 3.0, 0, 1.2, 0));
  g.add(mesh(G.box, blue, 4.2, 0.55, 3.2, 0, 2.55, 0));
  g.add(mesh(G.box, mat(0xffffff), 2.8, 0.25, 0.2, 0, 2.55, 1.62));
  g.add(mesh(G.box, mat(0x9ec4e0, {metalness: 0.25}), 1.6, 1.5, 0.1, 0, 0.95, 1.52));
  g.add(mesh(G.box, blue, 0.9, 0.35, 0.15, -1.4, 2.0, 1.55));
}

function sbRopeway(g) {
  const steel = mat(0xd8d2c6, {metalness: 0.4, roughness: 0.5});
  g.add(mesh(G.cyl, steel, 0.35, 6.5, 0.35, -2.5, 3.25, 0));
  g.add(mesh(G.cyl, steel, 0.35, 5.0, 0.35, 3.0, 2.5, 1.5));
  g.add(mesh(G.box, steel, 6.2, 0.12, 0.12, 0.25, 6.0, 0.75));
  // 곤돌라
  const cab = mesh(G.box, mat(0xe8734a), 1.4, 1.1, 1.0, 0.2, 5.2, 0.75);
  g.add(cab);
  g.add(mesh(G.box, mat(0x9ec4e0, {metalness: 0.3}), 1.1, 0.55, 0.08, 0.2, 5.35, 1.28));
  g.add(mesh(G.box, mat(0xf0ebe3), 2.5, 1.4, 2.0, -2.5, 0.7, 0)); // 승강장
}

function sbTaxi(g) {
  const body = mat(0xf5c542), dark = mat(0x2c3e50);
  g.add(mesh(G.box, body, 2.6, 0.9, 1.5, 0, 0.65, 0));
  g.add(mesh(G.box, body, 1.5, 0.7, 1.4, -0.2, 1.35, 0));
  g.add(mesh(G.box, mat(0x7a9eb8, {metalness: 0.3}), 1.2, 0.45, 1.42, -0.15, 1.4, 0));
  [[-0.85, 0.85], [0.85, 0.85], [-0.85, -0.85], [0.85, -0.85]].forEach(([x, z]) => {
    g.add(mesh(G.cyl, dark, 0.28, 0.22, 0.28, x, 0.28, z));
  });
  g.add(mesh(G.box, mat(0xc0392b), 0.5, 0.25, 0.2, 0.2, 1.85, 0));
}

function sbAirport(g) {
  const glass = mat(0xb8cfe0, {metalness: 0.35, roughness: 0.35});
  g.add(mesh(G.box, mat(0xe8eef4), 6.5, 2.0, 3.2, 0, 1.0, 0));
  g.add(mesh(G.box, glass, 6.0, 1.4, 0.15, 0, 1.2, 1.62));
  g.add(mesh(G.box, mat(0x2c5aa0), 6.7, 0.3, 3.4, 0, 2.1, 0));
  // 작은 비행기
  const p = new THREE.Group();
  const body = mesh(G.cyl, mat(0xf4f6f8), 0.25, 2.4, 0.25, 0, 0, 0);
  body.rotation.x = Math.PI / 2;
  p.add(body);
  p.add(mesh(G.box, mat(0xf4f6f8), 2.8, 0.08, 0.5, 0, 0, 0));
  p.position.set(4.5, 1.0, 0);
  g.add(p);
}

function sbBus(g) {
  const green = mat(0x2d6a4f), white = mat(0xf5f7fa);
  g.add(mesh(G.box, green, 4.2, 1.8, 1.8, 0, 1.1, 0));
  g.add(mesh(G.box, white, 3.6, 0.7, 1.7, 0.1, 2.15, 0));
  g.add(mesh(G.box, mat(0x9ec4e0, {metalness: 0.25}), 3.2, 0.55, 0.1, 0.1, 2.15, 0.9));
  [[-1.3, 0.75], [1.3, 0.75], [-1.3, -0.75], [1.3, -0.75]].forEach(([x, z]) => {
    g.add(mesh(G.cyl, mat(0x2c3e50), 0.32, 0.28, 0.32, x, 0.35, z));
  });
  // 정류장 표지
  g.add(mesh(G.cyl, mat(0x888780), 0.08, 2.4, 0.08, 2.8, 1.2, 0));
  g.add(mesh(G.box, mat(0xe8734a), 0.7, 0.5, 0.12, 2.8, 2.4, 0));
}

function sbPalace(g) {
  // 가조엔 — 붉은 기와 + 화려한 본관
  const cream = mat(0xf3e6d0), red = mat(0xb81f1f), goldM = mat(0xd4a84b);
  g.add(mesh(G.box, cream, 6.0, 3.0, 4.0, 0, 1.5, 0));
  sbRoof(g, 6.8, 4.8, 3.6, 0xb81f1f);
  g.add(mesh(G.box, goldM, 1.2, 1.8, 0.15, 0, 1.2, 2.05));
  g.add(mesh(G.box, red, 2.5, 0.25, 1.5, 0, 0.15, 2.6));
  [[-2.5, 2.2], [2.5, 2.2]].forEach(([x, z]) => {
    g.add(mesh(G.cyl, mat(0x8a6a45), 0.12, 1.0, 0.12, x, 0.5, z));
    g.add(mesh(G.ico, mat(0x6a9c5f, {flatShading: true}), 0.7, 0.85, 0.7, x, 1.3, z));
  });
}

function sbShop(g) {
  const wall = mat(0xf0ebe3), accent = mat(0xe8734a);
  g.add(mesh(G.box, wall, 3.6, 3.5, 2.8, 0, 1.75, 0));
  sbRoof(g, 3.8, 3.0, 3.8, 0xc45c3e);
  g.add(mesh(G.box, mat(0x9ec4e0, {metalness: 0.2}), 2.4, 1.8, 0.1, 0, 1.5, 1.42));
  g.add(mesh(G.box, accent, 2.0, 0.4, 0.15, 0, 2.7, 1.45));
}

function sbFoodBase(g, accent = 0xc0392b) {
  g.add(mesh(G.box, mat(0xf5efe4), 3.4, 2.2, 2.8, 0, 1.1, 0));
  sbRoof(g, 3.6, 3.0, 2.6, accent);
  g.add(mesh(G.box, mat(0x6a6862), 1.0, 1.4, 0.1, 0, 0.7, 1.42));
  g.add(mesh(G.box, mat(accent), 1.8, 0.35, 0.12, 0, 2.0, 1.45));
  // 노렌 느낌
  g.add(mesh(G.box, mat(accent, {transparent: true, opacity: 0.85}), 2.2, 0.7, 0.06, 0, 1.85, 1.48, false));
}

function sbFoodMonja(g) {
  sbFoodBase(g, 0xc0392b);
  // 철판
  g.add(mesh(G.box, mat(0x4a4a48, {metalness: 0.5, roughness: 0.4}), 1.6, 0.12, 1.2, 0, 0.95, 2.2));
  g.add(mesh(G.box, mat(0x2c2c2a), 1.8, 0.55, 0.9, 0, 0.5, 2.2));
}

function sbFoodMatcha(g) {
  sbFoodBase(g, 0x5a8f4a);
  g.add(mesh(G.cone, mat(0x6a9c5f), 0.45, 0.9, 0.45, 1.4, 1.5, 1.6));
  g.add(mesh(G.cyl, mat(0xffffff), 0.35, 0.25, 0.35, 1.4, 0.95, 1.6));
}

function sbFoodYaki(g) {
  sbFoodBase(g, 0x8b3a2a);
  g.add(mesh(G.box, mat(0x3a3a38, {metalness: 0.4}), 1.5, 0.15, 1.0, 0, 1.0, 2.1));
  g.add(mesh(G.sph, mat(0xffffff, {transparent: true, opacity: 0.3}), 0.4, 0.55, 0.4, 0, 1.6, 2.1, false));
}

function sbFoodRamen(g) {
  sbFoodBase(g, 0xe8734a);
  g.add(mesh(G.cyl, mat(0xffffff), 0.4, 0.25, 0.4, 1.2, 1.0, 1.7));
  g.add(mesh(G.cyl, mat(0xe8d5a8), 0.32, 0.12, 0.32, 1.2, 1.15, 1.7));
}

function sbFoodSushi(g) {
  sbFoodBase(g, 0x2c5aa0);
  for (let i = 0; i < 3; i++) {
    g.add(mesh(G.box, mat(0xffffff), 0.35, 0.18, 0.25, -0.5 + i * 0.5, 1.05, 2.0));
    g.add(mesh(G.box, mat(0xe8734a), 0.35, 0.1, 0.22, -0.5 + i * 0.5, 1.18, 2.0));
  }
}

function sbFoodHoto(g) {
  sbFoodBase(g, 0xc9a24b);
  g.add(mesh(G.cyl, mat(0xf5efe4), 0.45, 0.3, 0.45, 1.1, 1.0, 1.7));
  g.add(mesh(G.cyl, mat(0xc9a24b), 0.38, 0.18, 0.38, 1.1, 1.18, 1.7));
}

function sbFood(g) { sbFoodBase(g, 0xc0392b); }

const STOP_BUILD = {
  hotel: sbHotel, onsen: sbOnsen, temple: sbTemple, park: sbPark, market: sbMarket,
  elec: sbElec, museum: sbMuseum, amuse: sbAmuse, beach: sbBeach, conveni: sbConveni,
  ropeway: sbRopeway, taxi: sbTaxi, airport: sbAirport, bus: sbBus, palace: sbPalace,
  shop: sbShop, food: sbFood, foodMonja: sbFoodMonja, foodMatcha: sbFoodMatcha,
  foodYaki: sbFoodYaki, foodRamen: sbFoodRamen, foodSushi: sbFoodSushi, foodHoto: sbFoodHoto
};

function addLodDetails(kind, near) {
  // 가까이서만 보이는 창문·간판·소품
  const win = mat(0x9ec4e0, {metalness: 0.25, roughness: 0.4});
  const wood = mat(0xa67c52);
  const ink = mat(0x3a352e);
  const paper = mat(0xf5efe4);
  const goldM = mat(0xd4a84b);
  const red = mat(0xc0392b);

  if (/hotel|palace|museum|elec|shop|food|onsen|temple|amuse|conveni|airport/.test(kind)) {
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 3; col++) {
        near.add(mesh(G.box, win, 0.38, 0.42, 0.06,
          -0.95 + col * 0.95, 1.15 + row * 0.85, 1.55));
      }
    }
  }
  // 간판
  near.add(mesh(G.box, paper, 1.6, 0.45, 0.08, 0, 2.55, 1.62));
  near.add(mesh(G.box, red, 1.35, 0.28, 0.06, 0, 2.55, 1.68));
  // 노렌 / 문발
  if (/food|temple|onsen|shop|conveni/.test(kind)) {
    [-0.55, 0, 0.55].forEach(dx => {
      near.add(mesh(G.box, mat(kind === 'foodMatcha' ? 0x5a8f4a : 0xc0392b, {transparent: true, opacity: 0.8}),
        0.48, 0.75, 0.04, dx, 1.55, 1.5, false));
    });
  }
  // 화분·랜턴
  near.add(mesh(G.cyl, wood, 0.22, 0.35, 0.22, -1.7, 0.2, 1.8));
  near.add(mesh(G.ico, mat(0x6a9c5f, {flatShading: true}), 0.35, 0.4, 0.35, -1.7, 0.55, 1.8));
  if (/temple|onsen|palace|park/.test(kind)) {
    near.add(mesh(G.cyl, ink, 0.08, 1.4, 0.08, 1.8, 0.9, 1.6));
    near.add(mesh(G.box, mat(0xe8734a), 0.45, 0.55, 0.45, 1.8, 1.7, 1.6));
    near.add(mesh(G.box, goldM, 0.5, 0.08, 0.5, 1.8, 2.0, 1.6));
  }
  if (kind === 'park' || kind === 'beach') {
    // 벤치·쓰레기통·안내판
    near.add(mesh(G.box, wood, 1.5, 0.15, 0.4, 1.5, 0.5, 0.5));
    near.add(mesh(G.box, wood, 1.5, 0.4, 0.1, 1.5, 0.75, 0.3));
    near.add(mesh(G.cyl, ink, 0.07, 1.5, 0.07, -1.8, 0.75, -0.5));
    near.add(mesh(G.box, paper, 0.7, 0.5, 0.06, -1.8, 1.6, -0.5));
  }
  if (kind === 'elec') {
    const neon = [0xe74c3c, 0xf1c40f, 0x3498db];
    for (let i = 0; i < 5; i++) {
      near.add(mesh(G.box, mat(neon[i % 3], {emissive: neon[i % 3], emissiveIntensity: 0.5}),
        0.9, 0.22, 0.08, -1.5 + (i % 3) * 1.5, 2.2 + Math.floor(i / 3) * 0.8, 1.0));
    }
  }
  if (kind === 'market') {
    for (let i = 0; i < 4; i++) {
      near.add(mesh(G.box, mat(0xe8734a), 0.35, 0.35, 0.35, -1.8 + i * 1.15, 0.55, 1.5));
      near.add(mesh(G.sph, mat(0xf4d35e), 0.18, 0.18, 0.18, -1.8 + i * 1.15, 0.85, 1.5));
    }
  }
  if (/foodYaki|foodMonja|foodRamen|foodSushi|foodHoto|foodMatcha|food/.test(kind)) {
    near.add(mesh(G.cyl, mat(0xffffff), 0.12, 0.9, 0.12, 1.55, 1.6, 1.3));
    near.add(mesh(G.box, mat(0xc0392b), 0.55, 0.35, 0.08, 1.55, 2.15, 1.3));
  }
}

function addStopBuilding(stop, p, kindOverride, scale = 1, ui = 0) {
  const kind = kindOverride || inferStopKind(stop);
  const fn = STOP_BUILD[kind] || sbShop;
  const g = new THREE.Group();
  fn(g);
  const near = new THREE.Group();
  near.name = 'lodNear';
  near.visible = false;
  addLodDetails(kind, near);
  g.add(near);
  g.userData.lodNear = near;   // 매 프레임 getObjectByName 으로 훑지 않도록 캐싱
  g.scale.setScalar(scale);
  // 핀이 앞쪽에 오도록 건물 살짝 뒤로
  g.position.set(p.x, 0, p.z - 1.6 * scale);
  g.rotation.y = rnd(-0.15, 0.15);
  g.userData.stopKind = kind;
  g.userData.stopBuilding = true;
  g.userData.ci = ui;
  world.add(g);
  stopBuildings.push(g);
  shadowSpots.push([g.position.x, g.position.z, 2.6 * scale]);
  return kind;
}


export {
  GLB, preloadGlbs, fitGlb, addGlbBuilding, buildGlbPagoda,
  addTree, addBuildingPrim, addPerson, planeModel, addCruisers,
  LM, inferStopKind, STOP_BUILD, addLodDetails, addStopBuilding
};
