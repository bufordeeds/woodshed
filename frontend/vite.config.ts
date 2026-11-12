import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// `npm run dev` proxies the API to a locally running backend (override with VITE_PROXY_TARGET).
const target = process.env.VITE_PROXY_TARGET || 'http://localhost:8000'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    host: true,
    proxy: {
      '/api': { target, changeOrigin: true },
      
    },
  },
  build: { chunkSizeWarningLimit: 9000 },
})
