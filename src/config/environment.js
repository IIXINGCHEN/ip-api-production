/**
 * Environment-specific configuration management
 * Handles production, staging, and development environment settings
 */

// 检测当前环境 - 动态检测而不是缓存
export const ENVIRONMENT = {
  get current() {
    return getEnvironment();
  },
  isProduction: () => getEnvironment() === 'production',
  isStaging: () => getEnvironment() === 'staging',
  isDevelopment: () => getEnvironment() === 'development'
};

function getEnvironment() {
  // 检查显式环境变量 (优先级最高)
  if (globalThis.ENVIRONMENT) {
    return globalThis.ENVIRONMENT.toLowerCase();
  }

  // 检查process.env.NODE_ENV（用于测试环境）
  if (typeof process !== 'undefined' && process.env && process.env.NODE_ENV) {
    return process.env.NODE_ENV.toLowerCase();
  }

  // 检查Cloudflare Workers环境指示器
  // caches 全局在 Workers 上存在、在 Node 中不存在，是可靠的运行时信号。
  // 旧实现额外要求 CloudflareWorkersGlobalScope（非标准全局，从未被 Workers 定义），
  // 导致该分支永不触发，真实 Worker 若无显式 WORKER_ENV 会错误回落到 'development'。
  if (typeof caches !== 'undefined') {
    if (globalThis.WORKER_ENV === 'production') {
      return 'production';
    }
    if (globalThis.WORKER_ENV === 'staging') {
      return 'staging';
    }
    return 'development';
  }

  // 检查Vercel环境
  if (globalThis.VERCEL_ENV) {
    return globalThis.VERCEL_ENV === 'production' ? 'production' : 'staging';
  }

  // 检查Vercel特定的worker环境
  if (globalThis.WORKER_ENV === 'vercel') {
    return 'production';
  }

  // 检查Netlify环境
  if (globalThis.NETLIFY) {
    return globalThis.CONTEXT === 'production' ? 'production' : 'staging';
  }

  // 默认为开发环境
  return 'development';
}

// 历史的 ENV_CONFIG / getCurrentConfig / isFeatureEnabled（第二套配置树，仅服务
// secureLogger）已移除：0 外部引用，CORS/metrics 等配置统一走 configManager。
// secureLogger.performance 改读 config.get('monitoring.enableMetrics', true)。
// 凭证源统一到 security.js PROVIDERS_CONFIG；安全日志用 src/utils/secureLogger.js。
