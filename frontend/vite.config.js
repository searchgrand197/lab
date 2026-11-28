import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const isDemo = env.VITE_DEMO === '1'
  return {
    plugins: [react()],
    base: isDemo ? '/demo/' : '/',
    build: {
      // Folder name `demo` matches URL /demo/ so nginx can use root + try_files.
      outDir: isDemo ? 'demo' : 'dist',
      emptyOutDir: true,
    },
    server: {
      port: 5173,
      proxy: {
        '/api': {
          target: 'http://127.0.0.1:8000',
          changeOrigin: true,
        },
        '/demo-api': {
          target: 'http://127.0.0.1:8000',
          changeOrigin: true,
        },
        '/media': {
          target: 'http://127.0.0.1:8000',
          changeOrigin: true,
        },
        // Only mobile share links (/r/<uuid>/…) — must NOT match /reports
        '^/r/': {
          target: 'http://127.0.0.1:8000',
          changeOrigin: true,
        },
      },
    },
  }
})
