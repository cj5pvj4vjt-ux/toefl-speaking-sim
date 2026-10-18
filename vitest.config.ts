import { defineConfig } from 'vitest/config'
import path from 'node:path'

/**
 * 单元测试配置。
 * 关键点：把 'electron' 映射到测试替身，这样主进程里的纯逻辑模块
 *（录音存储、设置存储、PDF 报告）也能在普通 Node 下直接测试，
 * 不需要启动 Electron，也不需要原生模块重编译。
 */
export default defineConfig({
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, 'src/shared'),
      '@database': path.resolve(__dirname, 'src/database'),
      '@main': path.resolve(__dirname, 'src/electron'),
      electron: path.resolve(__dirname, 'tests/stubs/electron.ts')
    }
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 30000,
    hookTimeout: 30000,
    reporters: ['default']
  }
})
