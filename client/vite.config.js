import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// In development the API and WebSocket run on the Express server (port 3000).
// Set API_TARGET to point the dev UI at another backend, e.g. a deployed instance.
const target = process.env.API_TARGET || 'http://localhost:3000'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': { target, changeOrigin: true },
      '/ws': { target: target.replace(/^http/, 'ws'), ws: true, changeOrigin: true },
    },
  },
})
