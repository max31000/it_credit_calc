import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
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
