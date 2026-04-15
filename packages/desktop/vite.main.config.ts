import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import svgLoader from 'vite-svg-loader'
import { resolve } from 'path'

const __dirname = import.meta.dirname

export default defineConfig({
  build: {
    emptyOutDir: true,
    base: './',
    outDir: resolve(__dirname, 'dist/main'),
  },
  plugins: [vue(), svgLoader({ defaultImport: 'component' })],
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
    host: '0.0.0.0',
    port: 5173,
  },
})
