# Tokyo Walk · React MapLibre

도쿄 여행(2026.10.17–22, 5박 6일) 인터랙티브 **3D 지도** 앱.

## 실행

```bash
cd app
npm install
npm run dev
```

http://localhost:5173

## 기능

- 날짜/장소 클릭 → MapLibre 카메라 이동
- 오늘 동선 · 3D/2D · 둘러보기 · Street View
- OpenFreeMap 건물 높이 입체 (실사 메쉬 아님)
- 후지(Day 05–06) Terrarium DEM 지형
- 일정 데이터: `src/data/itinerary.ts`

## 배포

루트 `vercel.json`이 `app/dist`를 빌드합니다.
