/**
 * 基础配置模板
 * 减少环境配置间的重复定义
 */

// 基础安全配置
export const BASE_SECURITY_CONFIG = {
  strictMode: false,
  hideErrorDetails: false,
  enableSecurityHeaders: true,
  requireHTTPS: false,
  enableCSP: true,
  blockSuspiciousIPs: false,
};

// 基础日志配置
export const BASE_LOGGING_CONFIG = {
  level: "info",
  enableDebug: false,
  enableTrace: false,
  logSensitiveData: false,
};

// 基础缓存配置
export const BASE_CACHE_CONFIG = {
  enabled: true,
  ttl: {
    ip: 300,    // 5分钟
    geo: 3600,  // 1小时
    threat: 1800, // 30分钟
  },
  maxSize: 1000,
};

// 基础限流配置
export const BASE_RATE_LIMIT_CONFIG = {
  enabled: true,
  windowMs: 15 * 60 * 1000, // 15分钟
  max: 100,
  skipSuccessfulRequests: false,
  skipFailedRequests: false,
};

// 基础API配置
export const BASE_API_CONFIG = {
  enableCORS: true,
  corsOrigins: [],
  enableCompression: true,
  enableETag: true,
  maxRequestSize: "1mb",
};

// 基础监控配置
export const BASE_MONITORING_CONFIG = {
  enableMetrics: true,
  enableHealthChecks: true,
  enablePerformanceTracking: true,
  alertThresholds: {
    responseTime: 1000,
    errorRate: 0.05,
    memoryUsage: 0.8,
  },
};

/**
 * 深度合并配置对象
 */
export function mergeConfig(base, override) {
  const result = { ...base };

  for (const [key, value] of Object.entries(override)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      result[key] = mergeConfig(base[key] || {}, value);
    } else {
      result[key] = value;
    }
  }

  return result;
}

/**
 * 创建环境特定配置
 */
export function createEnvironmentConfig(overrides = {}) {
  return {
    security: mergeConfig(BASE_SECURITY_CONFIG, overrides.security || {}),
    logging: mergeConfig(BASE_LOGGING_CONFIG, overrides.logging || {}),
    cache: mergeConfig(BASE_CACHE_CONFIG, overrides.cache || {}),
    rateLimit: mergeConfig(BASE_RATE_LIMIT_CONFIG, overrides.rateLimit || {}),
    api: mergeConfig(BASE_API_CONFIG, overrides.api || {}),
    monitoring: mergeConfig(BASE_MONITORING_CONFIG, overrides.monitoring || {}),
  };
}