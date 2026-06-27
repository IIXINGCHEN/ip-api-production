/**
 * ESLint配置 - 生产环境标准 (ESM)
 * 支持 Cloudflare Workers、Node.js 测试工具和现代 Web API。
 */

const runtimeGlobals = {
  AbortSignal: 'readonly',
  atob: 'readonly',
  btoa: 'readonly',
  Bun: 'readonly',
  caches: 'readonly',
  clearInterval: 'readonly',
  clearTimeout: 'readonly',
  CloudflareWorkersGlobalScope: 'readonly',
  console: 'readonly',
  Deno: 'readonly',
  fetch: 'readonly',
  global: 'readonly',
  globalThis: 'readonly',
  Headers: 'readonly',
  navigator: 'readonly',
  performance: 'readonly',
  process: 'readonly',
  Request: 'readonly',
  Response: 'readonly',
  setInterval: 'readonly',
  setTimeout: 'readonly',
  TextDecoder: 'readonly',
  TextEncoder: 'readonly',
  URL: 'readonly',
  URLSearchParams: 'readonly'
};

const testGlobals = {
  afterAll: 'readonly',
  afterEach: 'readonly',
  beforeAll: 'readonly',
  beforeEach: 'readonly',
  describe: 'readonly',
  expect: 'readonly',
  it: 'readonly',
  test: 'readonly',
  vi: 'readonly'
};

export default [
  {
    ignores: [
      'node_modules/',
      'dist/',
      'coverage/',
      '*.min.js'
    ],

    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: runtimeGlobals
    },

    rules: {
      // 错误预防
      'no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
        varsIgnorePattern: '^_'
      }],
      'no-undef': 'error',
      'no-console': 'off',
      'prefer-const': 'error',
      'no-var': 'error',

      // 代码质量
      'semi': ['error', 'always'],
      'quotes': ['error', 'single'],
      'indent': ['error', 2],
      'comma-dangle': ['error', 'never'],
      'object-curly-spacing': ['error', 'always'],
      'array-bracket-spacing': ['error', 'never'],
      'space-before-function-paren': ['error', 'never'],

      // 安全最佳实践
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'no-script-url': 'error',

      // 现代JavaScript最佳实践
      'prefer-arrow-callback': 'error',
      'arrow-spacing': 'error',
      'no-duplicate-imports': 'error',
      'no-self-compare': 'error',
      'no-unmodified-loop-condition': 'error',
      'no-unreachable-loop': 'error',

      // Node.js最佳实践
      'no-mixed-requires': 'error',
      'no-new-require': 'error',
      'no-path-concat': 'error',

      // 性能相关
      'no-loop-func': 'error',

      // 代码风格
      'eol-last': 'error',
      'no-trailing-spaces': 'error',
      'no-multiple-empty-lines': ['error', { max: 1 }],
      'max-len': ['warn', { code: 120, ignoreComments: true }],

      // 注释规范
      'spaced-comment': ['error', 'always']
    },

    linterOptions: {
      reportUnusedDisableDirectives: 'error'
    }
  },
  {
    files: ['tests/**/*.js'],
    languageOptions: {
      globals: {
        ...runtimeGlobals,
        ...testGlobals
      }
    },
    rules: {
      'no-script-url': 'off',
      'no-unused-vars': 'off'
    }
  }
];
