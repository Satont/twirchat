import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import vue from '@vitejs/plugin-vue'
import svgLoader from 'vite-svg-loader'

const __dirname = import.meta.dirname

function wailsEmbedSentinel(): Plugin {
  let outputDir = ''

  return {
    apply: 'build',
    configResolved(config) {
      outputDir = config.build.outDir
    },
    name: 'wails-embed-sentinel',
    writeBundle() {
      mkdirSync(outputDir, { recursive: true })
      writeFileSync(join(outputDir, '.gitkeep'), '')
    },
  }
}

export default defineConfig({
  build: {
    emptyOutDir: true,
    outDir: resolve(__dirname, 'dist/main'),
  },
  plugins: [vue(), svgLoader({ defaultImport: 'component' }), wailsEmbedSentinel()],
  publicDir: resolve(__dirname, 'public'),
  resolve: {
    alias: {
      '@twirchat/shared/types': resolve(__dirname, '../shared/types.ts'),
      '@twirchat/shared/constants': resolve(__dirname, '../shared/constants.ts'),
      '@twirchat/shared/protocol': resolve(__dirname, '../shared/protocol.ts'),
      '@twirchat/shared': resolve(__dirname, '../shared/index.ts'),
      '@desktop': resolve(__dirname, 'src'),
    },
  },
  root: 'src/views/main',
  server: {
    host: '127.0.0.1',
    port: Number(process.env.WAILS_VITE_PORT) || 9245,
    strictPort: true,
  },
})
