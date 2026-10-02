/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  test: {
    // Tests read the real stylesheet (e.g. the colour contrast check), so don't stub CSS.
    css: true,
  },
})
