#!/usr/bin/env python3
"""도쿄 산책 · 실제 지도 조각(타일) 굽기

js/data.js 의 스팟 좌표를 읽어 지리적으로 700m 안의 스팟들을 한 조각으로 묶고,
조각마다 OpenStreetMap 에서 도로·물·공원·철도를 받아 정적 JSON 으로 저장한다.

런타임에는 이 파일만 읽는다. 여행지에서 모바일 데이터로 열 때
Overpass 를 호출하면 느리고 실패하기 때문에 미리 구워 둔다.

    python3 tools/fetch-osm.py            # 없는 타일만 받기
    python3 tools/fetch-osm.py --force    # 전부 다시 받기

출력:
    assets/osm/tiles.json      매니페스트 [{id, lat, lng, r, stops:[...]}]
    assets/osm/tile-<id>.json  조각 하나의 피처들 (타일 중심 기준 로컬 미터)
"""

import json
import math
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_JS = os.path.join(ROOT, 'js', 'data.js')
OUT_DIR = os.path.join(ROOT, 'assets', 'osm')

# 본 서버가 429/504 를 자주 뱉어서 미러를 돌아가며 쓴다
# 지역 한정 인스턴스(overpass.osm.ch 등)는 일본에 빈 결과를 주므로 쓰지 않는다
OVERPASS_MIRRORS = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
    'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
]

LINK_M = 700.0      # 이 거리 안의 스팟은 한 조각으로 묶는다
MARGIN_M = 250.0    # 조각 가장자리 여유
MIN_R = 300.0
MAX_R = 900.0
PAUSE_S = 2.0       # Overpass 예의

# 도로 등급 → (렌더링 클래스, 폭 m). 클래스는 런타임에서 색·폭으로 쓴다.
ROAD_CLASS = {
    'motorway': ('major', 18), 'motorway_link': ('major', 10),
    'trunk': ('major', 16), 'trunk_link': ('major', 9),
    'primary': ('major', 14), 'primary_link': ('major', 8),
    'secondary': ('mid', 11), 'secondary_link': ('mid', 7),
    'tertiary': ('mid', 9), 'tertiary_link': ('mid', 6),
    'unclassified': ('minor', 7), 'residential': ('minor', 7),
    'living_street': ('minor', 6), 'service': ('minor', 4.5),
    'pedestrian': ('path', 6), 'footway': ('path', 3),
    'path': ('path', 2.5), 'steps': ('path', 2.5),
}


# ---------------------------------------------------------------- data.js 파싱

def load_days():
    """data.js 에서 일차별 스팟 좌표와 랜드마크 좌표를 뽑는다."""
    src = open(DATA_JS, encoding='utf-8').read()
    # 일차 시작 위치
    day_marks = [(m.start(), m.group(1)) for m in re.finditer(r"no:\s*'(\d{2})'", src)]
    if not day_marks:
        sys.exit('data.js 에서 일차를 찾지 못했습니다.')
    bounds = [(day_marks[i][0], day_marks[i][1],
               day_marks[i + 1][0] if i + 1 < len(day_marks) else len(src))
              for i in range(len(day_marks))]

    days = []
    for start, no, end in bounds:
        chunk = src[start:end]
        lm = None
        m = re.search(r"lm:\s*\{\s*lat:\s*(-?[\d.]+),\s*lng:\s*(-?[\d.]+)\s*\}", chunk)
        if m:
            lm = (float(m.group(1)), float(m.group(2)))
            chunk = chunk[:m.start()] + chunk[m.end():]   # 랜드마크는 스팟과 분리
        stops = []
        for sm in re.finditer(r"name:\s*'([^']*)'[\s\S]{0,400}?lat:\s*(-?[\d.]+),\s*lng:\s*(-?[\d.]+)", chunk):
            stops.append({'name': sm.group(1), 'lat': float(sm.group(2)), 'lng': float(sm.group(3))})
        days.append({'no': no, 'stops': stops, 'lm': lm})
    return days


# ---------------------------------------------------------------- 지오메트리

def meters(a, b):
    """a, b = (lat, lng) → 거리 m"""
    R = 6371000.0
    p1, p2 = math.radians(a[0]), math.radians(b[0])
    dp = p2 - p1
    dl = math.radians(b[1] - a[1])
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R * math.asin(math.sqrt(h))


def to_local(lat, lng, clat, clng):
    """위경도 → 타일 중심 기준 로컬 미터 (x=동, z=남)"""
    kx = 111320.0 * math.cos(math.radians(clat))
    kz = 110540.0
    return ((lng - clng) * kx, -(lat - clat) * kz)


def clip_line(pts, r):
    """원(반지름 r) 안쪽 구간만 남긴다. 여러 토막으로 갈릴 수 있다."""
    out, cur = [], []
    for i, p in enumerate(pts):
        inside = p[0] * p[0] + p[1] * p[1] <= r * r
        if inside:
            if not cur and i > 0:
                cur.append(edge_point(pts[i - 1], p, r))   # 들어오는 경계점
            cur.append(p)
        else:
            if cur:
                cur.append(edge_point(pts[i - 1], p, r))   # 나가는 경계점
                if len(cur) >= 2:
                    out.append(cur)
                cur = []
    if len(cur) >= 2:
        out.append(cur)
    return out


def edge_point(a, b, r):
    """선분 a-b 가 원과 만나는 지점 (a 쪽이 안이든 밖이든 이분법으로 충분)"""
    lo, hi = 0.0, 1.0
    for _ in range(24):
        t = (lo + hi) / 2
        x, y = a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t
        if x * x + y * y <= r * r:
            lo = t
        else:
            hi = t
    t = (lo + hi) / 2
    return (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)


def clip_polygon(pts, r, seg=32):
    """원을 정다각형으로 근사해 Sutherland–Hodgman 으로 자른다."""
    poly = pts[:]
    for k in range(seg):
        ang = 2 * math.pi * k / seg
        nx, ny = math.cos(ang), math.sin(ang)      # 바깥 법선
        d = r                                      # 반평면: nx*x + ny*y <= d
        nxt = []
        n = len(poly)
        if n == 0:
            return []
        for i in range(n):
            cur, prv = poly[i], poly[i - 1]
            cd = nx * cur[0] + ny * cur[1] - d
            pd = nx * prv[0] + ny * prv[1] - d
            if cd <= 0:
                if pd > 0:
                    t = pd / (pd - cd)
                    nxt.append((prv[0] + (cur[0] - prv[0]) * t, prv[1] + (cur[1] - prv[1]) * t))
                nxt.append(cur)
            elif pd <= 0:
                t = pd / (pd - cd)
                nxt.append((prv[0] + (cur[0] - prv[0]) * t, prv[1] + (cur[1] - prv[1]) * t))
        poly = nxt
    return poly


def stitch_rings(parts):
    """multipolygon 의 outer 멤버 way 들을 끝점끼리 이어 닫힌 링으로 만든다.
    카와구치코처럼 큰 호수는 링 하나가 way 여러 개로 쪼개져 있다."""
    def key(p):
        return (round(p['lat'], 7), round(p['lon'], 7))

    pool = [list(p) for p in parts if len(p) >= 2]
    rings = []
    while pool:
        ring = pool.pop(0)
        changed = True
        while changed and key(ring[0]) != key(ring[-1]):
            changed = False
            for i, cand in enumerate(pool):
                if key(cand[0]) == key(ring[-1]):
                    ring += cand[1:]
                elif key(cand[-1]) == key(ring[-1]):
                    ring += list(reversed(cand))[1:]
                elif key(cand[-1]) == key(ring[0]):
                    ring = cand[:-1] + ring
                elif key(cand[0]) == key(ring[0]):
                    ring = list(reversed(cand))[:-1] + ring
                else:
                    continue
                pool.pop(i)
                changed = True
                break
        if len(ring) >= 4:
            rings.append(ring)
    return rings


def simplify(pts, tol=1.5):
    """Douglas–Peucker. 1.5m 이하 굴곡은 버린다 — 파일 크기의 대부분이 여기서 준다."""
    if len(pts) < 3:
        return pts
    dmax, idx = 0.0, 0
    a, b = pts[0], pts[-1]
    dx, dy = b[0] - a[0], b[1] - a[1]
    den = math.hypot(dx, dy)
    for i in range(1, len(pts) - 1):
        p = pts[i]
        d = abs(dy * p[0] - dx * p[1] + b[0] * a[1] - b[1] * a[0]) / den if den > 1e-9 \
            else math.hypot(p[0] - a[0], p[1] - a[1])
        if d > dmax:
            dmax, idx = d, i
    if dmax > tol:
        return simplify(pts[:idx + 1], tol)[:-1] + simplify(pts[idx:], tol)
    return [a, b]


# ---------------------------------------------------------------- 조각 나누기

def build_tiles(days):
    """700m 단일 연결 클러스터링으로 스팟을 조각으로 묶는다."""
    places = []
    for d in days:
        for s in d['stops']:
            places.append({'lat': s['lat'], 'lng': s['lng'], 'name': s['name'], 'day': d['no']})
        if d['lm']:
            places.append({'lat': d['lm'][0], 'lng': d['lm'][1], 'name': f"랜드마크 {d['no']}", 'day': d['no']})

    # 같은 좌표는 한 번만
    uniq = []
    for p in places:
        if not any(meters((p['lat'], p['lng']), (q['lat'], q['lng'])) < 5 for q in uniq):
            uniq.append(p)

    groups = []
    for p in uniq:
        hit = [g for g in groups
               if any(meters((p['lat'], p['lng']), (q['lat'], q['lng'])) <= LINK_M for q in g)]
        if not hit:
            groups.append([p])
        else:
            merged = [p]
            for g in hit:
                merged += g
                groups.remove(g)
            groups.append(merged)

    tiles = []
    for i, g in enumerate(sorted(groups, key=lambda g: (g[0]['day'], g[0]['name']))):
        clat = sum(q['lat'] for q in g) / len(g)
        clng = sum(q['lng'] for q in g) / len(g)
        spread = max((meters((clat, clng), (q['lat'], q['lng'])) for q in g), default=0.0)
        r = max(MIN_R, min(MAX_R, spread + MARGIN_M))
        tiles.append({
            'id': f't{i:02d}',
            'lat': round(clat, 6), 'lng': round(clng, 6), 'r': round(r),
            'names': [q['name'] for q in g],
        })
    return tiles


# ---------------------------------------------------------------- Overpass

def bbox_for(t):
    dlat = t['r'] / 110540.0
    dlng = t['r'] / (111320.0 * math.cos(math.radians(t['lat'])))
    return (t['lat'] - dlat, t['lng'] - dlng, t['lat'] + dlat, t['lng'] + dlng)


def query(t, tries=5):
    """Overpass 는 429/504 를 자주 뱉는다. 지수 백오프로 재시도하고,
    그래도 안 되면 예외를 올려 해당 조각만 폴백으로 넘긴다."""
    delay = 8.0
    last = None
    for attempt in range(tries):
        host = OVERPASS_MIRRORS[attempt % len(OVERPASS_MIRRORS)]
        try:
            return _query_once(t, host)
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, OSError) as e:
            last = e
            code = getattr(e, 'code', None)
            if attempt == tries - 1:
                break
            short = host.split('//')[1].split('/')[0]
            print(f'      재시도 {attempt + 1}/{tries - 1} ({code or type(e).__name__} @ {short}) — {delay:.0f}초 대기')
            time.sleep(delay)
            delay *= 1.6
    raise last


def _query_once(t, host):
    s, w, n, e = bbox_for(t)
    box = f'{s},{w},{n},{e}'
    # 큰 호수·만은 way 가 아니라 multipolygon relation 으로 매핑돼 있다 (예: 카와구치코).
    # relation 도 함께 받고, out geom 으로 멤버 way 의 좌표까지 받는다.
    q = f"""[out:json][timeout:60];
(
  way["highway"]["area"!~"yes"]({box});
  way["natural"="water"]({box});
  way["waterway"="riverbank"]({box});
  way["natural"="coastline"]({box});
  way["leisure"~"^(park|garden)$"]({box});
  way["landuse"~"^(grass|forest|meadow|recreation_ground)$"]({box});
  way["railway"="rail"]({box});
  way["railway"~"^(subway|light_rail|monorail)$"]({box});
  node["railway"="station"]({box});
  rel["natural"="water"]({box});
  rel["leisure"~"^(park|garden)$"]({box});
  rel["landuse"~"^(grass|forest)$"]({box});
);
out geom;"""
    data = urllib.parse.urlencode({'data': q}).encode()
    req = urllib.request.Request(host, data=data,
                                 headers={'User-Agent': 'tokyo-diorama/1.0 (personal trip planner)'})
    with urllib.request.urlopen(req, timeout=90) as r:
        return json.loads(r.read().decode())


def convert(t, raw):
    """Overpass 응답 → 타일 로컬 미터 피처 목록"""
    feats = []
    r = float(t['r'])

    # relation 의 outer 멤버는 링의 '조각'이라 끝점끼리 이어붙여야 폴리곤이 된다.
    elements = []
    for el in raw.get('elements', []):
        if el.get('type') == 'relation':
            tags = el.get('tags', {})
            parts = [m['geometry'] for m in el.get('members', [])
                     if m.get('role') in ('outer', '') and m.get('geometry')]
            for ring in stitch_rings(parts):
                elements.append({'geometry': ring, 'tags': tags})
        else:
            elements.append(el)

    for el in elements:
        tags = el.get('tags', {})

        # 역은 점 하나다. 도쿄 지하철은 지하라 노선만으로는 어디가 역인지 알 수 없다.
        if el.get('type') == 'node' and tags.get('railway') == 'station':
            x, z = to_local(el['lat'], el['lon'], t['lat'], t['lng'])
            if x * x + z * z > r * r:
                continue
            feats.append({
                'k': 'station',
                'p': [round(x, 1), round(z, 1)],
                'n': tags.get('name', ''),
                'en': tags.get('name:en', ''),
                'sub': 1 if tags.get('station') == 'subway' else 0,
            })
            continue

        geom = el.get('geometry')
        if not geom or len(geom) < 2:
            continue
        pts = [to_local(g['lat'], g['lon'], t['lat'], t['lng']) for g in geom]

        hw = tags.get('highway')
        if hw:
            spec = ROAD_CLASS.get(hw)
            if not spec:
                continue
            cls, width = spec
            for seg in clip_line(pts, r):
                seg = simplify(seg)
                if len(seg) >= 2:
                    feats.append({'k': 'road', 'c': cls, 'w': width,
                                  'p': [[round(x, 1), round(z, 1)] for x, z in seg]})
            continue

        rw = tags.get('railway')
        if rw in ('rail', 'subway', 'light_rail', 'monorail'):
            # 지상 철도와 지하철을 구분해 둔다 — 렌더링에서 지하는 점선으로 깐다
            kind = 'rail' if rw == 'rail' else 'subway'
            for seg in clip_line(pts, r):
                seg = simplify(seg, 3.0)
                if len(seg) >= 2:
                    feats.append({'k': kind, 'line': tags.get('name', ''),
                                  'p': [[round(x, 1), round(z, 1)] for x, z in seg]})
            continue

        if tags.get('natural') == 'coastline':
            for seg in clip_line(pts, r):
                seg = simplify(seg, 4.0)
                if len(seg) >= 2:
                    feats.append({'k': 'coast', 'p': [[round(x, 1), round(z, 1)] for x, z in seg]})
            continue

        is_water = tags.get('natural') == 'water' or tags.get('waterway') == 'riverbank'
        is_green = tags.get('leisure') in ('park', 'garden') or \
            tags.get('landuse') in ('grass', 'forest', 'meadow', 'recreation_ground')
        if is_water or is_green:
            poly = clip_polygon(pts, r)
            poly = simplify(poly, 3.0) if len(poly) > 3 else poly
            if len(poly) >= 3:
                feats.append({'k': 'water' if is_water else 'green',
                              'p': [[round(x, 1), round(z, 1)] for x, z in poly]})
    return feats


# ---------------------------------------------------------------- main

def main():
    force = '--force' in sys.argv
    os.makedirs(OUT_DIR, exist_ok=True)
    days = load_days()
    print(f'일차 {len(days)}개, 스팟 {sum(len(d["stops"]) for d in days)}개')

    tiles = build_tiles(days)
    print(f'조각 {len(tiles)}장으로 묶임\n')

    total = 0
    for t in tiles:
        path = os.path.join(OUT_DIR, f'tile-{t["id"]}.json')
        if os.path.exists(path) and not force:
            t['bytes'] = os.path.getsize(path)
            total += t['bytes']
            print(f'  {t["id"]}  건너뜀 (이미 있음)  {", ".join(t["names"])[:44]}')
            continue
        try:
            raw = query(t)
        except (urllib.error.URLError, TimeoutError) as e:
            print(f'  {t["id"]}  실패: {e}  — 이 조각은 폴백으로 그려집니다')
            t['failed'] = True
            continue
        feats = convert(t, raw)
        if not feats:
            # 빈 응답은 지역 한정 미러를 탔다는 신호일 때가 많다. 저장하지 않고 다음 실행에서 다시 받는다.
            print(f'  {t["id"]}  피처 0개 — 저장하지 않음 (미러 문제이거나 실제로 빈 지역)')
            t['failed'] = True
            time.sleep(PAUSE_S)
            continue
        body = json.dumps({'id': t['id'], 'r': t['r'], 'f': feats}, separators=(',', ':'))
        open(path, 'w', encoding='utf-8').write(body)
        t['bytes'] = len(body)
        total += t['bytes']
        kinds = {}
        for f in feats:
            kinds[f['k']] = kinds.get(f['k'], 0) + 1
        print(f'  {t["id"]}  r={t["r"]}m  {len(feats):4d}피처 {len(body)/1024:6.1f}KB  '
              f'{kinds}  {", ".join(t["names"])[:40]}')
        time.sleep(PAUSE_S)

    manifest = [{k: v for k, v in t.items() if k in ('id', 'lat', 'lng', 'r', 'names')}
                for t in tiles if not t.get('failed')]
    open(os.path.join(OUT_DIR, 'tiles.json'), 'w', encoding='utf-8').write(
        json.dumps(manifest, ensure_ascii=False, separators=(',', ':')))
    print(f'\n합계 {total/1024:.0f} KB · 매니페스트 {len(manifest)}장')


if __name__ == '__main__':
    main()
