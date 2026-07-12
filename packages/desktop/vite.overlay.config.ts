import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import svgLoader from 'vite-svg-loader'
import { resolve } from 'path'

const __dirname = import.meta.dirname

export default defineConfig({
  build: {
    emptyOutDir: true,
    outDir: resolve(__dirname, 'dist/overlay'),
  },
  plugins: [vue(), svgLoader({ defaultImport: 'component' })],
  resolve: {
    alias: {
      '@desktop': resolve(__dirname, 'src'),
      '@twirchat/shared': resolve(__dirname, '../shared/index.ts'),
      '@twirchat/shared/constants': resolve(__dirname, '../shared/constants.ts'),
      '@twirchat/shared/protocol': resolve(__dirname, '../shared/protocol.ts'),
      '@twirchat/shared/types': resolve(__dirname, '../shared/types.ts'),
    },
  },
  root: 'src/views/overlay',
})
