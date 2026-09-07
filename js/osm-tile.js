/** 실제 지도 조각(타일) 빌더
 *
 *  tools/fetch-osm.py 가 구워 둔 조각 하나를 THREE.Group 으로 만든다.
 *  조각 안의 좌표는 타일 중심 기준 '미터'다. 디오라마에 놓을 때는 mag 배로 확대한다.
 *
 *  축척이 두 개인 걸 숨기지 않는다:
 *    조각 사이 거리 = 압축된 실측 (index.html 의 layoutDay)
 *    조각 안       = 실제 지도 비율 × mag
 */
import * as THREE from 'three';

/* 도로 등급별 색·높이. 위로 갈수록 나중에 그려져 위에 얹힌다. */
/* 도로가 잔디 위에서 확실히 읽히도록 대비를 준다.
 * 실제 지도에서도 도로는 바탕보다 밝게 그린다 — 폭을 과장하는 것과 같은 이유다. */
const ROAD_STYLE = {
  major: { color: 0xfffdf6, y: 0.16, minW: 0.85 },
  mid:   { color: 0xfdf8ec, y: 0.14, minW: 0.62 },
  minor: { color: 0xf8f2e2, y: 0.12, minW: 0.44 },
  path:  { color: 0xf0e7d2, y: 0.10, minW: 0.30 }
};

/* 세계 팔레트 — UI(크림·잉크·코랄)와 같은 계열로 묶는다.
 * 화면 전체가 좁은 팔레트 하나로 읽히는 게 이 톤의 핵심이다. */
const TILE_COLORS = {
  grass: 0xd7dcc0,
  water: 0xaec6cf,
  green: 0xbccfa0,
  rail: 0xc0b6a0
};

/* 조각 가장자리에서 서서히 사라지는 알파.
 * 섬처럼 뚝 끊기지 않고 지형에 스며들게 하는 장치 — 정점 색의 알파로 처리한다. */
function edgeAlpha(x, z, R) {
  const d = Math.hypot(x, z) / R;
  if (d < 0.68) return 1;
  return Math.max(0, 1 - (d - 0.68) / 0.3);
}

/** 폭 있는 리본으로 선을 만든다 (도로·철도 공용) */
export function ribbon(points, width, y, R) {
  if (points.length < 2) return null;
  const pos = [], idx = [], col = [];
  const half = width / 2;
  let pn = { x: 0, z: 1 };
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const a = points[Math.max(i - 1, 0)];
    const b = points[Math.min(i + 1, points.length - 1)];
    let dx = b[0] - a[0], dz = b[1] - a[1];
    const len = Math.hypot(dx, dz);
    let nx, nz;
    if (len < 1e-6) { nx = pn.x; nz = pn.z; }
    else { dx /= len; dz /= len; nx = -dz; nz = dx; pn = { x: nx, z: nz }; }
    const x1 = p[0] + nx * half, z1 = p[1] + nz * half;
    const x2 = p[0] - nx * half, z2 = p[1] - nz * half;
    pos.push(x1, y, z1, x2, y, z2);
    const a1 = edgeAlpha(x1, z1, R), a2 = edgeAlpha(x2, z2, R);
    col.push(1, 1, 1, a1, 1, 1, 1, a2);
  }
  for (let i = 0; i < points.length - 1; i++) {
    const a = i * 2;
    idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
  g.setIndex(idx);
  // 이 리본의 삼각형 감김 방향은 법선을 아래(-Y)로 만든다. 그대로 두면
  // 바닥에 깔린 도로가 아래에서 조명을 받아 새까맣게 죽는다. 위로 고정한다.
  const nor = new Float32Array(pos.length);
  for (let i = 1; i < nor.length; i += 3) nor[i] = 1;
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  return g;
}

/** 여러 지오메트리를 하나로 합친다 — 드로우콜을 등급당 1개로 묶기 위해 */
function mergeGeoms(list) {
  if (!list.length) return null;
  let vTotal = 0, iTotal = 0;
  for (const g of list) {
    vTotal += g.attributes.position.count;
    iTotal += g.index.count;
  }
  const pos = new Float32Array(vTotal * 3);
  const nor = new Float32Array(vTotal * 3);
  const col = new Float32Array(vTotal * 4);
  const idx = vTotal > 65535 ? new Uint32Array(iTotal) : new Uint16Array(iTotal);
  let vo = 0, io = 0;
  for (const g of list) {
    pos.set(g.attributes.position.array, vo * 3);
    nor.set(g.attributes.normal.array, vo * 3);
    if (g.attributes.color) col.set(g.attributes.color.array, vo * 4);
    else col.fill(1, vo * 4, vo * 4 + g.attributes.position.count * 4);
    const gi = g.index.array;
    for (let k = 0; k < gi.length; k++) idx[io + k] = gi[k] + vo;
    vo += g.attributes.position.count;
    io += gi.length;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 4));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}

/** 폴리곤(미터 좌표) → 바닥에 눕힌 ShapeGeometry */
function polygonGeom(pts, y, R) {
  if (pts.length < 3) return null;
  const shape = new THREE.Shape();
  shape.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) shape.lineTo(pts[i][0], pts[i][1]);
  shape.closePath();
  const g = new THREE.ShapeGeometry(shape);
  g.rotateX(-Math.PI / 2);       // XY 평면 → XZ 바닥
  g.translate(0, y, 0);
  const p = g.attributes.position;
  const col = new Float32Array(p.count * 4);
  for (let i = 0; i < p.count; i++) {
    col[i * 4] = col[i * 4 + 1] = col[i * 4 + 2] = 1;
    col[i * 4 + 3] = edgeAlpha(p.getX(i), p.getZ(i), R);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 4));
  return g;
}

/**
 * 조각 하나를 만든다.
 * @param {object} tile  fetch-osm.py 가 만든 { id, r, f: [...] }
 * @param {object} opts
 *   mag      디오라마 유닛 / 실제 미터. 조각 안의 모든 좌표에 곱한다.
 *   roadMul  도로 폭 과장 배율. 실폭 그대로면 건물 모형 옆에서 실처럼 보인다.
 *            (지도에서 도로를 굵게 그리는 것과 같은 이유 — 표준적인 지도 표현이다)
 *   thickness 섬 두께 (디오라마 유닛)
 * @returns {THREE.Group} 좌표계가 이미 디오라마 유닛인 그룹
 */
export function buildTile(tile, opts = {}) {
  const mag = opts.mag ?? 0.035;
  const roadMul = opts.roadMul ?? 3.2;
  const R = tile.r * mag;
  const g = new THREE.Group();
  g.userData.tileId = tile.id;
  g.userData.radius = R;

  // 섬이 아니라 '땅 위에 얹힌 지도 무늬'다.
  // 두께도 흙벽도 없다 — 가장자리에서 알파로 사라져 주변 지형에 스며든다.

  // ---- 지도 피처 ----
  const buckets = { green: [], water: [], rail: [], major: [], mid: [], minor: [], path: [] };
  const scale = p => [p[0] * mag, p[1] * mag];

  for (const f of tile.f) {
    if (f.k === 'green' || f.k === 'water') {
      const geo = polygonGeom(f.p.map(scale), f.k === 'water' ? 0.05 : 0.04, R);
      if (geo) buckets[f.k].push(geo);
    } else if (f.k === 'rail') {
      const geo = ribbon(f.p.map(scale), Math.max(4.5 * mag * roadMul, 0.4), 0.06, R);
      if (geo) buckets.rail.push(geo);
    } else if (f.k === 'road') {
      const st = ROAD_STYLE[f.c] || ROAD_STYLE.minor;
      // 최소 폭을 둔다 — 안 그러면 축소 시 실 한 올처럼 사라진다
      const w = Math.max((f.w || 6) * mag * roadMul, st.minW);
      const geo = ribbon(f.p.map(scale), w, st.y, R);
      if (geo) buckets[f.c].push(geo);
    }
    // coast 는 물 폴리곤이 아니라 선이라 여기서는 생략 (바다는 타일 밖이 담당)
  }

  const addBucket = (key, color, extra = {}) => {
    const merged = mergeGeoms(buckets[key]);
    if (!merged) return;
    const m = new THREE.Mesh(merged, new THREE.MeshStandardMaterial({
      color, roughness: 0.95, metalness: 0, side: THREE.DoubleSide,
      vertexColors: true, transparent: true, depthWrite: false, ...extra
    }));
    m.receiveShadow = true;
    m.renderOrder = 1;
    g.add(m);
  };

  addBucket('green', TILE_COLORS.green);
  addBucket('water', TILE_COLORS.water, { roughness: 0.25, metalness: 0.15 });
  addBucket('rail', TILE_COLORS.rail);
  addBucket('path', ROAD_STYLE.path.color);
  addBucket('minor', ROAD_STYLE.minor.color);
  addBucket('mid', ROAD_STYLE.mid.color);
  addBucket('major', ROAD_STYLE.major.color);

  return g;
}

/** 타일 안에서 도로·물 위가 아닌 빈 자리 — 배경 건물을 놓을 곳 */
export function freeSpots(tile, opts = {}) {
  const mag = opts.mag ?? 0.035;
  const clearM = opts.clearM ?? 22;        // 도로 중심선에서 이만큼(m) 떨어져야 한다
  const stepM = opts.stepM ?? 46;
  const R = tile.r;

  // 도로 좌표를 격자 해시에 넣어 근접 검사를 싸게 만든다
  const cell = clearM;
  const grid = new Map();
  const put = (x, z) => {
    const k = `${Math.floor(x / cell)},${Math.floor(z / cell)}`;
    let a = grid.get(k);
    if (!a) { a = []; grid.set(k, a); }
    a.push([x, z]);
  };
  for (const f of tile.f) {
    if (f.k === 'road' || f.k === 'rail') {
      for (const p of f.p) put(p[0], p[1]);
    } else if (f.k === 'water') {
      for (const p of f.p) put(p[0], p[1]);
    }
  }
  const near = (x, z, d) => {
    const cx = Math.floor(x / cell), cz = Math.floor(z / cell);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      const a = grid.get(`${cx + i},${cz + j}`);
      if (!a) continue;
      for (const p of a) if (Math.hypot(p[0] - x, p[1] - z) < d) return true;
    }
    return false;
  };

  const out = [];
  for (let x = -R; x <= R; x += stepM) {
    for (let z = -R; z <= R; z += stepM) {
      const jx = x + (Math.random() - 0.5) * stepM * 0.5;
      const jz = z + (Math.random() - 0.5) * stepM * 0.5;
      if (Math.hypot(jx, jz) > R * 0.9) continue;
      if (near(jx, jz, clearM)) continue;
      out.push([jx * mag, jz * mag]);
    }
  }
  return out;
}

/** 스팟(위경도) → 타일 안의 로컬 좌표 (디오라마 유닛) */
export function stopOffset(stopLat, stopLng, tileLat, tileLng, mag = 0.035) {
  const kx = 111320 * Math.cos(tileLat * Math.PI / 180);
  const kz = 110540;
  return [(stopLng - tileLng) * kx * mag, -(stopLat - tileLat) * kz * mag];
}
