import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { mvv42Html } from '@mvv42/kit/vite'

// base: '/credit_calc/' для VDS nginx, '/' для Vercel
const base = process.env.VITE_BASE_PATH ?? '/credit_calc/'

// https://vite.dev/config/
export default defineConfig({
  // mvv42Html(): inline-скрипт цветовой схемы (общий ключ mvv42-color-scheme) до первой отрисовки
  plugins: [react(), mvv42Html()],
  base,
  resolve: {
    // одна копия React/Mantine на страницу — кит приносит их как peer-зависимости
    dedupe: ['react', 'react-dom', '@mantine/core', '@mantine/hooks', '@mantine/notifications'],
  },
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: 'vendor', test: /node_modules\/(react|react-dom)[\\/]/ },
            { name: 'mantine', test: /node_modules\/@mantine[\\/]/ },
            { name: 'recharts', test: /node_modules\/(recharts|d3-|victory-)/ },
          ],
        },
      },
    },
  },
  server: {
    proxy: {
      // локальный mvv42-auth (`dotnet run` в mvv42-auth, Development): /auth/api/me, refresh, logout
      '/auth': {
        target: 'http://localhost:5010',
        changeOrigin: false,
      },
      '/credit_calc/api': {
        target: 'http://localhost:8080',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/credit_calc\/api/, '/api'),
      },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
  },
})
