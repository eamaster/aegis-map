import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import * as crypto from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'

interface ViteManifestChunk {
  file: string
  src?: string
  isEntry?: boolean
  imports?: string[]
  css?: string[]
}

/**
 * Injects the exact build-derived precache manifest (version hash + shell, CSS,
 * entry JS, and lazy NearMeView transitive chunk graph) into dist/sw.js so
 * Service Worker updates are atomic, deterministic, and require zero manually
 * maintained asset hashes or duplicate version constants.
 */
function aegisServiceWorkerManifestPlugin(): Plugin {
  let resolvedOutDir = 'dist'
  let resolvedBase = '/aegis-map/'

  return {
    name: 'aegis-sw-precache-manifest',
    apply: 'build',
    configResolved(config) {
      resolvedOutDir = path.resolve(config.root, config.build.outDir)
      resolvedBase = config.base
    },
    closeBundle() {
      const manifestPath = path.join(resolvedOutDir, '.vite', 'manifest.json')
      const swPath = path.join(resolvedOutDir, 'sw.js')
      const indexHtmlPath = path.join(resolvedOutDir, 'index.html')

      if (!fs.existsSync(manifestPath) || !fs.existsSync(swPath) || !fs.existsSync(indexHtmlPath)) {
        throw new Error('Expected dist/.vite/manifest.json, dist/index.html, and dist/sw.js after build')
      }

      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as Record<string, ViteManifestChunk>
      const visitedKeys = new Set<string>()
      const assetFiles = new Set<string>()

      const collectKey = (key: string) => {
        if (visitedKeys.has(key)) return
        visitedKeys.add(key)
        const entry = manifest[key]
        if (!entry) return
        if (entry.file) assetFiles.add(entry.file)
        for (const cssFile of entry.css ?? []) {
          assetFiles.add(cssFile)
        }
        for (const importedKey of entry.imports ?? []) {
          collectKey(importedKey)
        }
      }

      let foundNearMeChunk = false
      for (const [key, chunk] of Object.entries(manifest)) {
        const normalizedKey = key.replace(/\\/g, '/')
        if (chunk.isEntry) {
          collectKey(key)
        }
        if (normalizedKey.endsWith('src/components/NearMeView.tsx')) {
          foundNearMeChunk = true
          collectKey(key)
        }
      }

      if (!foundNearMeChunk) {
        throw new Error('NearMeView.tsx chunk not found in Vite build manifest; refusing to emit incomplete offline SW')
      }

      // Also capture any modulepreload / stylesheet tags emitted directly into dist/index.html
      const indexHtml = fs.readFileSync(indexHtmlPath, 'utf-8')
      const attrRegex = /(?:src|href)="([^"]+)"/g
      let match: RegExpExecArray | null
      while ((match = attrRegex.exec(indexHtml)) !== null) {
        const ref = match[1]
        if (ref.startsWith('data:') || ref.startsWith('http:') || ref.startsWith('https:')) continue
        const stripped = ref.startsWith(resolvedBase)
          ? ref.slice(resolvedBase.length)
          : ref.replace(/^\.?\//, '')
        if (stripped && fs.existsSync(path.join(resolvedOutDir, stripped))) {
          assetFiles.add(stripped)
        }
      }

      const brandAssets = ['favicon.ico', 'favicon.svg', 'icons/favicon-32x32.png', 'icons/icon-192.png'].filter((rel) =>
        fs.existsSync(path.join(resolvedOutDir, rel)),
      )
      const sortedAssets = [
        './',
        'index.html',
        'manifest.webmanifest',
        ...brandAssets,
        ...Array.from(assetFiles).sort(),
      ]
      const dedupedAssets = Array.from(new Set(sortedAssets))

      const hasher = crypto.createHash('sha256')
      hasher.update(indexHtml)
      const webmanifestPath = path.join(resolvedOutDir, 'manifest.webmanifest')
      if (fs.existsSync(webmanifestPath)) {
        hasher.update(fs.readFileSync(webmanifestPath))
      }
      for (const rel of dedupedAssets) {
        hasher.update(rel)
      }
      const version = hasher.digest('hex').slice(0, 12)

      const swSource = fs.readFileSync(swPath, 'utf-8')
      const injectedPayload = `self.__AEGIS_PRECACHE__ = ${JSON.stringify({ version, assets: dedupedAssets })};`
      if (!swSource.includes('/* __AEGIS_PRECACHE_INJECT__ */')) {
        throw new Error('Missing /* __AEGIS_PRECACHE_INJECT__ */ marker in public/sw.js')
      }
      fs.writeFileSync(swPath, swSource.replace('/* __AEGIS_PRECACHE_INJECT__ */', injectedPayload), 'utf-8')
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), aegisServiceWorkerManifestPlugin()],
  base: '/aegis-map/',
  server: {
    fs: {
      allow: [path.resolve(__dirname, '..')],
    },
  },
  build: {
    manifest: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('mapbox-gl')) return 'mapbox-gl'
          if (id.includes('satellite.js')) return 'satellite-js'
          if (id.includes('node_modules/react') || id.includes('node_modules/react-dom')) return 'react-vendor'
        },
      },
    },
  },
})
