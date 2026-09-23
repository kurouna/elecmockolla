import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url))

// Electron resolves `app.getVersion()` from the app directory's package.json.
// `out/` has none, so the real version is baked in at build time.
const pkg = JSON.parse(readFileSync(r('package.json'), 'utf8')) as { version: string }
const define = { __APP_VERSION__: JSON.stringify(pkg.version) }

export default defineConfig({
  main: {
    define,
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: r('src/main/index.ts'),
          // The mock server itself, forked as an Electron utilityProcess.
          'server.worker': r('src/main/server.worker.ts'),
        },
      },
    },
  },

  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: r('src/preload/index.ts') },
        // Preload runs sandboxed: it must be a single CommonJS file.
        output: { format: 'cjs', entryFileNames: '[name].cjs' },
      },
    },
  },

  renderer: {
    root: r('src/renderer'),
    define,
    plugins: [svelte({ configFile: r('svelte.config.js') })],
    build: {
      target: 'chrome140',
      rollupOptions: { input: { index: r('src/renderer/index.html') } },
    },
  },
})
