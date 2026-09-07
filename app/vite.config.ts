import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  build: {
    assetsInlineLimit: 0,
  },
  optimizeDeps: {
    include: ['maplibre-gl'],
  },
  server: {
    port: 5173,
    strictPort: true,
  },
})
