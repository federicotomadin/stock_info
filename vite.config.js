import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
// GitHub Pages (project site): set VITE_BASE_PATH=/nombre-del-repo/ at build time.
export default defineConfig({
  base: process.env.VITE_BASE_PATH || '/',
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:9001',
        changeOrigin: true,
      },
    },
  },
})
