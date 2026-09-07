import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  build: {
    assetsInlineLimit: 0,
  },
  optimizeDeps: {
    // MapLibre v6 worker can break if pre-bundled
    exclude: ['maplibre-gl'],
  },
  worker: {
    format: 'es',
  },
  server: {
    port: 5173,
    strictPort: true,
  },
})
