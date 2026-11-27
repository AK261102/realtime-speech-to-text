import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// In development the API and WebSocket run on the Express server (port 3000).
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:3000',
      '/ws': { target: 'ws://localhost:3000', ws: true },
    },
  },
})
