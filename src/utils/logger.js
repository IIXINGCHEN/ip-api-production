/**
 * Production-safe logging utility
 * Replaces console statements with environment-aware logging
 */

/* eslint-disable no-console */

import { ENVIRONMENT } from "../config/environment.js";

// Log levels
const LOG_LEVELS = {
  ERROR: 0,
  WARN: 1,
  INFO: 2,
  DEBUG: 3,
};

// Get current log level based on environment
function getCurrentLogLevel() {
  if (ENVIRONMENT.isProduction()) {
    return LOG_LEVELS.WARN; // Only errors and warnings in production
  } else if (ENVIRONMENT.isStaging()) {
    return LOG_LEVELS.INFO; // Info and above in staging
  } else {
    return LOG_LEVELS.DEBUG; // All logs in development
  }
}

// Check if log level should be output
function shouldLog(level) {
  return LOG_LEVELS[level] <= getCurrentLogLevel();
}

// Filter sensitive data from log messages
function filterSensitiveData(data) {
  if (typeof data === "string") {
    // Filter out potential sensitive patterns
    return data
      .replace(/api[_-]?key[=:]\s*[^\s,}]+/gi, "api_key=[REDACTED]")
      .replace(/token[=:]\s*[^\s,}]+/gi, "token=[REDACTED]")
      .replace(/password[=:]\s*[^\s,}]+/gi, "password=[REDACTED]")
      .replace(/secret[=:]\s*[^\s,}]+/gi, "secret=[REDACTED]");
  }

  if (typeof data === "object" && data !== null) {
    const filtered = { ...data };
    const sensitiveKeys = [
      "password",
      "token",
      "key",
      "secret",
      "auth",
      "credential",
    ];

    for (const key in filtered) {
      if (
        sensitiveKeys.some((sensitive) => key.toLowerCase().includes(sensitive))
      ) {
        filtered[key] = "[REDACTED]";
      }
    }

    return filtered;
  }

  return data;
}

// Format log message with timestamp and context
function formatLogMessage(level, message, data = null) {
  const timestamp = new Date().toISOString();
  const prefix = `[${timestamp}] [${level}]`;

  if (data) {
    const filteredData = filterSensitiveData(data);
    return `${prefix} ${message} ${JSON.stringify(filteredData)}`;
  }

  return `${prefix} ${message}`;
}

// Core logging functions
export const logger = {
  error: (message, data = null) => {
    if (shouldLog("ERROR")) {
      const formattedMessage = formatLogMessage("ERROR", message, data);
      console.error(formattedMessage);
    }
  },

  warn: (message, data = null) => {
    if (shouldLog("WARN")) {
      const formattedMessage = formatLogMessage("WARN", message, data);
      console.warn(formattedMessage);
    }
  },

  info: (message, data = null) => {
    if (shouldLog("INFO")) {
      const formattedMessage = formatLogMessage("INFO", message, data);
      console.info(formattedMessage);
    }
  },

  debug: (message, data = null) => {
    if (shouldLog("DEBUG")) {
      const formattedMessage = formatLogMessage("DEBUG", message, data);
      console.log(formattedMessage);
    }
  },

  // Special method for security-related logs
  security: (message, data = null) => {
    // Security logs are always output regardless of environment
    const formattedMessage = formatLogMessage("SECURITY", message, data);
    console.warn(formattedMessage);
  },

  // Special method for audit logs
  audit: (message, data = null) => {
    // Audit logs are always output regardless of environment
    const formattedMessage = formatLogMessage("AUDIT", message, data);
    console.info(formattedMessage);
  },
};

// Convenience methods for common use cases
export const log = {
  // Application startup/shutdown
  startup: (message, data = null) => logger.info(`[STARTUP] ${message}`, data),
  shutdown: (message, data = null) =>
    logger.info(`[SHUTDOWN] ${message}`, data),

  // Request/response logging
  request: (message, data = null) => logger.debug(`[REQUEST] ${message}`, data),
  response: (message, data = null) =>
    logger.debug(`[RESPONSE] ${message}`, data),

  // Performance logging
  performance: (message, data = null) =>
    logger.info(`[PERFORMANCE] ${message}`, data),

  // Security events
  securityEvent: (message, data = null) =>
    logger.security(`[SECURITY_EVENT] ${message}`, data),

  // Configuration changes
  config: (message, data = null) => logger.info(`[CONFIG] ${message}`, data),

  // Error tracking
  errorTracking: (message, data = null) =>
    logger.error(`[ERROR_TRACKING] ${message}`, data),
};

// Export individual log functions for backward compatibility
export const logError = logger.error;
export const logWarn = logger.warn;
export const logInfo = logger.info;
export const logDebug = logger.debug;

// Production-safe console replacement
export const safeConsole = {
  log: logger.debug,
  info: logger.info,
  warn: logger.warn,
  error: logger.error,
  debug: logger.debug,
};

// Helper to replace console statements in production
export function replaceConsoleInProduction() {
  if (ENVIRONMENT.isProduction()) {
    // In production, replace console methods with our safe logger
    globalThis.console = {
      ...globalThis.console,
      log: logger.debug,
      info: logger.info,
      warn: logger.warn,
      error: logger.error,
      debug: logger.debug,
    };
  }
}
