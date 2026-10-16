/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          // React, the router and the data cache change far less often than our own code,
          // so they get their own file that browsers keep between releases.
          groups: [{ name: 'vendor', test: /node_modules[\/](react|react-dom|scheduler|react-router|@tanstack)[\/]/ }],
        },
      },
    },
  },
  test: {
    // Tests read the real stylesheet (e.g. the colour contrast check), so don't stub CSS.
    css: true,
  },
})
