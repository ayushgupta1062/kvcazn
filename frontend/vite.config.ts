import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// In development the UI runs on :5173 and forwards /api to the FastAPI server on :8000.
export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': 'http://127.0.0.1:8000' } },
  build: { outDir: 'dist' },
  test: { environment: 'node' },
})
