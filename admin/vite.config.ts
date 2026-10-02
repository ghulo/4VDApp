/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    // One bundle for the whole dashboard is fine for staff on a shop computer;
    // the line icons put it just over Vite's default 500 kB warning.
    chunkSizeWarningLimit: 600,
  },
  test: {
    // Tests read the real stylesheet (e.g. the colour contrast check), so don't stub CSS.
    css: true,
  },
})
