import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const API_PROXY_TARGET =
  process.env.BM_API_PROXY_TARGET || 'http://localhost:4000'

export default defineConfig({
  base: '/BM-Printing-Services/',

  plugins: [react()],

  server: {
    port: 3000,
    open: true,
    proxy: {
      '/api': {
        target: API_PROXY_TARGET,
        changeOrigin: true,
        secure: false
      }
    }
  }
})
