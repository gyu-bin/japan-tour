import * as THREE from 'three';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DAYS, haversineKm, projectDay, dayTotalKm } from './data.js';
import { buildTile, freeSpots, stopOffset } from './osm-tile.js';
import {
  sceneEl, scene, renderer, labelRenderer, AR, viewSize, camera, world,
  G, rnd, pick, mat, mesh, SHADOW_TEX, shadowSpots,
  initCore, disposeCore
} from './core.js';
import { applyLight, glowLevel, shadowLevel, setShadowMesh, setSeaMesh, resetLightTargets, initLights, disposeLights } from './lighting.js';
import {
  GLB, preloadGlbs, fitGlb, addGlbBuilding, addTree, addBuildingPrim, addPerson,
  addCruisers, LM, inferStopKind, addStopBuilding,
  peoples, stopBuildings, flyers, resetScenery
} from './scenery.js';
import { declutterChips } from './labels.js';
import { buildTransit, tickTrains, trains, stationLabels, resetTransit } from './transit.js';

/* ============ 실제 지도 조각 ============
 * tools/fetch-osm.py 가 구워 둔 정적 파일만 읽는다. 런타임 네트워크 조회 없음.
 * 매니페스트나 조각 로드가 실패하면 tileOf() 가 null 을 돌려주고
 * 디오라마는 예전처럼 단순 잔디 원판으로 그려진다 (기능은 안 죽는다).
 */
let TILE_MANIFEST = [];
const TILE_CACHE = new Map();

async function loadTileManifest() {
  try {
    const r = await fetch('/assets/osm/tiles.json');
    if (!r.ok) throw new Error('HTTP ' + r.status);
    TILE_MANIFEST = await r.json();
  } catch (e) {
    console.warn('지도 조각 매니페스트 없음 — 잔디 원판으로 그립니다', e);
    TILE_MANIFEST = [];
  }
}

/** 스팟이 속한 조각 (가장 가까운, 반경 안의 것) */
function tileOf(lat, lng) {
  let best = null, bestD = Infinity;
  for (const t of TILE_MANIFEST) {
    const d = haversineKm({ lat, lng }, t) * 1000;
    if (d <= t.r && d < bestD) { best = t; bestD = d; }
  }
  return best;
}

async function loadTiles(ids) {
  await Promise.all(ids.map(async id => {
    if (TILE_CACHE.has(id)) return;
    try {
      const r = await fetch(`/assets/osm/tile-${id}.json`);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      TILE_CACHE.set(id, await r.json());
    } catch (e) {
      console.warn('조각 로드 실패', id, e);
      TILE_CACHE.set(id, null);
    }
  }));
}





/* ============ 실측 km → 디오라마 유닛 ============
 * 원칙 하나: 중심에서 본 방위각은 절대 건드리지 않는다. 반경만 조정한다.
 * 그래서 "북동쪽에 있는 곳은 화면에서도 북동쪽"이 항상 성립한다.
 *
 *   1) projectDay() 로 실측 km + 60m 클러스터를 받는다
 *   2) 스팟이 모여 있는 코어 반경을 SPAN*0.42 에 맞춘다
 *   3) 코어 밖 이상치(예: Day 05 신주쿠 70km)는 방위를 유지한 채 반경만 눌러 화면에 넣는다
 *   4) 클러스터끼리 너무 붙으면 반경만 벌린다 — 역시 방위는 고정
 *
 * 옛 구현이 하던 "가까운 스팟을 강제로 5.5유닛 떼어놓기"는 없앴다.
 * 같은 건물인 모리미술관·도쿄 시티뷰를 40배 벌려 지도를 망가뜨리던 원인이었다.
 */
const CORE_FRAC = 0.42;   // 코어 조각이 놓이는 반경 (SPAN 대비)
const EDGE_FRAC = 0.58;   // 이상치가 눌려 들어가는 바깥 한계
const FAN_R = 1.25;       // 지도 조각이 없을 때 같은 지점 스팟들의 핀 부채꼴 반경
const TILE_FRAC = 0.22;   // 중간 크기 조각의 목표 반경 (SPAN 대비).
                          // 작으면 도로가 1픽셀 밑으로 내려가 안 보인다 — 조각이 주인공이다.
const TILE_PAD = 1.12;    // 조각끼리 이만큼은 떨어뜨린다

/* 스팟을 실제 지도 조각에 배정한다.
 * 조각이 없는 스팟(매니페스트 로드 실패, 데이터 없는 산속 등)은
 * 60m 클러스터를 그대로 쓰는 '맨 유닛'이 된다 — 예전 동작으로 자연스럽게 폴백. */
function assignUnits(day, proj) {
  const units = [];
  const unitOf = new Array(day.stops.length).fill(-1);

  day.stops.forEach((s, i) => {
    const t = tileOf(s.lat, s.lng);
    let ui = t
      ? units.findIndex(u => u.id === t.id)
      : units.findIndex(u => u.id === null && u.ci === proj.stops[i].ci);
    if (ui < 0) {
      units.push(t
        ? { id: t.id, lat: t.lat, lng: t.lng, r: t.r, members: [] }
        : { id: null, ci: proj.stops[i].ci, lat: s.lat, lng: s.lng, r: 140, members: [] });
      ui = units.length - 1;
    }
    unitOf[i] = ui;
    units[ui].members.push(i);
  });

  // 랜드마크: 조각 안에 들어가면 그 조각에 얹고, 아니면 독립 유닛
  let lmUnit = -1;
  if (day.lm) {
    const t = tileOf(day.lm.lat, day.lm.lng);
    lmUnit = t ? units.findIndex(u => u.id === t.id) : -1;
    if (lmUnit < 0) {
      units.push({ id: t ? t.id : null, lat: day.lm.lat, lng: day.lm.lng,
                   r: t ? t.r : 160, members: [], landmarkOnly: true });
      lmUnit = units.length - 1;
    }
  }
  return { units, unitOf, lmUnit };
}

function layoutDay(di) {
  const day = DAYS[di];
  const SPAN = day.layoutSpan ?? 50;
  const proj = projectDay(day);

  const { units, unitOf, lmUnit } = assignUnits(day, proj);

  // 조각 안의 축척 (디오라마 유닛 / 실제 미터).
  // 중간 크기 조각이 SPAN*TILE_FRAC 반경으로 보이게 맞춘다.
  const rsM = units.map(u => u.r).slice().sort((a, b) => a - b);
  const medR = rsM[Math.floor(rsM.length / 2)] || 300;
  const mag = (SPAN * TILE_FRAC) / medR;

  // 조각 중심을 극좌표로 (a = 방위, r = 기준점에서의 거리 km)
  const kx = 111.32 * Math.cos(proj.centroid.lat * Math.PI / 180), kz = 110.54;
  const toKm = p => ({ x: (p.lng - proj.centroid.lng) * kx, z: -(p.lat - proj.centroid.lat) * kz });
  const O = proj.center;
  const polarOf = p => {
    const q = toKm(p);
    return { a: Math.atan2(q.z - O.z, q.x - O.x), r: Math.hypot(q.x - O.x, q.z - O.z) };
  };
  const polar = units.map(polarOf);

  // 코어 반경 = 조각 반경의 75퍼센타일. 이상치 하나에 축척이 끌려가지 않게.
  const rs = polar.map(p => p.r).slice().sort((a, b) => a - b);
  const core = Math.max(rs[Math.floor(rs.length * 0.75)] || 0, 0.03);
  const unitsPerKm = (SPAN * CORE_FRAC) / core;

  const rMaxKm = Math.max(...polar.map(p => p.r), 0);
  const C = SPAN * CORE_FRAC;
  const overMaxU = rMaxKm * unitsPerKm - C;

  // 방위 유지, 반경만 압축
  const squash = r => {
    const u = r * unitsPerKm;
    if (u <= C || overMaxU <= 0.01) return u;
    return C + (SPAN * EDGE_FRAC - C) * Math.pow((u - C) / overMaxU, 0.55);
  };

  // 조각 축척에 맞춘 모형 크기 (건물·랜드마크). 여기서 정해야 자리싸움 계산도 맞는다.
  const bScale = Math.max(0.32, Math.min(1, mag * 1000 * 0.026));
  const isFujiLm = day.landmark === 'fuji';
  const lmScale = (isFujiLm ? 1.15 : 1.25) * (isFujiLm ? 1 : Math.max(0.42, bScale * 0.85));
  const lmR = ((LM_SIZE[day.landmark] || [10, 16])[0]) * lmScale;

  // 조각은 자기 반지름만큼 자리를 차지한다 — 겹치면 방위 유지한 채 반경만 벌린다.
  // 랜드마크가 얹힌 조각은 모형이 조각보다 클 수 있다 (후지산은 실제로 20km 짜리다).
  const pts = polar.map((p, i) => ({
    a: p.a, r: squash(p.r),
    gap: Math.max(units[i].r * mag * 2 * TILE_PAD,
                  i === lmUnit ? lmR * 2 * 1.15 : 0)
  }));

  for (let it = 0; it < 60; it++) {
    let moved = false;
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        const need = (pts[i].gap + pts[j].gap) / 2;
        const xi = Math.cos(pts[i].a) * pts[i].r, zi = Math.sin(pts[i].a) * pts[i].r;
        const xj = Math.cos(pts[j].a) * pts[j].r, zj = Math.sin(pts[j].a) * pts[j].r;
        const d = Math.hypot(xj - xi, zj - zi);
        if (d >= need) continue;
        const push = (need - d) / 2;
        const [inner, outer] = pts[i].r <= pts[j].r ? [pts[i], pts[j]] : [pts[j], pts[i]];
        inner.r = Math.max(0, inner.r - push);
        outer.r += push;
        moved = true;
      }
    }
    if (!moved) break;
  }

  const toXZ = p => ({ x: Math.cos(p.a) * p.r, z: Math.sin(p.a) * p.r });
  let unitPts = pts.map(toXZ);
  const ox = unitPts.reduce((s, p) => s + p.x, 0) / unitPts.length;
  const oz = unitPts.reduce((s, p) => s + p.z, 0) / unitPts.length;
  unitPts = unitPts.map(p => new THREE.Vector3(p.x - ox, 0, p.z - oz));

  // 스팟은 조각 안에서 '실제 위치'에 놓인다 — 여기가 축척 두 개 중 정밀한 쪽
  const stopPts = day.stops.map((s, i) => {
    const u = units[unitOf[i]];
    const c = unitPts[unitOf[i]];
    if (u.id) {
      const [dx, dz] = stopOffset(s.lat, s.lng, u.lat, u.lng, mag);
      return new THREE.Vector3(c.x + dx, 0, c.z + dz);
    }
    // 지도 조각이 없는 유닛: 예전처럼 부채꼴로 벌린다
    const k = u.members.indexOf(i);
    if (u.members.length === 1) return c.clone();
    const a = (k / u.members.length) * Math.PI * 2 - Math.PI / 2;
    return new THREE.Vector3(c.x + Math.cos(a) * FAN_R, 0, c.z + Math.sin(a) * FAN_R);
  });

  let lmPt = null;
  if (day.lm && lmUnit >= 0) {
    const u = units[lmUnit];
    const c = unitPts[lmUnit];
    const [dx, dz] = u.id
      ? stopOffset(day.lm.lat, day.lm.lng, u.lat, u.lng, mag)
      : [0, 0];
    lmPt = new THREE.Vector3(c.x + dx, 0, c.z + dz);
  }

  const trueMaxU = rMaxKm * unitsPerKm;
  const shownMaxU = squash(rMaxKm);
  const compression = shownMaxU > 0.01 ? trueMaxU / shownMaxU : 1;

  return {
    proj, units, unitOf, unitPts, lmUnit, stopPts, lmPt,
    mag, unitsPerKm, compression, bScale, lmScale,
    // 미니맵·격리 로직이 쓰던 이름들 — 이제 '유닛'이 그 자리를 대신한다
    clusterPts: unitPts, clusters: units
  };
}

/* ============ 디오라마 빌더 ============ */
let markers = [];   // {group, chipEl, label, stop, idx, pos, pin}
let roadCurve = null;
let landmarkGroup = null;
let stopCi = [];        // 스팟 인덱스 → 클러스터 번호
let dayLayout = null;   // 현재 일차의 실측 배치 결과
let lmLabel = null;     // 랜드마크 CSS2D 라벨 (직접 껐다 켜야 한다)
let lightOverride = null;  // 사용자가 고른 시간대. null 이면 일정 시각을 따른다
let clouds = [];        // 애니메이션 대상만 모아둔다
let spinners = [];      // {o, spd} — 관람차류

function disposeWorld() {
  world.traverse(n => {
    if (n.isCSS2DObject) n.element.remove();
    if (n.geometry && !Object.values(G).includes(n.geometry)) n.geometry.dispose();
    if (n.material) (Array.isArray(n.material) ? n.material : [n.material]).forEach(m => m.dispose());
  });
  world.clear();
  resetScenery();
  resetLightTargets();
  resetTransit();
  markers = [];
  stopCi = [];
  landmarkGroup = null;
  lmLabel = null;
  clouds = [];
  spinners = [];
}

function buildRoad(points) {
  // 같은 자리를 연달아 지나면 접선이 0 벡터가 되어 삼각형이 터진다 (화면에 가시 같은 게 뻗친다)
  const clean = [];
  for (const p of points) {
    const last = clean[clean.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.z - last.z) > 0.05) clean.push(p.clone());
  }
  if (clean.length < 2) clean.push(clean[0].clone().add(new THREE.Vector3(0.1, 0, 0.1)));

  const curve = new THREE.CatmullRomCurve3(clean);
  const samples = curve.getPoints(220);
  const W = 2.4;
  const pos = [], idx = [];
  let prevN = { x: 0, z: 1 };
  for (let i = 0; i < samples.length; i++) {
    const p = samples[i];
    const t2 = samples[Math.min(i + 1, samples.length - 1)].clone().sub(samples[Math.max(i - 1, 0)]);
    let nx, nz;
    if (t2.lengthSq() < 1e-8) { nx = prevN.x; nz = prevN.z; }   // 접선이 없으면 직전 법선을 잇는다
    else { t2.normalize(); nx = -t2.z; nz = t2.x; prevN = { x: nx, z: nz }; }
    pos.push(p.x + nx * W, 0.06, p.z + nz * W, p.x - nx * W, 0.06, p.z - nz * W);
  }
  for (let i = 0; i < samples.length - 1; i++) {
    const a = i * 2;
    idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const road = new THREE.Mesh(g, mat(0xf8f4ea));
  road.receiveShadow = true;
  road.userData.fill = true;   // 클로즈업에서는 접는다
  world.add(road);
  return curve;
}

/* ---- 스팟별 건물 (공원·식당·숙소·역 등) ---- */
/* ---- 마커(핀 + 칩) ----
 * tier: 같은 지점(클러스터)에 묶인 스팟의 순번. 라벨을 층층이 띄워 겹치지 않게 한다. */
function addMarker(stop, i, p, tier = 0) {
  const g = new THREE.Group();
  const col = stop.eat ? 0xc0392b : 0xe8734a;
  const pin = new THREE.Group();
  const head = mesh(G.sph, mat(col, {roughness: 0.55}), 0.55, 0.55, 0.55, 0, 2.15, 0);
  const tip = mesh(G.cone, mat(col, {roughness: 0.55}), 0.34, 1.0, 0.34, 0, 1.35, 0);
  tip.rotation.x = Math.PI;
  pin.add(head, tip);
  pin.name = 'pin';
  g.add(pin);
  const disc = new THREE.Mesh(new THREE.CircleGeometry(1.15, 26),
    new THREE.MeshBasicMaterial({color: col, transparent: true, opacity: 0.22, depthWrite: false}));
  disc.rotation.x = -Math.PI / 2;
  disc.position.y = 0.08;
  g.add(disc);

  const el = document.createElement('div');
  el.className = 'pinChip' + (stop.eat ? ' eat' : '');
  el.innerHTML = `<span class="no">${i + 1}</span>${stop.name}`;
  el.addEventListener('click', e => { e.stopPropagation(); selectStop(i, true); });
  el.addEventListener('dblclick', e => {
    e.stopPropagation();
    e.preventDefault();
    enterCloseUp(i);
  });
  const lbl = new CSS2DObject(el);
  lbl.position.set(0, 3.1 + tier * 1.5, 0);
  g.add(lbl);

  g.position.copy(p);
  world.add(g);
  markers.push({group: g, chipEl: el, label: lbl, stop, idx: i, pos: p.clone(), pin, tier});
}

function buildDiorama(day) {
  disposeWorld();
  applyLight(lightOverride || day.light);

  const layout = layoutDay(dayIdx);
  const { stopPts, unitPts, units, unitOf, mag, bScale, lmScale } = layout;
  dayLayout = layout;

  // ---- 한 장의 땅 ----
  // 조각을 섬으로 떼어놓지 않는다. 하나로 이어진 대지 위에 지도 무늬를 얹고,
  // 조각 사이는 연한 언덕·숲으로 메운다 (그 사이 땅은 실측이 아니고, 그건 미니맵의 압축률 표기가 말해 준다).
  const landR = Math.max(
    ...unitPts.map((p, i) => Math.hypot(p.x, p.z) + (units[i].r * mag)),
    layout.lmPt ? Math.hypot(layout.lmPt.x, layout.lmPt.z) + 18 : 0
  ) + 10;
  // 정원(正圓)이면 접시 위에 올려놓은 것처럼 보인다. 굴곡을 줘서 해안선처럼 만든다.
  // 일차마다 고정된 모양이 나오도록 시드를 쓴다 (다시 지어도 흔들리지 않는다).
  const landShape = (R, seed) => {
    let s = seed * 9301 + 49297;
    const rr = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
    const p1 = rr() * 6.28, p2 = rr() * 6.28, p3 = rr() * 6.28;
    const shape = new THREE.Shape();
    const N = 128;
    for (let i = 0; i <= N; i++) {
      const a = (i / N) * Math.PI * 2;
      const k = 1
        + 0.20 * Math.sin(a * 2 + p1)
        + 0.11 * Math.sin(a * 3 + p2)
        + 0.06 * Math.sin(a * 5 + p3);
      const x = Math.cos(a) * R * k, y = Math.sin(a) * R * k;
      if (i === 0) shape.moveTo(x, y); else shape.lineTo(x, y);
    }
    shape.closePath();
    const g = new THREE.ShapeGeometry(shape, 12);
    g.rotateX(-Math.PI / 2);
    return g;
  };

  // 바다 — 땅 바깥은 허공이 아니라 물이다. 이게 없으면 땅이 계속 떠 보인다.
  const sea = new THREE.Mesh(new THREE.CircleGeometry(landR * 2.2, 64),
    mat(0xa9c6d4, { roughness: 0.35, metalness: 0.1 }));
  sea.rotation.x = -Math.PI / 2;
  sea.position.y = -1.2;
  sea.frustumCulled = false;
  sea.userData.land = true;
  world.add(sea);
  setSeaMesh(sea);

  // 물가 — 땅보다 조금 크게 깔아 육지에서 물로 한 단계 물러나게 한다
  const shore = new THREE.Mesh(landShape(landR * 1.09, dayIdx + 7), mat(0xd8dcc2));
  shore.position.y = -0.5;
  shore.userData.land = true;
  world.add(shore);

  const land = new THREE.Mesh(landShape(landR, dayIdx + 1), mat(0xd3dab6));
  land.receiveShadow = true;
  land.userData.land = true;
  world.add(land);

  // 완만한 지형 결 — 톤이 살짝 다른 넓은 원판 몇 장 (레퍼런스의 언덕 느낌)
  for (let i = 0; i < 14; i++) {
    const a = rnd(0, Math.PI * 2), d = rnd(0.25, 0.95) * landR;
    const hill = new THREE.Mesh(new THREE.CircleGeometry(rnd(landR * 0.14, landR * 0.3), 32),
      mat(pick([0xcbd3ad, 0xdae0c2, 0xc5cea6])));
    hill.rotation.x = -Math.PI / 2;
    hill.position.set(Math.cos(a) * d, 0.012 + i * 0.001, Math.sin(a) * d);
    hill.userData.fill = true;
    world.add(hill);
  }

  // ---- 실제 지도 무늬를 그 위에 얹는다 ----
  units.forEach((u, ui) => {
    const data = u.id ? TILE_CACHE.get(u.id) : null;
    const p = unitPts[ui];
    const r = Math.max(4, u.r * mag);
    let g;
    if (data) {
      g = buildTile(data, { mag, roadMul: 3.2 });
      g.add(buildTransit(data, { mag, roadMul: 3.2 }));
    } else {
      // 조각 데이터가 없으면 그냥 땅에 맡긴다 (연한 녹지 한 장만)
      g = new THREE.Group();
      const disk = new THREE.Mesh(new THREE.CircleGeometry(r * 0.8, 36), mat(0xd2dcb6));
      disk.rotation.x = -Math.PI / 2;
      disk.position.y = 0.03;
      g.add(disk);
      g.userData.radius = r;
    }
    g.position.copy(p);
    g.position.y = 0.02;
    g.userData.ci = ui;          // 클로즈업 격리에서 이 유닛의 것으로 취급
    world.add(g);
    u.group = g;
    u.drawnR = g.userData.radius ?? r;
  });

  // 산책로는 조각 중심을 방문 순서대로 잇는다 (같은 조각 왕복은 한 점으로)
  const routePts = [];
  day.stops.forEach((s, i) => {
    const ui = unitOf[i];
    if (routePts.length === 0 || routePts[routePts.length - 1].ui !== ui) {
      routePts.push({ ui, p: unitPts[ui] });
    }
  });
  roadCurve = buildRoad(routePts.length >= 2 ? routePts.map(r => r.p) : stopPts);

  const theme = day.theme || 'asakusa';
  const isFuji = day.landmark === 'fuji';
  const isOdaiba = theme === 'odaiba';

  // 랜드마크: 실제 위경도를 스팟과 같은 투영에 태운다 (더 이상 추정하지 않는다)
  landmarkGroup = new THREE.Group();
  LM[day.landmark](landmarkGroup);
  const lmPos = layout.lmPt ? layout.lmPt.clone() : new THREE.Vector3(0, 0, -(day.layoutSpan ?? 50) * 0.5);
  const lmClear = isFuji ? 26 : 16;
  landmarkGroup.position.copy(lmPos);
  // 조각 위에 서므로 조각 축척을 따라간다 (layoutDay 에서 이미 계산했다)
  landmarkGroup.scale.setScalar(lmScale);
  landmarkGroup.userData.ci = layout.lmUnit;
  world.add(landmarkGroup);
  const lmEl = document.createElement('div');
  lmEl.className = 'lmChip';
  lmEl.innerHTML = day.lmJp
    ? `${day.lmName}<span class="jp">${day.lmJp}</span>`
    : day.lmName;
  const lmLbl = new CSS2DObject(lmEl);
  const labelY = ({ pagoda: 16, wheel: 18, tower: 24, fuji: 14, plane: 8 })[day.landmark] || 14;
  lmLbl.position.set(0, labelY * 1.05, 0);   // 그룹 스케일이 적용되므로 모형 높이 기준 그대로
  landmarkGroup.add(lmLbl);
  lmLabel = lmLbl;

  // ---- 스팟 건물: 조각 위 '실제 위치'에 얹는다 ----
  units.forEach((u, ui) => {
    if (!u.members.length) return;
    // 묶인 스팟 중 '큰' 종류를 대표로 — 미술관+식당이면 미술관이 이긴다
    const kinds = u.members.map(m => inferStopKind(day.stops[m]));
    const big = kinds.find(k => /park|beach|temple|elec|museum|palace|onsen|airport|amuse/.test(k));
    u.members.forEach((m, k) => {
      // 조각이 있으면 스팟마다 제 자리에, 없으면 대표 하나만
      if (!u.id && k > 0) return;
      addStopBuilding(day.stops[m], stopPts[m],
        u.id ? inferStopKind(day.stops[m]) : (big || kinds[0]), bScale, ui);
    });
  });

  // ---- 배경 채움: 조각 위 도로에서 떨어진 빈 자리에만 ----
  const skyChance = theme === 'odaiba' || theme === 'roppongi' ? 0.16 : 0.03;
  units.forEach((u, ui) => {
    const data = u.id ? TILE_CACHE.get(u.id) : null;
    const p = unitPts[ui];
    if (!data) return;
    const spots = freeSpots(data, { mag, clearM: 24, stepM: 52 });
    const taken = u.members.map(m => stopPts[m]);
    for (const [sx, sz] of spots) {
      const x = p.x + sx, z = p.z + sz;
      if (taken.some(t => Math.hypot(t.x - x, t.z - z) < 4.5)) continue;
      if (layout.lmPt && Math.hypot(layout.lmPt.x - x, layout.lmPt.z - z) < (isFuji ? 26 : 13)) continue;
      const roll = Math.random();
      if (roll < 0.55) addGlbBuilding(x, z, Math.random() < skyChance, theme, bScale);
      else if (roll < 0.82) addTree(x, z, rnd(0.5, 0.9) * bScale * 2.2);
    }
  });

  // 사람들
  for (let i = 0; i < 16; i++) addPerson(roadCurve);

  // 상공 순항기 — 하네다 일차가 아니어도 하늘이 비어 있지 않게
  addCruisers(2, landR);

  // 구름
  for (let i = 0; i < 6; i++) {
    const c = new THREE.Group();
    const n = 3 + (Math.random() * 3 | 0);
    for (let k = 0; k < n; k++) {
      c.add(mesh(G.sph, mat(0xffffff, {roughness: 1}), rnd(1.6, 2.8), rnd(1, 1.5), rnd(1.4, 2.2),
        k * rnd(1.4, 2.2) - n, rnd(-0.3, 0.3), rnd(-0.6, 0.6), false));
    }
    c.position.set(rnd(-50, 50), rnd(24, 34), rnd(-50, 50));
    c.name = 'cloud';
    c.userData.spd = rnd(0.3, 0.8);
    world.add(c);
    clouds.push(c);
  }

  // 회전 장식 수집 (대관람차 · 미니 관람차)
  const lmWheelObj = landmarkGroup.getObjectByName('wheelSpin');
  if (lmWheelObj) spinners.push({ o: lmWheelObj, spd: 0.25 });
  stopBuildings.forEach(g => {
    const mw = g.getObjectByName('miniWheel');
    if (mw) spinners.push({ o: mw, spd: 0.6 });
  });

  // 접지 그림자를 한 덩어리로 (건물·나무마다 모아 둔 자리)
  if (shadowSpots.length) {
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.rotateX(-Math.PI / 2);
    const im = new THREE.InstancedMesh(geo,
      new THREE.MeshBasicMaterial({
        map: SHADOW_TEX, transparent: true, depthWrite: false, opacity: shadowLevel
      }), shadowSpots.length);
    const mtx = new THREE.Matrix4();
    shadowSpots.forEach(([x, z, r], i) => {
      mtx.makeScale(r * 2, 1, r * 2);
      mtx.setPosition(x, 0.16, z);
      im.setMatrixAt(i, mtx);
    });
    im.instanceMatrix.needsUpdate = true;
    im.renderOrder = 2;
    im.userData.fill = true;
    world.add(im);
    setShadowMesh(im);
  }

  // 마커 — 좌표는 실측 그대로. 조각이 없어 같은 자리에 겹치는 경우만 라벨을 층으로 띄운다.
  stopCi = unitOf.slice();
  day.stops.forEach((s, i) => {
    const u = units[unitOf[i]];
    const tier = (!u.id && u.members.length > 1) ? u.members.indexOf(i) : 0;
    addMarker(s, i, stopPts[i].clone(), tier);
  });
}

/* ============ 카메라 ============ */
// 세로 화면에서는 하루 전체를 담으려면 0.5 로는 부족하다 (fitZoomForDay 가 바닥에 걸려 화면 밖으로 넘쳤다)
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 5.0;
const ZOOM_OVERVIEW = 0.68;
const ZOOM_SPOT = 2.05;
const ZOOM_CLOSE = 3.6;
const LOD_ZOOM = 1.55;

const cam = {
  az: Math.PI * 0.28, el: 0.62,
  zoom: ZOOM_OVERVIEW, zoomTarget: ZOOM_OVERVIEW,
  focus: new THREE.Vector3(), focusTarget: new THREE.Vector3()
};
let viewMode = 'day'; // day | spot | close
let zoomBadgeTimer = 0;
let sheetShownPx = 84;   // 화면에 실제로 보이는 시트 높이 (애니메이션 추종값)

// NaN 이 한 번 들어오면 프로젝션 행렬이 영영 복구되지 않는다. 여기서 막는다.
function clampZoom(z) {
  return Number.isFinite(z) ? Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z)) : ZOOM_OVERVIEW;
}

function setZoomTarget(z, showBadge = true) {
  cam.zoomTarget = clampZoom(z);
  if (showBadge) flashZoomBadge();
}

function flashZoomBadge() {
  const el = document.getElementById('zoomBadge');
  if (!el) return;
  el.textContent = `×${cam.zoomTarget.toFixed(1)}`;
  el.classList.add('show');
  zoomBadgeTimer = 1.4;
}

/* UI 에 가려지지 않는 영역 — 카메라는 이 사각형 안에 하루를 담는다.
 * 모바일에서는 시트 높이(--sh)를 따라 실시간으로 줄었다 늘었다 한다. */
/* useTarget=true 면 시트가 다 열렸을 때 기준으로 계산한다.
 * 줌 맞추기는 최종 상태를 봐야 하고, 화면 중심 이동은 애니메이션을 따라가야 한다. */
function safeRect(useTarget = false) {
  // 숨겨진 탭·복원 직후에는 innerWidth 가 0 으로 올 수 있다.
  // 그대로 두면 카메라 행렬이 NaN 이 되고 다시는 복구되지 않는다.
  const W = Math.max(innerWidth || 0, 320);
  const H = Math.max(innerHeight || 0, 320);
  if (W <= 900) {
    const top = 68;                       // 압축된 헤드 카드
    // 시트가 열리고 닫히는 동안 카메라가 뚝 끊기지 않도록 부드럽게 따라간 값을 쓴다
    const bottom = H - ((useTarget ? sheetPx() : sheetShownPx) + 54 + 16);
    return { x0: 12, x1: W - 12, y0: top, y1: Math.max(top + 80, bottom), W, H };
  }
  // 데스크톱: 우측 패널 / 하단 페이저를 피한다
  return { x0: 24, x1: Math.max(W * 0.35, W - 372), y0: 24, y1: H - 92, W, H };
}

/* 안전영역의 중심을 화면 중심 대신 쓰기 위한 NDC 오프셋.
 * ortho 프러스텀을 비대칭으로 만들어 focus 가 안전영역 한가운데 오게 한다. */
function frustumOffset(useTarget = false) {
  const r = safeRect(useTarget);
  return {
    sx: ((r.x0 + r.x1) / 2 / r.W) * 2 - 1,
    sy: 1 - ((r.y0 + r.y1) / 2 / r.H) * 2,
    // 안전영역이 화면에서 차지하는 비율 (NDC 반폭/반높이)
    hw: (r.x1 - r.x0) / r.W,
    hh: (r.y1 - r.y0) / r.H
  };
}

function updateCamera() {
  const d = 90;
  const y = Math.sin(cam.el) * d;
  const r = Math.cos(cam.el) * d;
  camera.position.set(
    cam.focus.x + Math.cos(cam.az) * r,
    y,
    cam.focus.z + Math.sin(cam.az) * r
  );
  camera.lookAt(cam.focus.x, 0, cam.focus.z);

  // 비대칭 프러스텀: focus 가 NDC (sx, sy) 에 오도록.
  // three 는 zoom 을 프러스텀 중심 기준으로 나누므로 오프셋도 zoom 으로 나눠 둔다.
  const { sx, sy } = frustumOffset();
  const hw = viewSize * AR(), hh = viewSize, z = cam.zoom;
  camera.left = -hw - sx * hw / z;
  camera.right = hw - sx * hw / z;
  camera.top = hh - sy * hh / z;
  camera.bottom = -hh - sy * hh / z;
  camera.zoom = z;
  camera.updateProjectionMatrix();
}

/* 랜드마크 모형의 대략적인 크기 (반지름, 높이) — 프레이밍 계산용 */
const LM_SIZE = {
  pagoda: [9, 16], wheel: [11, 18], tower: [8, 26], fuji: [22, 15], plane: [10, 8]
};

/* 하루 전체가 안전영역에 들어오는 줌 — 세로 화면에서도, 높은 랜드마크도 안 잘리게 */
function fitZoomForDay() {
  if (!dayLayout) return ZOOM_OVERVIEW;
  const day = DAYS[dayIdx];
  // 각 조각을 '덩어리'로 본다: 실제 그려진 반지름과 위로 솟은 높이
  const blobs = dayLayout.unitPts.map((p, i) => ({
    p,
    r: dayLayout.units[i].drawnR ?? Math.max(4, dayLayout.units[i].r * dayLayout.mag),
    h: 5
  }));
  if (dayLayout.lmPt) {
    const [lr, lh] = LM_SIZE[day.landmark] || [10, 16];
    const s = dayLayout.lmScale ?? 1;
    blobs.push({ p: dayLayout.lmPt, r: lr * s, h: lh * s });
  }
  if (!blobs.length) return ZOOM_OVERVIEW;

  // 카메라 화면축으로 투영. 높이는 화면 위쪽으로 cos(el) 만큼 솟는다.
  const right = new THREE.Vector3(-Math.sin(cam.az), 0, Math.cos(cam.az));
  const upXZ = new THREE.Vector3(-Math.cos(cam.az), 0, -Math.sin(cam.az)).multiplyScalar(Math.sin(cam.el));
  const hRise = Math.cos(cam.el);
  let ex = 0, ey = 0;
  for (const b of blobs) {
    const sx = b.p.x * right.x + b.p.z * right.z;
    const sy = b.p.x * upXZ.x + b.p.z * upXZ.z;
    ex = Math.max(ex, Math.abs(sx) + b.r);
    ey = Math.max(ey, Math.abs(sy) + b.r, Math.abs(sy) + b.h * hRise);
  }

  const { hw, hh } = frustumOffset(true);   // 시트가 다 열린 상태 기준
  const zx = (hw * viewSize * AR()) / Math.max(ex, 1);
  const zy = (hh * viewSize) / Math.max(ey, 1);
  return clampZoom(Math.min(zx, zy) * 0.9);   // 라벨 칩이 얹힐 여유
}

function applyIsolation() {
  const close = viewMode === 'close';
  const selCi = stopCi[selIdx] ?? -1;
  stopBuildings.forEach(g => {
    g.visible = !close || g.userData.ci === selCi;
  });
  markers.forEach((m, i) => {
    const on = !close || i === selIdx;
    m.group.visible = on;
    // CSS2DObject 는 부모 group 의 visible 을 따르지 않는다. 라벨은 직접 꺼야 한다.
    if (m.label) m.label.visible = on;
    m.chipEl.style.opacity = (!close && i !== selIdx) ? '0.85' : '1';
  });
  world.children.forEach(c => {
    if (c.userData.fill) c.visible = !close;
    if (c.name === 'cloud') c.visible = !close;
    if (c.userData.ci !== undefined) c.visible = !close || c.userData.ci === selCi;
  });
  if (landmarkGroup) landmarkGroup.visible = !close;
  if (lmLabel) lmLabel.visible = !close;
  peoples.forEach(p => { p.g.visible = !close; });
  const btn = document.getElementById('pCloseup');
  if (btn) {
    btn.classList.toggle('on', close);
    btn.textContent = close ? '클로즈업 중' : '여기만 보기';
  }
}

function enterCloseUp(i = selIdx) {
  viewMode = 'close';
  selectStop(i, true, { zoom: ZOOM_CLOSE, mode: 'close' });
  applyIsolation();
}

function exitCloseUp(toSpot = true) {
  viewMode = toSpot ? 'spot' : 'day';
  applyIsolation();
  if (toSpot && markers[selIdx]) {
    cam.focusTarget.copy(markers[selIdx].pos);
    setZoomTarget(ZOOM_SPOT);
  } else {
    cam.focusTarget.set(0, 0, 0);
    setZoomTarget(fitZoomForDay());
  }
}

function updateLod() {
  const showNear = cam.zoom >= LOD_ZOOM || viewMode === 'close';
  // 역 이름은 확대했을 때만 — 항상 띄우면 스팟 핀과 싸운다
  const showStations = cam.zoom >= LOD_ZOOM * 1.15;
  stationLabels.forEach(l => { l.visible = showStations; });
  const selCi = stopCi[selIdx] ?? -1;
  stopBuildings.forEach(g => {
    const near = g.userData.lodNear;
    if (!near) return;
    const ci = g.userData.ci;
    const dist = Math.hypot(g.position.x - cam.focus.x, g.position.z - cam.focus.z);
    near.visible = showNear && (viewMode === 'close' ? ci === selCi : dist < 18 || ci === selCi);
  });
  if (landmarkGroup) {
    let lmNear = landmarkGroup.getObjectByName('lodNear');
    if (!lmNear) {
      lmNear = new THREE.Group();
      lmNear.name = 'lodNear';
      // 랜드마크용 간단 디테일
      for (let i = 0; i < 6; i++) {
        lmNear.add(mesh(G.box, mat(0x9ec4e0, {metalness: 0.2}), 0.5, 0.4, 0.08,
          -2 + (i % 3) * 2, 2 + Math.floor(i / 3) * 2.2, 3.5));
      }
      landmarkGroup.add(lmNear);
    }
    lmNear.visible = cam.zoom >= LOD_ZOOM;
  }
}

let dragging = false, moved = 0, px = 0, py = 0;
const pointers = new Map();
let pinchDist0 = 0, pinchZoom0 = 1;


let panelEl = null;
let grabEl = null;
let pager = null;
let plbl = null;
let rafId = 0;
let running = false;
const cleanups = [];

function on(target, type, handler, opts) {
  if (!target) return;
  target.addEventListener(type, handler, opts);
  cleanups.push(() => target.removeEventListener(type, handler, opts));
}

/* ============ 모바일 하단 시트 (peek / half / full) ============ */
const MOBILE_MQ = matchMedia('(max-width:900px)');   // 매 프레임 matchMedia() 를 새로 만들지 않는다
const isMobile = () => MOBILE_MQ.matches;
let sheetState = 'peek';

/** 현재(또는 지정한) 시트 상태의 실제 높이(px) */
function sheetPx(state = sheetState) {
  if (!isMobile()) return 0;
  const inline = document.body.style.getPropertyValue('--sh');
  if (state === sheetState && inline) return parseFloat(inline);
  if (state === 'half') return innerHeight * 0.44;
  if (state === 'full') return innerHeight * 0.78;
  return 84;
}

function setSheet(state) {
  if (!isMobile()) return;
  sheetState = state;
  document.body.classList.toggle('sheet-half', state === 'half');
  document.body.classList.toggle('sheet-full', state === 'full');
  // 시트가 커지면 지도에 남는 자리가 줄어든다 — 하루 전체 보기 중이면 다시 맞춘다
  if (viewMode === 'day') setZoomTarget(fitZoomForDay(), false);
}

let sDrag = null;
let dayIdx = 1, selIdx = 0;
let panelTab = 'info';


function wireDioramaUi() {

  panelEl = document.getElementById('panel');
  grabEl = document.getElementById('grab');
  on(sceneEl, 'pointerdown', e => {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) {
      dragging = true; moved = 0; px = e.clientX; py = e.clientY;
    } else if (pointers.size === 2) {
      dragging = false;
      const [a, b] = [...pointers.values()];
      pinchDist0 = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      pinchZoom0 = cam.zoomTarget;
    }
    try { sceneEl.setPointerCapture(e.pointerId); } catch (_) {}
  });
  on(sceneEl, 'pointerup', e => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinchDist0 = 0;
    if (pointers.size === 0) dragging = false;
  });
  on(sceneEl, 'pointercancel', e => {
    pointers.delete(e.pointerId);
    if (pointers.size === 0) dragging = false;
    pinchDist0 = 0;
  });
  on(sceneEl, 'pointermove', e => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2 && pinchDist0 > 0) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      setZoomTarget(pinchZoom0 * (d / pinchDist0), false);
      flashZoomBadge();
      return;
    }
    if (!dragging) return;
    const dx = e.clientX - px, dy = e.clientY - py;
    moved += Math.abs(dx) + Math.abs(dy);
    px = e.clientX; py = e.clientY;
    cam.az -= dx * 0.005;
    cam.el = Math.max(0.3, Math.min(1.15, cam.el + dy * 0.004));
  });
  on(sceneEl, 'dblclick', e => {
    if (e.target.closest?.('.pinChip, #panel, #head, #pager, #mini, #alts, #hint')) return;
    if (viewMode === 'close') exitCloseUp(true);
    else enterCloseUp(selIdx);
  });
  on(sceneEl, 'wheel', e => {
    e.preventDefault();
    setZoomTarget(cam.zoomTarget * (1 - e.deltaY * 0.00115));
    if (viewMode === 'day' && cam.zoomTarget >= ZOOM_SPOT * 0.85) viewMode = 'spot';
    if (viewMode === 'close' && cam.zoomTarget < ZOOM_SPOT * 0.9) exitCloseUp(true);
  }, {passive: false});
  on(grabEl, 'pointerdown', e => {
    if (!isMobile()) return;
    sDrag = { y: e.clientY, from: sheetPx(), moved: 0 };
    panelEl.style.transition = 'none';
    try { grabEl.setPointerCapture(e.pointerId); } catch (_) {}
  });
  on(grabEl, 'pointermove', e => {
    if (!sDrag) return;
    const dy = e.clientY - sDrag.y;            // 위로 끌면 dy < 0 → 시트가 커진다
    sDrag.moved = Math.max(sDrag.moved, Math.abs(dy));
    const h = Math.max(60, Math.min(innerHeight * 0.78, sDrag.from - dy));
    document.body.style.setProperty('--sh', h + 'px');
  });
  function endSheetDrag() {
    if (!sDrag) return;
    const cur = sheetPx();
    panelEl.style.transition = '';
    document.body.style.removeProperty('--sh');
    if (sDrag.moved < 6) {
      setSheet(sheetState === 'peek' ? 'half' : 'peek');   // 탭 = 토글
    } else {
      const snap = ['peek', 'half', 'full']
        .map(s => [s, sheetPx(s)])
        .sort((a, b) => Math.abs(a[1] - cur) - Math.abs(b[1] - cur))[0][0];
      setSheet(snap);
    }
    sDrag = null;
  }
  on(grabEl, 'pointerup', endSheetDrag);
  on(grabEl, 'pointercancel', endSheetDrag);

  /* ============ UI ============ */
  document.querySelectorAll('#panel .tab').forEach(tab => {
    on(tab, 'click', () => {
      panelTab = tab.dataset.pane;
      document.querySelectorAll('#panel .tab').forEach(t => t.classList.toggle('on', t === tab));
      document.getElementById('paneInfo').classList.toggle('on', panelTab === 'info');
      document.getElementById('paneSched').classList.toggle('on', panelTab === 'sched');
    });
  });

  on(document.getElementById('pCloseup'), 'click', () => {
    if (viewMode === 'close') exitCloseUp(true);
    else enterCloseUp(selIdx);
  });
  on(document.getElementById('pOverview'), 'click', () => {
    viewMode = 'day';
    applyIsolation();
    cam.focusTarget.set(0, 0, 0);
    setZoomTarget(fitZoomForDay());
  });

  /* 시간대 선택 — 고른 값은 일차를 바꿔도 유지된다. '자동'이면 일정 시각을 따라간다. */
  document.querySelectorAll('#timeBar button').forEach(b => {
    on(b, 'click', () => {
      lightOverride = b.dataset.light || null;
      document.querySelectorAll('#timeBar button').forEach(o => o.classList.toggle('on', o === b));
      applyLight(lightOverride || DAYS[dayIdx].light);
    });
  });
  pager = document.getElementById('pager');
    pager.replaceChildren();
  DAYS.forEach((d, i) => {
    const b = document.createElement('button');
    b.className = 'pbtn';
    b.textContent = d.no;
    b.onclick = () => loadDay(i);
    pager.appendChild(b);
  });
  const sep = document.createElement('div');
  sep.className = 'sep';
  pager.appendChild(sep);
  plbl = document.createElement('div');
  plbl.className = 'lbl';
  pager.appendChild(plbl);
  on(window, 'keydown', e => {
    if (e.code === 'ArrowRight') selectStop(Math.min(selIdx + 1, DAYS[dayIdx].stops.length - 1), true);
    if (e.code === 'ArrowLeft') selectStop(Math.max(selIdx - 1, 0), true);
    if (e.code === 'ArrowUp') loadDay(Math.max(dayIdx - 1, 0));
    if (e.code === 'ArrowDown') loadDay(Math.min(dayIdx + 1, DAYS.length - 1));
    if (e.code === 'KeyC') enterCloseUp(selIdx);
    if (e.code === 'Escape') {
      if (viewMode === 'close') exitCloseUp(true);
      else {
        viewMode = 'day';
        applyIsolation();
        cam.focusTarget.set(0, 0, 0);
        setZoomTarget(fitZoomForDay());
      }
    }
  });


  /* ============ 루프 ============ */
  on(window, 'resize', () => {
    renderer.setSize(innerWidth, innerHeight);
    labelRenderer.setSize(innerWidth, innerHeight);
    // 회전·창 크기 변경 후에도 하루가 안전영역에 들어오게 다시 맞춘다
    if (viewMode === 'day') setZoomTarget(fitZoomForDay(), false);
    updateCamera();
  });

}

function mapsUrl(s) {
  const q = encodeURIComponent(`${s.lat},${s.lng}`);
  const isiOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  return isiOS
    ? `https://maps.apple.com/?daddr=${q}&dirflg=w`
    : `https://www.google.com/maps/dir/?api=1&destination=${q}&travelmode=walking`;
}

function selectStop(i, focusCam = false, opts = {}) {
  selIdx = i;
  const day = DAYS[dayIdx];
  const s = day.stops[i];
  document.getElementById('pNo').textContent = s.stay
    ? `STAY / ${day.region.split('·')[0].trim()}`
    : `PLACE ${String(i + 1).padStart(2, '0')} / ${day.region.split('·')[0].trim()}`;
  document.getElementById('pName').textContent = s.name;
  document.getElementById('pJp').textContent = s.jp || '';
  document.getElementById('pTime').textContent = s.time + ' 예정';
  document.getElementById('peekTime').textContent = s.time;
  document.getElementById('peekName').textContent = s.name;
  document.getElementById('pDist').textContent = i === 0
    ? '오늘의 시작'
    : `이전에서 ${haversineKm(day.stops[i - 1], s).toFixed(1)}km`;
  document.getElementById('pTag').style.display = s.eat ? '' : 'none';
  document.getElementById('pWhy').textContent = s.why || s.note || '';
  document.getElementById('pSee').textContent = s.see || s.note || '';
  const via = document.getElementById('pVia');
  if (s.via) { via.innerHTML = `<b>이동</b> · ${s.via}`; via.hidden = false; }
  else { via.hidden = true; }
  const maps = document.getElementById('pMaps');
  maps.href = mapsUrl(s);
  maps.hidden = false;
  const q = encodeURIComponent(s.name + ' 도쿄');
  document.getElementById('pGuide').href = `https://www.google.com/search?q=${q}`;
  document.getElementById('pMapsText').href = mapsUrl(s);
  document.querySelectorAll('#pList .row').forEach((r, k) => r.classList.toggle('sel', k === i));
  document.querySelectorAll('#chips .chip').forEach((c, k) => c.classList.toggle('sel', k === i));
  markers.forEach((m, k) => m.chipEl.classList.toggle('sel', k === i));
  const selCi = stopCi[i];
  document.querySelectorAll('#miniSvg .mdot').forEach(c => {
    const cis = c.dataset.cis.split(',').map(Number);
    const members = cis.flatMap(ci => dayLayout?.clusters[ci]?.members || []);
    const multi = members.length > 1;
    const on = cis.includes(selCi);
    const anyEat = members.some(m => day.stops[m]?.eat);
    c.setAttribute('fill', on ? '#3a352e' : (anyEat ? '#c0392b' : '#e8734a'));
    c.setAttribute('r', (multi ? 9 : 6.5) + (on ? 1.5 : 0));
  });
  if (focusCam && markers[i]) {
    cam.focusTarget.copy(markers[i].pos);
    // 모바일: 스팟을 고르면 설명이 보여야 하지만, 지도를 다 덮지는 않는다
    if (isMobile() && sheetState === 'peek') setSheet('half');
    if (opts.mode === 'close') viewMode = 'close';
    else if (viewMode === 'close') {
      // 클로즈업 중 다른 스팟으로 이동하면 그 스팟만 유지
      applyIsolation();
    } else {
      viewMode = 'spot';
    }
    setZoomTarget(opts.zoom ?? (viewMode === 'close' ? ZOOM_CLOSE : ZOOM_SPOT));
    if (viewMode === 'close') applyIsolation();
  }
}

/* 실측 미니맵 — 디오라마와 같은 projectDay() 결과를 쓴다.
 * 다른 점은 압축을 안 한다는 것뿐: 여기가 '진짜 비율', 디오라마는 '같은 방위, 눌린 반경'. */
function buildMinimap(di) {
  const day = DAYS[di];
  const proj = projectDay(day);
  const cp = proj.clusters.map(c => ({ x: c.km.x, y: c.km.z }));
  const xs = cp.map(p => p.x), ys = cp.map(p => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const spanX = Math.max(maxX - minX, 0.001), spanY = Math.max(maxY - minY, 0.001);
  const W = 168, H = 118, pad = 18;
  const sc = Math.min((W - pad * 2) / spanX, (H - pad * 2) / spanY);
  const ox = (W - spanX * sc) / 2, oy = (H - spanY * sc) / 2;
  const P = cp.map(p => ({ x: ox + (p.x - minX) * sc, y: oy + (p.y - minY) * sc }));

  // 경로는 방문 순서대로 클러스터를 잇는다 (같은 지점 연속 방문은 한 점)
  const order = [];
  proj.stops.forEach(s => { if (order[order.length - 1] !== s.ci) order.push(s.ci); });

  // 실축척이라 가까운 스팟은 화면에서 겹친다. 좌표는 그대로 두고 표시만 묶는다.
  const groups = [];
  proj.clusters.forEach((cl, ci) => {
    const p = P[ci];
    const g = groups.find(q => Math.hypot(q.x - p.x, q.y - p.y) < 13);
    if (g) { g.cis.push(ci); g.stops.push(...cl.members); }
    else groups.push({ x: p.x, y: p.y, cis: [ci], stops: [...cl.members] });
  });

  let svg = `<polyline points="${order.map(ci => `${P[ci].x.toFixed(1)},${P[ci].y.toFixed(1)}`).join(' ')}"
    fill="none" stroke="#d8ccb8" stroke-width="2.5" stroke-dasharray="4 3" stroke-linecap="round"/>`;
  groups.forEach(g => {
    const nums = g.stops.slice().sort((a, b) => a - b).map(m => m + 1);
    const multi = nums.length > 1;
    const label = nums.length > 2 ? `${nums[0]}–${nums[nums.length - 1]}` : nums.join('·');
    svg += `<circle class="mdot" data-cis="${g.cis.join(',')}" data-stop="${g.stops[0]}"
        cx="${g.x.toFixed(1)}" cy="${g.y.toFixed(1)}" r="${multi ? 9 : 6.5}" fill="#e8734a"/>
      <text x="${g.x.toFixed(1)}" y="${(g.y + 3).toFixed(1)}" text-anchor="middle"
        font-size="${multi ? 7.5 : 8.5}" font-weight="700" fill="#fff" pointer-events="none">${label}</text>`;
  });
  document.getElementById('miniSvg').innerHTML = svg;
  document.querySelectorAll('#miniSvg .mdot').forEach(c =>
    c.addEventListener('click', () => selectStop(+c.dataset.stop, true)));

  const total = dayTotalKm(day);
  const dist = total >= 10 ? `하루 이동 약 ${Math.round(total)} km` : `하루 이동 약 ${total.toFixed(1)} km`;
  // 이상치를 얼마나 눌러 화면에 넣었는지 정직하게 적는다
  const comp = dayLayout ? dayLayout.compression : 1;
  document.getElementById('miniScale').innerHTML = comp >= 1.15
    ? `${dist}<br><span style="opacity:.7">먼 구간은 약 1/${comp.toFixed(1)}로 압축</span>`
    : dist;
}

/** 일차에 필요한 지도 조각을 먼저 받아 둔다 (없으면 잔디 원판으로 폴백) */
async function loadDay(i) {
  dayIdx = i;
  const day = DAYS[i];
  const need = new Set();
  day.stops.forEach(s => { const t = tileOf(s.lat, s.lng); if (t) need.add(t.id); });
  if (day.lm) { const t = tileOf(day.lm.lat, day.lm.lng); if (t) need.add(t.id); }
  await loadTiles([...need]);
  if (dayIdx !== i) return;        // 로딩 중에 사용자가 다른 일차를 눌렀다
  buildDiorama(day);

  document.getElementById('hNo').textContent = day.no;
  document.getElementById('hTitle').textContent = day.t;
  document.getElementById('hRegion').textContent = `${day.d} · ${day.region}`;
  document.getElementById('hJp').textContent = day.jp || '';
  document.getElementById('pCount').textContent = `${day.stops.length}곳`;
  plbl.innerHTML = `<b>${day.jp || ''}</b>${day.d}`;

  document.getElementById('chips').innerHTML = day.stops.map((s, k) =>
    `<button class="chip" type="button"><span class="t">${s.time}</span>${s.name}</button>`).join('');
  document.querySelectorAll('#chips .chip').forEach((c, k) => {
    c.onclick = () => selectStop(k, true);
    c.ondblclick = e => { e.preventDefault(); enterCloseUp(k); };
  });

  document.getElementById('pList').innerHTML = day.stops.map((s, k) =>
    `<div class="row ${s.eat ? 'eat' : ''}"><div class="tm">${s.time}</div><div class="nm">${s.name}</div></div>`).join('');
  document.querySelectorAll('#pList .row').forEach((r, k) => {
    r.onclick = () => {
      selectStop(k, true);
      document.querySelector('#panel .tab[data-pane="info"]')?.click();
    };
    r.ondblclick = e => {
      e.preventDefault();
      enterCloseUp(k);
      document.querySelector('#panel .tab[data-pane="info"]')?.click();
    };
  });

  document.querySelectorAll('.pbtn').forEach((b, k) => b.classList.toggle('on', k === i));

  buildMinimap(i);

  cam.focus.set(0, 0, 0);
  cam.focusTarget.set(0, 0, 0);
  viewMode = 'day';
  setSheet('peek');                 // 새 일차는 지도부터 보여준다
  const fit = fitZoomForDay();
  cam.zoom = fit;
  cam.zoomTarget = fit;
  document.getElementById('zoomBadge')?.classList.remove('show');   // 이전 일차 배율 표시 제거
  zoomBadgeTimer = 0;
  applyIsolation();
  selectStop(0, false);
}

const clock = new THREE.Clock();
const northArrow = document.getElementById('northArrow');
const _pa = new THREE.Vector3(), _pb = new THREE.Vector3();
function tick() {
  // 120Hz 화면에서 구름·사람이 두 배로 빨라지던 문제 — 실제 경과시간을 쓴다
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.getElapsedTime();

  sheetShownPx += (sheetPx() - sheetShownPx) * (1 - Math.pow(0.0005, dt));
  cam.focus.lerp(cam.focusTarget, 1 - Math.pow(0.001, dt));
  cam.zoom += (cam.zoomTarget - cam.zoom) * (1 - Math.pow(0.0001, dt));
  updateCamera();
  updateLod();
  declutterChips(dt, { markers, selIdx, zoom: cam.zoom, panelEl });

  if (zoomBadgeTimer > 0) {
    zoomBadgeTimer -= dt;
    if (zoomBadgeTimer <= 0) document.getElementById('zoomBadge')?.classList.remove('show');
  }

  // 나침반: 화면상 북쪽 방향
  _pa.set(cam.focus.x, 0, cam.focus.z).project(camera);
  _pb.set(cam.focus.x, 0, cam.focus.z - 1).project(camera);
  northArrow.style.transform = `rotate(${Math.atan2(_pb.x - _pa.x, _pb.y - _pa.y)}rad)`;

  // 핀 바운스
  markers.forEach((m, i) => {
    if (!m.group.visible) return;
    const isSel = i === selIdx;
    const bounce = isSel ? Math.abs(Math.sin(t * 3.2)) * 0.5 : Math.sin(t * 1.8 + i) * 0.08;
    m.pin.position.y = bounce;
    const s = isSel ? 1.25 : 1;
    m.pin.scale.set(s, s, s);
  });

  // 사람들 산책
  if (roadCurve) {
    peoples.forEach(p => {
      if (!p.g.visible) return;
      p.t = (p.t + p.spd * dt + 1) % 1;
      const pos = roadCurve.getPointAt(p.t);
      const tan = roadCurve.getTangentAt(p.t);
      p.g.position.set(pos.x - tan.z * p.off * 0.5, 0, pos.z + tan.x * p.off * 0.5);
      p.g.rotation.y = Math.atan2(tan.x * Math.sign(p.spd), tan.z * Math.sign(p.spd));
      p.g.position.y = Math.abs(Math.sin(t * 9 + p.off * 10)) * 0.05;
    });
  }

  // 구름 & 관람차 — 빌드할 때 모아둔 목록만 돈다 (매 프레임 씬 전체를 훑지 않는다)
  clouds.forEach(c => {
    if (!c.visible) return;
    c.position.x += c.userData.spd * dt;
    if (c.position.x > 55) c.position.x = -55;
  });
  spinners.forEach(s => { s.o.rotation.z = t * s.spd; });
  tickTrains(dt);

  // 비행기
  flyers.forEach(f => {
    if (!f.g.visible) return;
    f.t = (f.t + f.spd * dt + 1) % 1;
    if (f.kind === 'takeoff') {
      // 0~0.35 활주(지상 가속) → 0.35~1 상승. 끝나면 활주로 앞으로 되돌아온다.
      const u = f.t;
      const run = Math.min(u / 0.35, 1);
      const climb = Math.max(0, (u - 0.35) / 0.65);
      f.g.position.set(2, 1.35 + climb * climb * 46, -14 + run * 30 + climb * 92);
      f.g.rotation.x = -climb * 0.42;             // 기수를 든다
      f.g.visible = u < 0.92;                     // 화면 밖으로 나가면 잠깐 숨겼다 리셋
    } else {
      // 상공을 가로지른다. 왕복이 아니라 한 방향으로 계속 흐른다.
      const d = (f.t - 0.5) * f.span;
      f.g.position.set(Math.cos(f.a) * d, f.y, Math.sin(f.a) * d);
      f.g.rotation.y = -f.a + Math.PI / 2;
    }
  });

  renderer.render(scene, camera);
  labelRenderer.render(scene, camera);
  rafId = requestAnimationFrame(tick);
}


export async function startDiorama(sceneElement, labelsElement) {
  if (running) stopDiorama();
  running = true;
  initCore(sceneElement, labelsElement);
  initLights();
  wireDioramaUi();

  const boot = document.createElement('div');
  boot.id = 'boot';
  boot.style.cssText = 'position:fixed;inset:0;z-index:50;display:flex;align-items:center;justify-content:center;background:#e9e6df;font-family:inherit;color:#3a352e;font-weight:700;letter-spacing:.04em';
  boot.textContent = '디오라마 에셋 불러오는 중…';
  document.body.appendChild(boot);

  try {
    await Promise.all([preloadGlbs(), loadTileManifest()]);
    if (!running) return;
    await loadDay(1);
  } catch (err) {
    console.error(err);
    if (boot.isConnected) boot.textContent = '에셋 로드 실패 — 기본 모형으로 진행';
    if (running) await loadDay(1);
  }
  boot.remove();
  if (!running) return;
  updateCamera();
  tick();
}

export function stopDiorama() {
  running = false;
  cancelAnimationFrame(rafId);
  rafId = 0;
  cleanups.splice(0).forEach((fn) => { try { fn(); } catch {} });
  try { disposeWorld(); } catch {}
  disposeLights();
  disposeCore();
  document.getElementById('boot')?.remove();
  document.getElementById('pager')?.replaceChildren();
  document.body.classList.remove('night', 'sheet-half', 'sheet-full');
  document.body.style.background = '';
  document.body.style.removeProperty('--sh');
  panelEl = null;
  grabEl = null;
  pager = null;
  plbl = null;
}
