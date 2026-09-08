/** 지하철 — 노선·역·전철
 *
 *  도쿄 지하철은 지하라 `railway=rail`(지상 JR)로는 안 잡힌다.
 *  fetch-osm.py 가 `railway=subway` 와 `railway=station` 노드를 따로 받아 둔 걸 쓴다.
 *
 *  표현 원칙:
 *    지하 노선 — 반투명 점선. 지상 철도(불투명)와 눈으로 구분된다
 *    역        — 플랫폼 + 지붕 + 노선색 표지. 이름은 확대했을 때만
 *    전철      — 노선당 1대. 역 근처에서 감속했다 다시 출발한다
 */
import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { G, mat, mesh } from './core.js';
import { ribbon } from './osm-tile.js';

/* 노선 이름에서 색을 뽑는다. 실제 노선색을 다 넣을 필요는 없고,
 * 서로 구분되기만 하면 된다 — 이름 해시로 팔레트에서 고른다. */
const LINE_COLORS = [0xe8734a, 0x5b8fb9, 0xc9a24b, 0x7fa86a, 0xb06a8f, 0x6a7fb0];
function lineColor(name) {
  let h = 0;
  for (let i = 0; i < (name || '').length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  return LINE_COLORS[Math.abs(h) % LINE_COLORS.length];
}

/** 전철 등록부 — 배열은 재할당하지 않고 비운다 (import 가 살아 있으므로) */
export const trains = [];
export const stationLabels = [];
export function resetTransit() { trains.length = 0; stationLabels.length = 0; }

/**
 * 같은 역이 운영사별로 노드 여러 개로 매핑돼 있다 (아사쿠사역 4개, 아키하바라역 3개).
 * 이름이 같고 가까우면 하나로 합친다. 멀리 떨어진 동명 역은 실제로 별개 역이라 남긴다.
 */
export function mergeStations(feats, mergeM = 250) {
  const out = [];
  for (const f of feats) {
    const hit = out.find(o => o.n === f.n && Math.hypot(o.p[0] - f.p[0], o.p[1] - f.p[1]) < mergeM);
    if (hit) {
      hit.p[0] = (hit.p[0] + f.p[0]) / 2;
      hit.p[1] = (hit.p[1] + f.p[1]) / 2;
      hit.sub = hit.sub || f.sub;
    } else {
      out.push({ n: f.n, en: f.en, sub: f.sub, p: [f.p[0], f.p[1]] });
    }
  }
  return out;
}

/** 역 모형 — 플랫폼 + 지붕 + 표지 기둥. 스팟 핀보다 낮고 작게 만든다. */
function stationModel(s, color) {
  const g = new THREE.Group();
  const deck = mat(0xe7e0d0), roof = mat(0xcfc6b4), post = mat(color);
  g.add(mesh(G.box, deck, 2.6, 0.22, 1.3, 0, 0.11, 0));           // 플랫폼
  [-1.0, 1.0].forEach(dx => g.add(mesh(G.cyl, roof, 0.07, 0.9, 0.07, dx, 0.55, 0)));
  g.add(mesh(G.box, roof, 2.9, 0.13, 1.6, 0, 1.05, 0));           // 지붕
  g.add(mesh(G.cyl, post, 0.07, 1.4, 0.07, 1.5, 0.7, 0.5));       // 표지 기둥
  g.add(mesh(G.box, post, 0.55, 0.36, 0.09, 1.5, 1.5, 0.5));      // 노선색 표지판
  return g;
}

/** 전철 편성 — 3량. 앞칸만 색을 넣어 진행 방향이 보이게. */
function trainModel(color) {
  const g = new THREE.Group();
  const body = mat(0xf2ece0), head = mat(color), win = mat(0x8fa8bd, { metalness: 0.25, roughness: 0.4 });
  for (let i = 0; i < 3; i++) {
    const z = (i - 1) * 1.5;
    g.add(mesh(G.box, i === 0 ? head : body, 0.85, 0.62, 1.35, 0, 0.42, z));
    g.add(mesh(G.box, win, 0.88, 0.2, 1.0, 0, 0.52, z));
  }
  return g;
}

/**
 * 조각 하나의 지하철을 만든다.
 * @returns {THREE.Group} 조각 그룹에 그대로 add 하면 되는 그룹
 */
export function buildTransit(tile, opts = {}) {
  const mag = opts.mag ?? 0.035;
  const roadMul = opts.roadMul ?? 3.2;
  const R = tile.r * mag;
  const g = new THREE.Group();
  const scale = p => [p[0] * mag, p[1] * mag];

  // ---- 지하 노선: 점선으로 깐다 ----
  const byLine = new Map();
  for (const f of tile.f) {
    if (f.k !== 'subway' || f.p.length < 2) continue;
    const name = f.line || '노선';
    if (!byLine.has(name)) byLine.set(name, []);
    byLine.get(name).push(f.p.map(scale));
  }

  for (const [name, segs] of byLine) {
    const col = lineColor(name);
    const m = new THREE.MeshStandardMaterial({
      color: col, roughness: 0.9, side: THREE.DoubleSide,
      vertexColors: true, transparent: true, opacity: 0.42, depthWrite: false
    });
    const w = Math.max(3.5 * mag * roadMul, 0.34);
    for (const seg of segs) {
      // 점선 — 지하라는 걸 눈으로 알 수 있게 끊어 깐다
      for (let i = 0; i + 1 < seg.length; i++) {
        const [ax, az] = seg[i], [bx, bz] = seg[i + 1];
        const len = Math.hypot(bx - ax, bz - az);
        if (len < 1e-4) continue;      // 겹친 점 — 나누면 NaN 이 나온다
        const dash = Math.max(w * 2.2, 0.7), gap = dash * 0.75;
        const n = Math.max(1, Math.floor(len / (dash + gap)));
        for (let k = 0; k < n; k++) {
          const t0 = (k * (dash + gap)) / len, t1 = Math.min(1, t0 + dash / len);
          const geo = ribbon([
            [ax + (bx - ax) * t0, az + (bz - az) * t0],
            [ax + (bx - ax) * t1, az + (bz - az) * t1]
          ], w, 0.19, R);
          if (geo) { const mm = new THREE.Mesh(geo, m); mm.renderOrder = 2; g.add(mm); }
        }
      }
    }

    // 노선당 전철 1대 — 가장 긴 구간 위를 달린다 (조각 경계에서 잘린 토막을 잇지 않는다)
    let best = null, bestLen = 0;
    for (const seg of segs) {
      let L = 0;
      for (let i = 0; i + 1 < seg.length; i++) L += Math.hypot(seg[i + 1][0] - seg[i][0], seg[i + 1][1] - seg[i][1]);
      if (L > bestLen) { bestLen = L; best = seg; }
    }
    if (best && bestLen > 3) {
      // 연속 중복점을 걸러낸다 — 남겨두면 접선이 0 이 되어 커브가 NaN 을 뱉는다
      const clean = [];
      for (const [x, z] of best) {
        const last = clean[clean.length - 1];
        if (!last || Math.hypot(x - last.x, z - last.z) > 1e-3) clean.push(new THREE.Vector3(x, 0.55, z));
      }
      if (clean.length < 2) continue;
      const curve = new THREE.CatmullRomCurve3(clean);
      const t = trainModel(col);
      t.scale.setScalar(Math.max(0.5, Math.min(1.4, mag * 26)));
      g.add(t);
      trains.push({ g: t, curve, t: Math.random(), dir: 1, spd: 0.055 + Math.random() * 0.03, stops: [] });
    }
  }

  // ---- 역 ----
  const stations = mergeStations(tile.f.filter(f => f.k === 'station'));
  for (const s of stations) {
    const [x, z] = scale(s.p);
    if (Math.hypot(x, z) > R * 0.95) continue;
    const sm = stationModel(s, s.sub ? 0x5b8fb9 : 0x7f8a99);
    sm.scale.setScalar(Math.max(0.55, Math.min(1.5, mag * 28)));
    sm.position.set(x, 0, z);
    g.add(sm);

    // 이름은 확대했을 때만 — 항상 띄우면 스팟 핀과 싸운다
    const el = document.createElement('div');
    el.className = 'stChip';
    el.textContent = s.n || s.en || '';
    const lbl = new CSS2DObject(el);
    lbl.position.set(0, 2.0, 0);
    lbl.visible = false;
    sm.add(lbl);
    stationLabels.push(lbl);
  }

  return g;
}

/** 전철을 굴린다. 역 근처에서 느려졌다 다시 붙는다. */
export function tickTrains(dt) {
  const _p = new THREE.Vector3(), _t = new THREE.Vector3();
  for (const tr of trains) {
    if (!tr.g.visible) continue;
    // 끝에 닿으면 방향을 뒤집는다 (조각 안의 짧은 구간을 왕복한다)
    tr.t += tr.spd * dt * tr.dir;
    if (tr.t >= 1) { tr.t = 1; tr.dir = -1; }
    else if (tr.t <= 0) { tr.t = 0; tr.dir = 1; }
    tr.curve.getPointAt(tr.t, _p);
    tr.curve.getTangentAt(tr.t, _t);
    tr.g.position.copy(_p);
    tr.g.rotation.y = Math.atan2(_t.x * tr.dir, _t.z * tr.dir);
  }
}
