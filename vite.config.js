import { defineConfig, loadEnv } from 'vite'
import { assertDeploymentEnvironment, deploymentRuntime, validateDeploymentEnvironment } from './scripts/deploymentEnvValidation.js'
import react from '@vitejs/plugin-react'
import dotenv from 'dotenv'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = path.dirname(fileURLToPath(import.meta.url))
if (process.env.BM_QA_MODE !== 'true') {
  dotenv.config({ path: path.join(projectRoot, '.env') })
  dotenv.config({ path: path.join(projectRoot, 'env') })
}

const API_PROXY_TARGET =
  process.env.BM_API_PROXY_TARGET || 'http://127.0.0.1:4000'

export default defineConfig(({ mode, command }) => {
  const environment = { ...loadEnv(mode, projectRoot, ''), ...process.env }
  const publicErrors = validateDeploymentEnvironment(environment, 'local', 'frontend')
  if (publicErrors.length) throw new Error(publicErrors.join('\n'))
  if (command === 'build' && deploymentRuntime(environment, 'frontend')) {
    assertDeploymentEnvironment(environment, 'frontend')
  }
  return {
  base: environment.VITE_BASE_PATH || '/',

  plugins: [react()],

  server: {
    port: 3000,
    strictPort: true,
    host: process.env.BM_QA_MODE === 'true' ? '127.0.0.1' : undefined,
    open: process.env.BM_QA_MODE !== 'true',
    proxy: {
      '/api': {
        target: API_PROXY_TARGET,
        changeOrigin: true,
        secure: false
      }
    }
  }
  }
})
