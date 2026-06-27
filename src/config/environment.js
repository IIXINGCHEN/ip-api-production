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

import {
  createEnvironmentConfig
} from './baseConfig.js';

// 特定环境配置
export const ENV_CONFIG = {
  production: createEnvironmentConfig({
    security: {
      strictMode: true,
      hideErrorDetails: true,
      requireHTTPS: true,
      blockSuspiciousIPs: true,
      enforceSecurityHeaders: true // 🔒 强制安全头
    },
    logging: {
      level: 'error',
      logSensitiveData: false, // 🔒 生产环境绝不记录敏感数据
      enableDebug: false,
      enableTrace: false
    },
    api: {
      corsOrigins: [
        'https://ip.ixingchen.top',
        'https://ixingchen.top',
        'https://*.ixingchen.top'
      ]
    }
  }),

  staging: createEnvironmentConfig({
    security: {
      strictMode: true,
      hideErrorDetails: false, // 显示错误用于调试
      requireHTTPS: true
    },
    logging: {
      level: 'warn',
      enableDebug: true
    },
    cache: {
      ttl: {
        ip: 60,    // 1分钟
        geo: 300,  // 5分钟
        threat: 180 // 3分钟
      },
      maxSize: 500
    },
    rateLimit: {
      max: 200 // 测试环境更高限制
    },
    api: {
      corsOrigins: [
        'https://ip.ixingchen.top',
        'https://ixingchen.top',
        'https://*.ixingchen.top',
        'https://staging.ixingchen.top',
        'http://localhost:3000',
        'http://localhost:8080'
      ],
      maxRequestSize: '2mb'
    },
    monitoring: {
      alertThresholds: {
        responseTime: 2000,
        errorRate: 0.1,
        memoryUsage: 0.9
      }
    }
  }),

  development: createEnvironmentConfig({
    security: {
      strictMode: false,
      hideErrorDetails: false,
      requireHTTPS: false
    },
    logging: {
      level: 'debug',
      enableDebug: true,
      enableTrace: true,
      logSensitiveData: false // 🔒 安全修复：即使开发环境也不记录敏感数据
    },
    cache: {
      enabled: false, // 开发环境禁用缓存
      ttl: {
        ip: 10,
        geo: 30,
        threat: 20
      },
      maxSize: 100
    },
    rateLimit: {
      max: 1000, // 开发环境宽松限制
      skipSuccessfulRequests: true,
      skipFailedRequests: true
    },
    api: {
      corsOrigins: [
        'http://localhost:3000',
        'http://localhost:8080',
        'http://localhost:5173',
        'http://127.0.0.1:3000',
        'http://127.0.0.1:8080',
        'http://127.0.0.1:5173'
      ],
      enableCompression: false,
      enableETag: false,
      maxRequestSize: '10mb'
    },
    monitoring: {
      enableMetrics: false,
      enablePerformanceTracking: false,
      alertThresholds: {
        responseTime: 5000,
        errorRate: 0.5,
        memoryUsage: 0.95
      }
    }
  })
};

// 获取当前环境配置
export function getCurrentConfig() {
  return ENV_CONFIG[ENVIRONMENT.current] || ENV_CONFIG.development;
}

// 检查功能是否在当前环境中启用
export function isFeatureEnabled(feature) {
  const config = getCurrentConfig();

  switch (feature) {
  case 'debug':
    return config.logging.enableDebug;
  case 'cache':
    return config.cache.enabled;
  case 'rateLimit':
    return config.rateLimit.enabled;
  case 'monitoring':
    return config.monitoring.enableMetrics;
  case 'securityHeaders':
    return config.security.enableSecurityHeaders;
  default:
    return false;
  }
}

// 历史的 getSecret / validateEnvironment / checkSensitiveDataLogging / secureLog /
// filterSensitiveData（凭证校验与安全日志工具）已移除：0 外部引用，且凭证源已统一到
// security.js PROVIDERS_CONFIG。安全日志统一用 src/utils/secureLogger.js。
