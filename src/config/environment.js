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

// Environment-specific configurations
export const ENV_CONFIG = {
  production: {
    // Production security settings
    security: {
      strictMode: true,
      hideErrorDetails: true,
      enableSecurityHeaders: true,
      requireHTTPS: true,
      enableCSP: true,
      blockSuspiciousIPs: true,
    },

    // Production logging
    logging: {
      level: "error",
      enableDebug: false,
      enableTrace: false,
      logSensitiveData: false,
    },

    // Production caching
    cache: {
      enabled: true,
      ttl: {
        ip: 300, // 5 minutes
        geo: 3600, // 1 hour
        threat: 1800, // 30 minutes
      },
      maxSize: 1000,
    },

    // Production rate limiting
    rateLimit: {
      enabled: true,
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: 100, // requests per window
      skipSuccessfulRequests: false,
      skipFailedRequests: false,
    },

    // Production API settings
    api: {
      enableCORS: true,
      corsOrigins: [
        "https://ip.ixingchen.top",
        "https://ixingchen.top",
        "https://*.ixingchen.top",
      ], // Restricted to specific trusted domains in production
      enableCompression: true,
      enableETag: true,
      maxRequestSize: "1mb",
    },

    // Production monitoring
    monitoring: {
      enableMetrics: true,
      enableHealthChecks: true,
      enablePerformanceTracking: true,
      alertThresholds: {
        responseTime: 1000, // 1 second
        errorRate: 0.05, // 5%
        memoryUsage: 0.8, // 80%
      },
    },
  },

  staging: {
    // Staging security settings (slightly relaxed for testing)
    security: {
      strictMode: true,
      hideErrorDetails: false, // Show errors for debugging
      enableSecurityHeaders: true,
      requireHTTPS: true,
      enableCSP: true,
      blockSuspiciousIPs: false, // Allow testing from various IPs
    },

    // Staging logging
    logging: {
      level: "warn",
      enableDebug: true,
      enableTrace: false,
      logSensitiveData: false,
    },

    // Staging caching (shorter TTL for testing)
    cache: {
      enabled: true,
      ttl: {
        ip: 60, // 1 minute
        geo: 300, // 5 minutes
        threat: 180, // 3 minutes
      },
      maxSize: 500,
    },

    // Staging rate limiting (more lenient)
    rateLimit: {
      enabled: true,
      windowMs: 15 * 60 * 1000,
      max: 200, // Higher limit for testing
      skipSuccessfulRequests: false,
      skipFailedRequests: false,
    },

    // Staging API settings
    api: {
      enableCORS: true,
      corsOrigins: [
        "https://ip.ixingchen.top",
        "https://ixingchen.top",
        "https://*.ixingchen.top",
        "https://staging.ixingchen.top",
        "http://localhost:3000",
        "http://localhost:8080",
      ], // Allow staging and development domains
      enableCompression: true,
      enableETag: true,
      maxRequestSize: "2mb",
    },

    // Staging monitoring
    monitoring: {
      enableMetrics: true,
      enableHealthChecks: true,
      enablePerformanceTracking: true,
      alertThresholds: {
        responseTime: 2000,
        errorRate: 0.1,
        memoryUsage: 0.9,
      },
    },
  },

  development: {
    // Development security settings (relaxed for development)
    security: {
      strictMode: false,
      hideErrorDetails: false,
      enableSecurityHeaders: false,
      requireHTTPS: false,
      enableCSP: false,
      blockSuspiciousIPs: false,
    },

    // Development logging (verbose)
    logging: {
      level: "debug",
      enableDebug: true,
      enableTrace: true,
      logSensitiveData: true, // Only in development!
    },

    // Development caching (minimal for testing)
    cache: {
      enabled: false, // Disable caching in development
      ttl: {
        ip: 10,
        geo: 30,
        threat: 20,
      },
      maxSize: 100,
    },

    // Development rate limiting (very lenient)
    rateLimit: {
      enabled: false, // Disable rate limiting in development
      windowMs: 15 * 60 * 1000,
      max: 1000,
      skipSuccessfulRequests: true,
      skipFailedRequests: true,
    },

    // Development API settings
    api: {
      enableCORS: true,
      corsOrigins: [
        "http://localhost:3000",
        "http://localhost:8080",
        "http://localhost:5173",
        "http://127.0.0.1:3000",
        "http://127.0.0.1:8080",
        "http://127.0.0.1:5173",
      ], // Restricted to local development domains only
      enableCompression: false,
      enableETag: false,
      maxRequestSize: "10mb",
    },

    // Development monitoring
    monitoring: {
      enableMetrics: false,
      enableHealthChecks: true,
      enablePerformanceTracking: false,
      alertThresholds: {
        responseTime: 5000,
        errorRate: 0.5,
        memoryUsage: 0.95,
      },
    },
  },
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
