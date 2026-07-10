import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { visualizer } from 'rollup-plugin-visualizer'

// https://vite.dev/config/
// GitHub Pages (project site): set VITE_BASE_PATH=/nombre-del-repo/ at build time.
export default defineConfig({
  base: process.env.VITE_BASE_PATH || '/',
  plugins: [
    react(),
    process.env.ANALYZE === 'true' &&
      visualizer({
        open: true,
        gzipSize: true,
        filename: 'dist/stats.html',
      }),
  ].filter(Boolean),
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:9001',
        changeOrigin: true,
      },
    },
  },
})
