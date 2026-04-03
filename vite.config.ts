import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// base: '/credit_calc/' для VDS nginx, '/' для Vercel
const base = process.env.VITE_BASE_PATH ?? '/credit_calc/'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  base,
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
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
  },
})
