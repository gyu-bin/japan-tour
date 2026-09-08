import { Suspense, lazy } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'

const App = lazy(() => import('./App'))

createRoot(document.getElementById('root')!).render(
  <Suspense
    fallback={
      <div
        style={{
          minHeight: '100vh',
          display: 'grid',
          placeItems: 'center',
          background: '#070a09',
          color: '#fdf1e1',
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        도쿄 산책 불러오는 중…
      </div>
    }
  >
    <App />
  </Suspense>,
)
