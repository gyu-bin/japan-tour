# 도쿄 산책 · 규빈 & 아내 (2026.10.17–22)

React + Vite 단일 앱. 아이소메트릭 **3D 디오라마**와 **실측 MapLibre 지도**를 한 프로젝트에서 제공합니다.

## 실행

```bash
npm install
npm run dev
```

- 실측 지도: http://localhost:5173/
- 디오라마: http://localhost:5173/diorama

## 구성

| 경로 | 내용 |
|------|------|
| `src/pages/DioramaPage.tsx` | Three.js 디오라마 UI |
| `src/diorama/` | 디오라마 엔진 (씬·조명·OSM 타일·모형) |
| `src/pages/MapPage.tsx` | MapLibre 실측 지도 |
| `src/data/itinerary.ts` | 지도 앱 일정 데이터 |
| `src/diorama/data.js` | 디오라마 일정·투영 데이터 |
| `public/assets/` | GLB·OSM 타일·텍스처 |
| `legacy/` | 이전 바닐라 HTML 실험본 |
| `tools/` | OSM 타일 굽기 등 유틸 |

## 배포

Vercel이 루트에서 `npm run build` → `dist` 를 올립니다.

## 지도 다시 굽기

```bash
python3 tools/fetch-osm.py
# 결과 assets/osm → public/assets/osm 에도 맞춰 복사
cp -R assets/osm public/assets/
```
