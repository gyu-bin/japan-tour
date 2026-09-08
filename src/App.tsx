import { lazy, Suspense } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'

const DioramaPage = lazy(() => import('./pages/DioramaPage'))
const AstraDioramaPage = lazy(() => import('./pages/AstraDioramaPage'))
const MapPage = lazy(() => import('./pages/MapPage'))

function Fallback() {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        background: '#e9e6df',
        color: '#3a352e',
        fontFamily: 'system-ui, sans-serif',
        fontWeight: 700,
      }}
    >
      도쿄 산책 불러오는 중…
    </div>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<Fallback />}>
        <Routes>
          <Route path="/" element={<MapPage />} />
          <Route path="/diorama" element={<DioramaPage />} />
          <Route path="/astra" element={<AstraDioramaPage />} />
          <Route path="/map" element={<Navigate to="/" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  )
}
