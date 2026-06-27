import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // 测试环境设置
    environment: 'jsdom',
    globals: true,

    // 覆盖率配置
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'dist/',
        '**/*.test.js',
        '**/*.spec.js',
        '**/config/',
        'coverage/',
        'vitest.config.js'
      ],
      thresholds: {
        global: {
          branches: 70,
          functions: 70,
          lines: 70,
          statements: 70
        }
      }
    },

    // 测试文件匹配模式
    include: [
      'tests/**/*.{test,spec}.{js,ts}',
      'src/**/__tests__/**/*.{js,ts}',
      'src/**/*.{test,spec}.{js,ts}'
    ],

    // 排除文件
    exclude: [
      'node_modules/',
      'dist/',
      '.git/',
      'coverage/'
    ],

    // 测试超时设置
    testTimeout: 10000,
    hookTimeout: 10000,

    // bail:1 会在首个失败文件后跳过其余测试（如 7 个文件 / 200+ 用例被连带跳过），
    // 掩盖真实通过/失败全貌。CI 与本地都应看完整结果，故关闭。
    bail: 0,

    // 详细输出
    verbose: true,

    // 监视模式忽略文件
    watchExclude: [
      'node_modules/',
      'dist/',
      'coverage/'
    ]
  },

  // 别名配置（如果需要）
  resolve: {
    alias: {
      '@': new URL('./src', import.meta.url).pathname,
      '@tests': new URL('./tests', import.meta.url).pathname
    }
  },

  // 定义全局变量（模拟Cloudflare Workers环境）
  define: {
    global: 'globalThis'
  }
});