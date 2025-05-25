/**
 * Monitoring and Performance Tracking Middleware
 * Lightweight built-in monitoring system for production environments
 */

import { ENVIRONMENT, getCurrentConfig } from "../config/environment.js";

// Metrics storage (in production, this would be replaced with a proper metrics store)
const metrics = {
  requests: {
    total: 0,
    success: 0,
    errors: 0,
    byStatus: new Map(),
    byPath: new Map(),
  },
  performance: {
    responseTime: [],
    memoryUsage: [],
    lastCleanup: Date.now(),
  },
  health: {
    status: "healthy",
    lastCheck: Date.now(),
    uptime: Date.now(),
  },
};

// Performance thresholds from environment config
let alertThresholds = null;

export const monitoringMiddleware = async (c, next) => {
  const config = getCurrentConfig();
  alertThresholds = config.monitoring?.alertThresholds || {
    responseTime: 1000,
    errorRate: 0.05,
    memoryUsage: 0.8,
  };

  // Skip monitoring in development if disabled
  if (!config.monitoring?.enableMetrics) {
    await next();
    return;
  }

  const startTime = performance.now();
  const requestId = c.get("requestId") || generateRequestId();

  // Set request ID for tracking
  c.set("requestId", requestId);
  c.header("X-Request-ID", requestId);

  try {
    // Execute request
    await next();

    // Record successful request
    recordRequestMetrics(c, startTime, true);
  } catch (_error) {
    // Record failed request
    recordRequestMetrics(c, startTime, false);

    // Re-throw error for error handler
    throw error;
  }
};

// Record request metrics
function recordRequestMetrics(c, startTime, success) {
  const endTime = performance.now();
  const responseTime = endTime - startTime;
  const status = c.res.status || (success ? 200 : 500);
  const path = c.req.path;
  const method = c.req.method;

  // Update request counters
  metrics.requests.total++;
  if (success) {
    metrics.requests.success++;
  } else {
    metrics.requests.errors++;
  }

  // Update status code metrics
  const statusKey = Math.floor(status / 100) * 100; // Group by 2xx, 4xx, 5xx
  metrics.requests.byStatus.set(
    statusKey,
    (metrics.requests.byStatus.get(statusKey) || 0) + 1,
  );

  // Update path metrics
  const pathKey = `${method} ${path}`;
  const pathMetrics = metrics.requests.byPath.get(pathKey) || {
    count: 0,
    totalTime: 0,
    errors: 0,
  };
  pathMetrics.count++;
  pathMetrics.totalTime += responseTime;
  if (!success) {
    pathMetrics.errors++;
  }
  metrics.requests.byPath.set(pathKey, pathMetrics);

  // Update performance metrics
  metrics.performance.responseTime.push({
    time: responseTime,
    timestamp: Date.now(),
    path: pathKey,
  });

  // Keep only last 1000 response times
  if (metrics.performance.responseTime.length > 1000) {
    metrics.performance.responseTime =
      metrics.performance.responseTime.slice(-1000);
  }

  // Check for performance alerts
  checkPerformanceAlerts(responseTime, success);

  // Periodic cleanup
  if (Date.now() - metrics.performance.lastCleanup > 5 * 60 * 1000) {
    // Every 5 minutes
    cleanupMetrics();
  }
}

// Check for performance alerts
function checkPerformanceAlerts(responseTime, _success) {
  if (!alertThresholds) {
    return;
  }

  // Response time alert
  if (responseTime > alertThresholds.responseTime) {
    logAlert("HIGH_RESPONSE_TIME", {
      responseTime,
      threshold: alertThresholds.responseTime,
      timestamp: new Date().toISOString(),
    });
  }

  // Error rate alert
  const errorRate = metrics.requests.errors / metrics.requests.total;
  if (errorRate > alertThresholds.errorRate && metrics.requests.total > 10) {
    logAlert("HIGH_ERROR_RATE", {
      errorRate: (errorRate * 100).toFixed(2) + "%",
      threshold: (alertThresholds.errorRate * 100).toFixed(2) + "%",
      totalRequests: metrics.requests.total,
      errors: metrics.requests.errors,
      timestamp: new Date().toISOString(),
    });
  }

  // Memory usage alert (if available)
  if (typeof process !== "undefined" && process.memoryUsage) {
    const memUsage = process.memoryUsage();
    const usageRatio = memUsage.heapUsed / memUsage.heapTotal;

    if (usageRatio > alertThresholds.memoryUsage) {
      logAlert("HIGH_MEMORY_USAGE", {
        usageRatio: (usageRatio * 100).toFixed(2) + "%",
        threshold: (alertThresholds.memoryUsage * 100).toFixed(2) + "%",
        heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024) + "MB",
        heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024) + "MB",
        timestamp: new Date().toISOString(),
      });
    }
  }
}

// Log performance alerts
function logAlert(type, data) {
  if (ENVIRONMENT.isProduction()) {
    // Use structured logging for alerts
    if (typeof globalThis.logger !== "undefined") {
      globalThis.logger.warn(`Performance alert: ${type}`, data);
    } else {
      // Fallback for development only
      if (!ENVIRONMENT.isProduction()) {
        // eslint-disable-next-line no-console
        console.warn(`[ALERT:${type}]`, JSON.stringify(data));
      }
    }
  }
}

// Cleanup old metrics
function cleanupMetrics() {
  const now = Date.now();
  const oneHourAgo = now - 60 * 60 * 1000;

  // Clean old response times
  metrics.performance.responseTime = metrics.performance.responseTime.filter(
    (entry) => entry.timestamp > oneHourAgo,
  );

  metrics.performance.lastCleanup = now;
}

// Generate simple request ID
function generateRequestId() {
  return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// Health check endpoint data
export function getHealthStatus() {
  const now = Date.now();
  const uptime = now - metrics.health.uptime;
  const recentErrors = metrics.performance.responseTime.filter(
    (entry) => now - entry.timestamp < 5 * 60 * 1000,
  ).length; // Last 5 minutes

  const avgResponseTime =
    metrics.performance.responseTime.length > 0
      ? metrics.performance.responseTime.reduce(
          (sum, entry) => sum + entry.time,
          0,
        ) / metrics.performance.responseTime.length
      : 0;

  const errorRate =
    metrics.requests.total > 0
      ? metrics.requests.errors / metrics.requests.total
      : 0;

  // Determine health status
  let status = "healthy";
  if (errorRate > 0.1 || avgResponseTime > 2000) {
    status = "degraded";
  }
  if (errorRate > 0.25 || avgResponseTime > 5000) {
    status = "unhealthy";
  }

  return {
    status,
    timestamp: new Date().toISOString(),
    uptime: Math.floor(uptime / 1000), // seconds
    metrics: {
      requests: {
        total: metrics.requests.total,
        success: metrics.requests.success,
        errors: metrics.requests.errors,
        errorRate: (errorRate * 100).toFixed(2) + "%",
      },
      performance: {
        avgResponseTime: Math.round(avgResponseTime),
        recentRequests: recentErrors,
      },
    },
  };
}

// Get detailed metrics (for admin endpoints)
export function getDetailedMetrics() {
  const now = Date.now();

  // Calculate path statistics
  const pathStats = Array.from(metrics.requests.byPath.entries())
    .map(([path, data]) => ({
      path,
      requests: data.count,
      avgResponseTime: Math.round(data.totalTime / data.count),
      errorRate: ((data.errors / data.count) * 100).toFixed(2) + "%",
    }))
    .sort((a, b) => b.requests - a.requests);

  // Calculate status code distribution
  const statusDistribution = Object.fromEntries(metrics.requests.byStatus);

  return {
    timestamp: new Date().toISOString(),
    uptime: Math.floor((now - metrics.health.uptime) / 1000),
    requests: {
      total: metrics.requests.total,
      success: metrics.requests.success,
      errors: metrics.requests.errors,
      statusDistribution,
    },
    performance: {
      responseTime: {
        count: metrics.performance.responseTime.length,
        avg:
          metrics.performance.responseTime.length > 0
            ? Math.round(
                metrics.performance.responseTime.reduce(
                  (sum, entry) => sum + entry.time,
                  0,
                ) / metrics.performance.responseTime.length,
              )
            : 0,
        p95: calculatePercentile(
          metrics.performance.responseTime.map((e) => e.time),
          95,
        ),
        p99: calculatePercentile(
          metrics.performance.responseTime.map((e) => e.time),
          99,
        ),
      },
    },
    paths: pathStats.slice(0, 10), // Top 10 paths
    memory: getMemoryUsage(),
  };
}

// Calculate percentile
function calculatePercentile(values, percentile) {
  if (values.length === 0) {
    return 0;
  }

  const sorted = values.sort((a, b) => a - b);
  const index = Math.ceil((percentile / 100) * sorted.length) - 1;
  return Math.round(sorted[index] || 0);
}

// Get memory usage information
function getMemoryUsage() {
  if (typeof process !== "undefined" && process.memoryUsage) {
    const usage = process.memoryUsage();
    return {
      heapUsed: Math.round(usage.heapUsed / 1024 / 1024), // MB
      heapTotal: Math.round(usage.heapTotal / 1024 / 1024), // MB
      external: Math.round(usage.external / 1024 / 1024), // MB
      rss: Math.round(usage.rss / 1024 / 1024), // MB
    };
  }
  return null;
}

// Reset metrics (for testing or maintenance)
export function resetMetrics() {
  metrics.requests.total = 0;
  metrics.requests.success = 0;
  metrics.requests.errors = 0;
  metrics.requests.byStatus.clear();
  metrics.requests.byPath.clear();
  metrics.performance.responseTime = [];
  metrics.health.uptime = Date.now();
}
