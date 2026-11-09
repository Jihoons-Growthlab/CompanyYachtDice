import { fileURLToPath } from 'node:url'
import { defineConfig, searchForWorkspaceRoot } from 'vite'
import vue from '@vitejs/plugin-vue'

const webRoot = fileURLToPath(new URL('.', import.meta.url))
const sharedRoot = fileURLToPath(new URL('../../packages/shared/', import.meta.url))
// API 서버(apps/server). 같은 출처로 프록시해야 HttpOnly·SameSite=Strict refresh 쿠키가 동작한다.
const api = process.env.API_PROXY_TARGET ?? 'http://127.0.0.1:3000'

export default defineConfig({
  plugins: [vue()],
  server: {
    fs: { allow: [searchForWorkspaceRoot(webRoot), sharedRoot] },
    proxy: {
      '/api': { target: api },
      '/socket.io': { target: api, ws: true },
    },
  },
})
