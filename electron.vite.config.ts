import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

const root = process.cwd()

const sharedAlias = {
  '@shared': resolve(root, 'src/shared'),
  '@database': resolve(root, 'src/database'),
  '@main': resolve(root, 'src/electron')
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: sharedAlias },
    build: {
      outDir: 'out/main',
      minify: false,
      sourcemap: true,
      lib: {
        entry: resolve(root, 'src/electron/main.ts')
      },
      rollupOptions: {
        output: {
          format: 'cjs',
          entryFileNames: 'main.js',
          chunkFileNames: '[name].js'
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: sharedAlias },
    build: {
      outDir: 'out/preload',
      minify: false,
      sourcemap: true,
      lib: {
        entry: resolve(root, 'src/electron/preload.ts')
      },
      rollupOptions: {
        output: {
          format: 'cjs',
          entryFileNames: 'preload.js',
          chunkFileNames: '[name].js'
        }
      }
    }
  },
  renderer: {
    root: resolve(root, 'src/renderer'),
    resolve: {
      alias: {
        '@': resolve(root, 'src/renderer/src'),
        '@shared': resolve(root, 'src/shared')
      }
    },
    plugins: [react()],
    build: {
      outDir: 'out/renderer',
      sourcemap: true,
      chunkSizeWarningLimit: 4096,
      rollupOptions: {
        input: resolve(root, 'src/renderer/index.html')
      }
    }
  }
})
