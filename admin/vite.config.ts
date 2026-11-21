/// <reference types="vitest/config" />
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

/** Files the saved copy leaves out: the worker itself, Cloudflare's header rules, pictures only emails use, source maps. */
const NOT_SAVED = new Set(['sw.js', '_headers', 'email-logo.png', 'index.html'])

/**
 * The saved copy of 4VD (public/sw.js): after the build, the worker in dist
 * gets the list of every file the dashboard needs to start without internet
 * ('/' for the page, never /index.html, which Cloudflare redirects) and a
 * release name made from those files' contents, so a new release (and only a
 * new release) installs a new saved copy.
 */
function savedCopyPlugin(): Plugin {
  let outDir = 'dist'
  return {
    name: '4vd-saved-copy',
    apply: 'build',
    configResolved(config) {
      outDir = config.build.outDir.startsWith('/') || /^[A-Za-z]:/.test(config.build.outDir) ? config.build.outDir : join(config.root, config.build.outDir)
    },
    closeBundle() {
      const files: string[] = []
      const walk = (dir: string) => {
        for (const name of readdirSync(dir)) {
          const path = join(dir, name)
          if (statSync(path).isDirectory()) walk(path)
          else files.push(relative(outDir, path).split(sep).join('/'))
        }
      }
      walk(outDir)
      const saved = files.filter((file) => !NOT_SAVED.has(file) && !file.endsWith('.map')).sort()
      const hash = createHash('sha256')
      let bytes = 0
      for (const file of ['index.html', ...saved]) {
        const content = readFileSync(join(outDir, file))
        bytes += content.length
        hash.update(file).update(content)
      }
      const worker = join(outDir, 'sw.js')
      const source = readFileSync(worker, 'utf8')
      // The worker's own code counts too: a change to it alone is a new release.
      const release = hash.update(source).digest('hex').slice(0, 16)
      if (!source.includes("'__4VD_RELEASE__'") || !source.includes('/* __4VD_PRECACHE__ */ []')) throw new Error('public/sw.js lost its RELEASE or PRECACHE marker')
      const list = JSON.stringify(['/', ...saved.map((file) => '/' + file)])
      writeFileSync(worker, source.replace("'__4VD_RELEASE__'", JSON.stringify(release)).replace('/* __4VD_PRECACHE__ */ []', list))
      console.log(`saved copy: release ${release}, ${saved.length + 1} files, ${(bytes / 1024 / 1024).toFixed(1)} MB`)
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), savedCopyPlugin()],
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
