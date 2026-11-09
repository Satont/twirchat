import { resolve } from 'path'

import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'
import svgLoader from 'vite-svg-loader'

const __dirname = import.meta.dirname

export default defineConfig({
  build: {
    emptyOutDir: true,
    outDir: resolve(__dirname, 'dist/overlay'),
  },
  plugins: [vue(), svgLoader({ defaultImport: 'component' })],
  resolve: {
    alias: [
      { find: '@desktop', replacement: resolve(__dirname, 'src') },
      { find: /^@twirchat\/shared$/, replacement: resolve(__dirname, '../shared/index.ts') },
      {
        find: '@twirchat/shared/constants',
        replacement: resolve(__dirname, '../shared/constants.ts'),
      },
      {
        find: '@twirchat/shared/protocol',
        replacement: resolve(__dirname, '../shared/protocol.ts'),
      },
      { find: '@twirchat/shared/types', replacement: resolve(__dirname, '../shared/types.ts') },
    ],
  },
  root: 'src/views/overlay',
})
