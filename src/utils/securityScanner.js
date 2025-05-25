/**
 * Automatic Security Configuration Scanner
 * Performs comprehensive security checks on application startup
 */

import {
  ENVIRONMENT,
  getCurrentConfig,
  validateEnvironment,
} from "../config/environment.js";

// Security scan results
export class SecurityScanResult {
  constructor() {
    this.passed = [];
    this.warnings = [];
    this.failures = [];
    this.critical = [];
    this.score = 0;
    this.maxScore = 0;
  }

  addCheck(name, status, message, severity = "info") {
    this.maxScore += 10;

    const check = {
      name,
      status,
      message,
      severity,
      timestamp: new Date().toISOString(),
    };

    switch (status) {
      case "pass":
        this.passed.push(check);
        this.score += 10;
        break;
      case "warning":
        this.warnings.push(check);
        this.score += 5;
        break;
      case "fail":
        if (severity === "critical") {
          this.critical.push(check);
        } else {
          this.failures.push(check);
        }
        break;
    }
  }

  getOverallStatus() {
    if (this.critical.length > 0) {
      return "critical";
    }
    if (this.failures.length > 0) {
      return "failed";
    }
    if (this.warnings.length > 0) {
      return "warning";
    }
    return "passed";
  }

  getScorePercentage() {
    return this.maxScore > 0
      ? Math.round((this.score / this.maxScore) * 100)
      : 0;
  }
}

// Main security scanner
export function performSecurityScan() {
  const result = new SecurityScanResult();
  const config = getCurrentConfig();

  // Use structured logging for security scan
  if (typeof globalThis.logger !== "undefined") {
    globalThis.logger.info("Starting security configuration scan");
  }

  // Environment validation
  scanEnvironmentConfiguration(result, config);

  // CORS configuration
  scanCORSConfiguration(result, config);

  // Security headers
  scanSecurityHeaders(result, config);

  // Authentication and authorization
  scanAuthConfiguration(result, config);

  // Logging and monitoring
  scanLoggingConfiguration(result, config);

  // Rate limiting
  scanRateLimitConfiguration(result, config);

  // Production-specific checks
  if (ENVIRONMENT.isProduction()) {
    scanProductionConfiguration(result, config);
  }

  // Generate report
  generateSecurityReport(result);

  return result;
}

// Environment configuration scan
function scanEnvironmentConfiguration(result, _config) {
  const envValidation = validateEnvironment();

  if (envValidation.valid) {
    result.addCheck(
      "Environment Validation",
      "pass",
      "Environment configuration is valid",
    );
  } else {
    result.addCheck(
      "Environment Validation",
      "fail",
      `Environment validation failed: ${envValidation.errors.join(", ")}`,
      "critical",
    );
  }

  if (envValidation.warnings && envValidation.warnings.length > 0) {
    result.addCheck(
      "Environment Warnings",
      "warning",
      `Environment warnings: ${envValidation.warnings.join(", ")}`,
    );
  }
}

// CORS configuration scan
function scanCORSConfiguration(result, config) {
  const corsOrigins = config.api.corsOrigins;

  if (corsOrigins.includes("*")) {
    if (ENVIRONMENT.isProduction()) {
      result.addCheck(
        "CORS Wildcard",
        "fail",
        "Wildcard CORS origins detected in production environment",
        "critical",
      );
    } else {
      result.addCheck(
        "CORS Wildcard",
        "warning",
        "Wildcard CORS origins detected in non-production environment",
      );
    }
  } else {
    result.addCheck(
      "CORS Configuration",
      "pass",
      `CORS origins properly restricted to: ${corsOrigins.join(", ")}`,
    );
  }

  // Check for localhost in production
  if (ENVIRONMENT.isProduction()) {
    const hasLocalhost = corsOrigins.some(
      (origin) => origin.includes("localhost") || origin.includes("127.0.0.1"),
    );

    if (hasLocalhost) {
      result.addCheck(
        "CORS Localhost",
        "fail",
        "Localhost origins detected in production CORS configuration",
        "critical",
      );
    } else {
      result.addCheck(
        "CORS Production",
        "pass",
        "No localhost origins in production CORS configuration",
      );
    }
  }
}

// Security headers scan
function scanSecurityHeaders(result, config) {
  if (config.security.enableSecurityHeaders) {
    result.addCheck("Security Headers", "pass", "Security headers are enabled");
  } else {
    result.addCheck(
      "Security Headers",
      "fail",
      "Security headers are disabled",
      "critical",
    );
  }

  if (config.security.enableCSP) {
    result.addCheck("Content Security Policy", "pass", "CSP is enabled");
  } else {
    result.addCheck("Content Security Policy", "warning", "CSP is disabled");
  }

  if (config.security.requireHTTPS && ENVIRONMENT.isProduction()) {
    result.addCheck(
      "HTTPS Requirement",
      "pass",
      "HTTPS is required in production",
    );
  } else if (ENVIRONMENT.isProduction()) {
    result.addCheck(
      "HTTPS Requirement",
      "fail",
      "HTTPS is not required in production",
      "critical",
    );
  }
}

// Authentication configuration scan
function scanAuthConfiguration(result, _config) {
  // Check if sensitive environment variables are set
  const hasAdminKey = !!globalThis.API_KEY_ADMIN;
  const hasUserKey = !!globalThis.API_KEY_USER;

  if (hasAdminKey) {
    result.addCheck("Admin API Key", "pass", "Admin API key is configured");
  } else {
    result.addCheck(
      "Admin API Key",
      "warning",
      "Admin API key is not configured",
    );
  }

  if (hasUserKey) {
    result.addCheck("User API Key", "pass", "User API key is configured");
  } else {
    result.addCheck(
      "User API Key",
      "warning",
      "User API key is not configured",
    );
  }
}

// Logging configuration scan
function scanLoggingConfiguration(result, config) {
  if (ENVIRONMENT.isProduction() && config.logging.logSensitiveData) {
    result.addCheck(
      "Sensitive Data Logging",
      "fail",
      "Sensitive data logging is enabled in production",
      "critical",
    );
  } else {
    result.addCheck(
      "Sensitive Data Logging",
      "pass",
      "Sensitive data logging is properly configured",
    );
  }

  if (ENVIRONMENT.isProduction() && config.logging.enableDebug) {
    result.addCheck(
      "Debug Logging",
      "warning",
      "Debug logging is enabled in production",
    );
  } else {
    result.addCheck(
      "Debug Logging",
      "pass",
      "Debug logging is properly configured",
    );
  }
}

// Rate limiting configuration scan
function scanRateLimitConfiguration(result, config) {
  if (config.rateLimit.enabled) {
    result.addCheck("Rate Limiting", "pass", "Rate limiting is enabled");

    if (config.rateLimit.max < 50) {
      result.addCheck(
        "Rate Limit Strictness",
        "pass",
        `Rate limit is appropriately strict: ${config.rateLimit.max} requests`,
      );
    } else if (config.rateLimit.max > 1000) {
      result.addCheck(
        "Rate Limit Strictness",
        "warning",
        `Rate limit may be too lenient: ${config.rateLimit.max} requests`,
      );
    }
  } else {
    if (ENVIRONMENT.isProduction()) {
      result.addCheck(
        "Rate Limiting",
        "fail",
        "Rate limiting is disabled in production",
        "critical",
      );
    } else {
      result.addCheck("Rate Limiting", "warning", "Rate limiting is disabled");
    }
  }
}

// Production-specific configuration scan
function scanProductionConfiguration(result, config) {
  if (config.security.strictMode) {
    result.addCheck(
      "Strict Mode",
      "pass",
      "Strict mode is enabled in production",
    );
  } else {
    result.addCheck(
      "Strict Mode",
      "fail",
      "Strict mode is disabled in production",
      "critical",
    );
  }

  if (config.security.hideErrorDetails) {
    result.addCheck(
      "Error Details",
      "pass",
      "Error details are hidden in production",
    );
  } else {
    result.addCheck(
      "Error Details",
      "fail",
      "Error details are exposed in production",
      "critical",
    );
  }

  if (config.cache.enabled) {
    result.addCheck("Caching", "pass", "Caching is enabled in production");
  } else {
    result.addCheck(
      "Caching",
      "warning",
      "Caching is disabled in production - may impact performance",
    );
  }

  if (config.monitoring.enableMetrics) {
    result.addCheck(
      "Monitoring",
      "pass",
      "Monitoring is enabled in production",
    );
  } else {
    result.addCheck(
      "Monitoring",
      "warning",
      "Monitoring is disabled in production",
    );
  }
}

// Generate security report
function generateSecurityReport(result) {
  const status = result.getOverallStatus();
  const score = result.getScorePercentage();

  // Create structured report data
  const reportData = {
    status: status.toUpperCase(),
    score: `${score}% (${result.score}/${result.maxScore})`,
    environment: ENVIRONMENT.current,
    timestamp: new Date().toISOString(),
    critical: result.critical,
    failures: result.failures,
    warnings: result.warnings,
    passed: result.passed.length,
  };

  // Use structured logging for security report
  if (typeof globalThis.logger !== "undefined") {
    globalThis.logger.security("Security scan completed", reportData);

    if (result.critical.length > 0) {
      globalThis.logger.security("CRITICAL SECURITY ISSUES DETECTED", {
        criticalIssues: result.critical.map((c) => ({
          name: c.name,
          message: c.message,
        })),
      });
    }
  } else if (!ENVIRONMENT.isProduction()) {
    // Fallback to console output for development only
    /* eslint-disable no-console */
    console.log("\n🛡️  Security Scan Report");
    console.log("========================");
    console.log(
      `Overall Status: ${getStatusEmoji(status)} ${status.toUpperCase()}`,
    );
    console.log(
      `Security Score: ${score}% (${result.score}/${result.maxScore})`,
    );
    console.log(`Environment: ${ENVIRONMENT.current}`);
    console.log(`Timestamp: ${new Date().toISOString()}`);

    if (result.critical.length > 0) {
      console.log("\n🚨 CRITICAL ISSUES:");
      result.critical.forEach((check) => {
        console.log(`  ❌ ${check.name}: ${check.message}`);
      });
    }

    if (result.failures.length > 0) {
      console.log("\n❌ FAILURES:");
      result.failures.forEach((check) => {
        console.log(`  ❌ ${check.name}: ${check.message}`);
      });
    }

    if (result.warnings.length > 0) {
      console.log("\n⚠️  WARNINGS:");
      result.warnings.forEach((check) => {
        console.log(`  ⚠️  ${check.name}: ${check.message}`);
      });
    }

    console.log(`\n✅ PASSED: ${result.passed.length} checks`);

    if (result.critical.length > 0) {
      console.log("\n🚨 CRITICAL SECURITY ISSUES DETECTED!");
      console.log(
        "Application startup should be halted until these are resolved.",
      );
    }

    console.log("========================\n");
    /* eslint-enable no-console */
  }
}

// Helper function for status emoji
function getStatusEmoji(status) {
  switch (status) {
    case "critical":
      return "🚨";
    case "failed":
      return "❌";
    case "warning":
      return "⚠️";
    case "passed":
      return "✅";
    default:
      return "❓";
  }
}

// Export for use in application startup
export function runSecurityScan() {
  const result = performSecurityScan();

  // In production, halt startup if critical issues are found
  if (ENVIRONMENT.isProduction() && result.critical.length > 0) {
    throw new Error(
      `Critical security issues detected: ${result.critical.map((c) => c.name).join(", ")}`,
    );
  }

  return result;
}
