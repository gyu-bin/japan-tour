/** 라벨 겹침 정리
 *
 *  우선순위: 선택된 스팟 > 일정 순서.
 *  자리가 없으면 번호 배지만 남기고, 그마저 안 되면 감춘다.
 */
import { viewSize } from './core.js';

/* ============ 라벨 겹침 정리 ============
 * 우선순위: 선택된 스팟 > 먹기 > 이른 순번.
 * 자리가 없으면 번호 배지만 남기고, 그마저 안 되면 감춘다.
 * 화면 좌표는 직접 투영해서 구한다 — 매 프레임 getBoundingClientRect 를 부르지 않기 위해서. */
let declutterT = 0;
const TRANSLATE_RE = /translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)(?!.*translate)/;

/** CSS2DRenderer 가 방금 써 넣은 위치를 그대로 읽는다.
 *  직접 재투영하면 카메라 행렬 갱신 시점이 어긋나 화면과 다른 좌표가 나온다. */
function chipCenter(el) {
  const m = TRANSLATE_RE.exec(el.style.transform || '');
  return m ? { x: +m[1], y: +m[2] } : null;
}

/**
 * @param {number} dt   경과 시간(초)
 * @param {object} ctx  { markers, selIdx, zoom, panelEl } — 상태는 index.html 이 들고 있다
 */
function declutterChips(dt, ctx) {
  const { markers, selIdx, zoom, panelEl } = ctx;
  declutterT -= dt;
  if (declutterT > 0) return;
  declutterT = 0.1;

  const uiRects = [document.getElementById('head'), panelEl, document.getElementById('pager')]
    .filter(e => e && getComputedStyle(e).display !== 'none')
    .map(e => {
      const r = e.getBoundingClientRect();
      return { l: r.left, r: r.right, t: r.top, b: r.bottom };
    });

  const hits = (a, b) => a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t;
  // full = 라벨 전체가 차지하는 자리, core = 번호 배지만의 자리.
  // 축약 배지는 core 끼리만 안 부딪히면 된다 — 긴 라벨 꼬리 옆에 붙어도 읽힌다.
  const placed = [];

  // 선택된 스팟이 최우선, 나머지는 일정 순서대로. 번호 순서와 화면이 어긋나지 않게.
  const order = markers
    .filter(m => m.group.visible && m.label.visible)
    .sort((a, b) => (b.idx === selIdx) - (a.idx === selIdx) || a.idx - b.idx);

  // 같은 건물에 묶인 스팟들의 라벨은 화면상 일정 간격으로 쌓는다.
  // 월드 오프셋으로 두면 축소했을 때 간격이 같이 줄어 결국 겹친다.
  const unitPerPx = (2 * viewSize) / (Math.max(innerHeight, 1) * zoom);
  for (const m of markers) {
    if (m.tier) m.label.position.y = 3.1 + m.tier * 34 * unitPerPx;
  }

  for (const m of order) {
    const el = m.chipEl;
    if (el.style.display === 'none') continue;          // 렌더러가 이미 감춘 라벨
    const c = chipCenter(el);
    if (!c) continue;                                    // 아직 위치가 안 잡혔다
    if (!m.chipW && !el.classList.contains('mini')) {
      m.chipW = el.offsetWidth || 120;
      m.chipH = el.offsetHeight || 28;
    }
    const w = m.chipW || 120, h = m.chipH || 28;

    const rectFor = (rw, rh) => ({ l: c.x - rw / 2 - 2, r: c.x + rw / 2 + 2, t: c.y - rh / 2 - 2, b: c.y + rh / 2 + 2 });
    const full = rectFor(w, h);
    const core = rectFor(28, 28);

    // UI 카드 뒤로 들어가면 어차피 안 보인다
    if (uiRects.some(u => hits(core, u))) { el.style.visibility = 'hidden'; continue; }

    if (!placed.some(p => hits(full, p.full))) {
      el.classList.remove('mini');
      el.style.visibility = '';
      placed.push({ full, core });
    } else if (!placed.some(p => hits(core, p.core))) {
      el.classList.add('mini');
      el.style.visibility = '';
      placed.push({ full: core, core });
    } else {
      el.style.visibility = 'hidden';
    }
  }
}

export { declutterChips };
