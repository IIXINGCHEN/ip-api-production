/**
 * Environment-specific configuration management
 * Handles production, staging, and development environment settings
 */

// Detect current environment
export const ENVIRONMENT = {
  current: getEnvironment(),
  isProduction: () => ENVIRONMENT.current === "production",
  isStaging: () => ENVIRONMENT.current === "staging",
  isDevelopment: () => ENVIRONMENT.current === "development",
};

function getEnvironment() {
  // Check for explicit environment variable
  if (globalThis.ENVIRONMENT) {
    return globalThis.ENVIRONMENT.toLowerCase();
  }

  // Check for Cloudflare Workers environment indicators
  if (
    typeof caches !== "undefined" &&
    typeof CloudflareWorkersGlobalScope !== "undefined"
  ) {
    // In production, workers_dev should be false
    if (globalThis.WORKER_ENV === "production") {
      return "production";
    }
    if (globalThis.WORKER_ENV === "staging") {
      return "staging";
    }
    return "development";
  }

  // Check for Vercel environment
  if (globalThis.VERCEL_ENV) {
    return globalThis.VERCEL_ENV === "production" ? "production" : "staging";
  }

  // Check for Vercel-specific worker environment
  if (globalThis.WORKER_ENV === "vercel") {
    return "production";
  }

  // Check for Netlify environment
  if (globalThis.NETLIFY) {
    return globalThis.CONTEXT === "production" ? "production" : "staging";
  }

  // Default to development
  return "development";
}

import { createEnvironmentConfig } from "./baseConfig.js";

// Environment-specific configurations
export const ENV_CONFIG = {
  production: createEnvironmentConfig({
    security: {
      strictMode: true,
      hideErrorDetails: true,
      requireHTTPS: true,
      blockSuspiciousIPs: true,
    },
    logging: {
      level: "error",
    },
    api: {
      corsOrigins: [
        "https://ip.ixingchen.top",
        "https://ixingchen.top",
        "https://*.ixingchen.top",
      ],
    },
  }),

  staging: createEnvironmentConfig({
    security: {
      strictMode: true,
      hideErrorDetails: false, // 显示错误用于调试
      requireHTTPS: true,
    },
    logging: {
      level: "warn",
      enableDebug: true,
    },
    cache: {
      ttl: {
        ip: 60,    // 1分钟
        geo: 300,  // 5分钟
        threat: 180, // 3分钟
      },
      maxSize: 500,
    },
    rateLimit: {
      max: 200, // 测试环境更高限制
    },
    api: {
      corsOrigins: [
        "https://ip.ixingchen.top",
        "https://ixingchen.top",
        "https://*.ixingchen.top",
        "https://staging.ixingchen.top",
        "http://localhost:3000",
        "http://localhost:8080",
      ],
      maxRequestSize: "2mb",
    },
    monitoring: {
      alertThresholds: {
        responseTime: 2000,
        errorRate: 0.1,
        memoryUsage: 0.9,
      },
    },
  }),

  development: createEnvironmentConfig({
    security: {
      strictMode: false,
      hideErrorDetails: false,
      requireHTTPS: false,
    },
    logging: {
      level: "debug",
      enableDebug: true,
      enableTrace: true,
      logSensitiveData: true, // 仅开发环境！
    },
    cache: {
      enabled: false, // 开发环境禁用缓存
      ttl: {
        ip: 10,
        geo: 30,
        threat: 20,
      },
      maxSize: 100,
    },
    rateLimit: {
      max: 1000, // 开发环境宽松限制
      skipSuccessfulRequests: true,
      skipFailedRequests: true,
    },
    api: {
      corsOrigins: [
        "http://localhost:3000",
        "http://localhost:8080",
        "http://localhost:5173",
        "http://127.0.0.1:3000",
        "http://127.0.0.1:8080",
        "http://127.0.0.1:5173",
      ],
      enableCompression: false,
      enableETag: false,
      maxRequestSize: "10mb",
    },
    monitoring: {
      enableMetrics: false,
      enablePerformanceTracking: false,
      alertThresholds: {
        responseTime: 5000,
        errorRate: 0.5,
        memoryUsage: 0.95,
      },
    },
  }),
};

// Get current environment configuration
export function getCurrentConfig() {
  return ENV_CONFIG[ENVIRONMENT.current] || ENV_CONFIG.development;
}

// Get environment-specific setting
export function getEnvSetting(path) {
  const config = getCurrentConfig();
  const keys = path.split(".");
  let value = config;

  for (const key of keys) {
    if (value && typeof value === "object" && key in value) {
      value = value[key];
    } else {
      return undefined;
    }
  }

  return value;
}

// Check if feature is enabled in current environment
export function isFeatureEnabled(feature) {
  const config = getCurrentConfig();

  switch (feature) {
    case "debug":
      return config.logging.enableDebug;
    case "cache":
      return config.cache.enabled;
    case "rateLimit":
      return config.rateLimit.enabled;
    case "monitoring":
      return config.monitoring.enableMetrics;
    case "securityHeaders":
      return config.security.enableSecurityHeaders;
    default:
      return false;
  }
}

// Get environment-specific secrets/tokens
export function getSecret(name) {
  // In production, these should come from secure environment variables
  const secrets = {
    IPINFO_TOKEN: globalThis.IPINFO_TOKEN,
    MAXMIND_USER_ID: globalThis.MAXMIND_USER_ID,
    MAXMIND_LICENSE_KEY: globalThis.MAXMIND_LICENSE_KEY,
    API_KEY_ADMIN: globalThis.API_KEY_ADMIN,
    API_KEY_USER: globalThis.API_KEY_USER,
  };

  return secrets[name] || null;
}

// Validate environment configuration
export function validateEnvironment() {
  const config = getCurrentConfig();
  const errors = [];
  const warnings = [];

  // Validate API keys and secrets in production
  if (ENVIRONMENT.isProduction()) {
    const requiredSecrets = ['API_KEY_ADMIN'];
    const optionalSecrets = ['IPINFO_TOKEN', 'MAXMIND_USER_ID', 'MAXMIND_LICENSE_KEY'];

    requiredSecrets.forEach(secret => {
      if (!getSecret(secret)) {
        errors.push(`Missing required secret: ${secret}`);
      }
    });

    optionalSecrets.forEach(secret => {
      if (!getSecret(secret)) {
        warnings.push(`Optional secret not configured: ${secret} - some features may be limited`);
      }
    });

    // Validate CORS origins in production
    if (!config.api.corsOrigins || config.api.corsOrigins.length === 0) {
      errors.push("CORS origins must be configured in production");
    }

    // Validate security settings
    if (!config.security.strictMode) {
      warnings.push("Strict mode is disabled in production");
    }

    if (!config.security.enableSecurityHeaders) {
      errors.push("Security headers must be enabled in production");
    }
  }

  // Validate cache configuration
  if (config.cache.enabled && config.cache.ttl) {
    Object.keys(config.cache.ttl).forEach(key => {
      if (typeof config.cache.ttl[key] !== 'number' || config.cache.ttl[key] < 0) {
        errors.push(`Invalid cache TTL for ${key}: must be a positive number`);
      }
    });
  }

  // Validate rate limiting configuration
  if (config.rateLimit.enabled) {
    if (typeof config.rateLimit.max !== 'number' || config.rateLimit.max <= 0) {
      errors.push("Rate limit max must be a positive number");
    }
    if (typeof config.rateLimit.windowMs !== 'number' || config.rateLimit.windowMs <= 0) {
      errors.push("Rate limit window must be a positive number");
    }
  }

  // Validate monitoring configuration
  if (config.monitoring.enableMetrics && config.monitoring.alertThresholds) {
    const thresholds = config.monitoring.alertThresholds;
    if (typeof thresholds.responseTime !== 'number' || thresholds.responseTime <= 0) {
      warnings.push("Invalid response time threshold");
    }
    if (typeof thresholds.errorRate !== 'number' || thresholds.errorRate < 0 || thresholds.errorRate > 1) {
      warnings.push("Error rate threshold should be between 0 and 1");
    }
  }

  // Check required settings for production
  if (ENVIRONMENT.isProduction()) {
    if (!config.security.strictMode) {
      errors.push("Production environment must have strict mode enabled");
    }

    if (!config.security.enableSecurityHeaders) {
      errors.push("Production environment must have security headers enabled");
    }

    if (config.logging.logSensitiveData) {
      errors.push(
        "CRITICAL: Production environment must not log sensitive data",
      );
    }

    // Validate CORS configuration
    if (config.api.corsOrigins.includes("*")) {
      errors.push(
        "CRITICAL: Production environment must not use wildcard CORS origins",
      );
    }

    // Check for development-only features
    if (config.logging.enableDebug) {
      warnings.push("Debug logging should be disabled in production");
    }

    if (!config.cache.enabled) {
      warnings.push("Caching should be enabled in production for performance");
    }
  }

  // Check for staging environment
  if (ENVIRONMENT.isStaging()) {
    if (config.logging.logSensitiveData) {
      warnings.push("Staging environment should not log sensitive data");
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

// Runtime security check - prevents sensitive data logging in production
export function checkSensitiveDataLogging() {
  if (ENVIRONMENT.isProduction()) {
    const config = getCurrentConfig();
    if (config.logging.logSensitiveData) {
      throw new Error(
        "SECURITY VIOLATION: Sensitive data logging is enabled in production environment",
      );
    }
  }
}

// Secure logging wrapper that filters sensitive data
export function secureLog(level, message, data = {}) {
  const config = getCurrentConfig();

  // Always filter sensitive data in production
  if (ENVIRONMENT.isProduction() || !config.logging.logSensitiveData) {
    data = filterSensitiveData(data);
  }

  // Only log if level is appropriate for environment
  const logLevels = ["error", "warn", "info", "debug"];
  const currentLevelIndex = logLevels.indexOf(config.logging.level);
  const messageLevelIndex = logLevels.indexOf(level);

  if (messageLevelIndex <= currentLevelIndex) {
    // Use a safe logging method that doesn't expose sensitive data
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] ${message}`;

    if (typeof globalThis.logger !== "undefined") {
      globalThis.logger[level](logMessage, data);
    } else {
      // Fallback to console if logger not available (development only)
      if (!ENVIRONMENT.isProduction()) {
        // eslint-disable-next-line no-console
        console[level](logMessage, data);
      }
    }
  }
}

// Filter sensitive data from objects
function filterSensitiveData(data) {
  if (!data || typeof data !== "object") {
    return data;
  }

  const sensitiveKeys = [
    "password",
    "token",
    "key",
    "secret",
    "auth",
    "credential",
    "apikey",
    "api_key",
    "authorization",
    "x-api-key",
  ];

  const filtered = { ...data };

  for (const key in filtered) {
    if (
      sensitiveKeys.some((sensitive) => key.toLowerCase().includes(sensitive))
    ) {
      filtered[key] = "[REDACTED]";
    }
  }

  return filtered;
}
