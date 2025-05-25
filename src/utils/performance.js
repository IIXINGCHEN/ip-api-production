/**
 * Performance monitoring and optimization utilities
 * Provides tools for tracking and improving application performance
 */

import { ENVIRONMENT, isFeatureEnabled } from "../config/environment.js";

// Performance metrics storage
const metrics = {
  requests: new Map(),
  responses: new Map(),
  errors: new Map(),
  cache: new Map(),
};

/**
 * Performance timer for measuring execution time
 */
export class PerformanceTimer {
  constructor(name) {
    this.name = name;
    this.startTime = performance.now();
    this.marks = new Map();
  }

  mark(label) {
    this.marks.set(label, performance.now() - this.startTime);
    return this;
  }

  end() {
    const endTime = performance.now();
    const duration = endTime - this.startTime;

    // Record metrics if monitoring is enabled
    if (isFeatureEnabled("monitoring")) {
      this.recordMetric(duration);
    }

    return {
      name: this.name,
      duration,
      marks: Object.fromEntries(this.marks),
      timestamp: new Date().toISOString(),
    };
  }

  recordMetric(duration) {
    const key = `timer:${this.name}`;
    const existing = metrics.requests.get(key) || {
      count: 0,
      total: 0,
      min: Infinity,
      max: 0,
    };

    existing.count++;
    existing.total += duration;
    existing.min = Math.min(existing.min, duration);
    existing.max = Math.max(existing.max, duration);
    existing.avg = existing.total / existing.count;
    existing.lastUpdate = Date.now();

    metrics.requests.set(key, existing);
  }
}

/**
 * Request performance middleware
 */
export function performanceMiddleware(metricName = "request") {
  return async (c, next) => {
    if (!isFeatureEnabled("monitoring")) {
      await next();
      return;
    }

    const timer = new PerformanceTimer(metricName);
    const startMemory = getMemoryUsage();

    // Add performance context to request
    c.set("performanceTimer", timer);
    c.set("startMemory", startMemory);

    try {
      await next();

      // Record successful request
      const result = timer.end();
      recordRequestMetric(c, result, "success");
    } catch (error) {
      // Record failed request
      const result = timer.end();
      recordRequestMetric(c, result, "error");
      throw error;
    }
  };
}

/**
 * Record request metrics
 */
function recordRequestMetric(context, timerResult, status) {
  const method = context.req.method;
  const path = context.req.path;
  const statusCode = context.res?.status || 0;

  const metric = {
    method,
    path,
    status,
    statusCode,
    duration: timerResult.duration,
    timestamp: Date.now(),
    memory: getMemoryUsage(),
  };

  // Store in metrics
  const key = `${method}:${path}`;
  const existing = metrics.responses.get(key) || [];
  existing.push(metric);

  // Keep only last 100 entries per endpoint
  if (existing.length > 100) {
    existing.shift();
  }

  metrics.responses.set(key, existing);
}

/**
 * Get memory usage (if available)
 */
function getMemoryUsage() {
  // In Cloudflare Workers, memory info is not available
  // Return placeholder data
  return {
    used: 0,
    total: 0,
    available: true,
  };
}

/**
 * Cache performance tracking
 */
export function trackCachePerformance(operation, key, hit = false) {
  if (!isFeatureEnabled("monitoring")) {
    return;
  }

  const cacheKey = `cache:${operation}`;
  const existing = metrics.cache.get(cacheKey) || {
    hits: 0,
    misses: 0,
    total: 0,
  };

  existing.total++;
  if (hit) {
    existing.hits++;
  } else {
    existing.misses++;
  }

  existing.hitRate = existing.hits / existing.total;
  existing.lastUpdate = Date.now();

  metrics.cache.set(cacheKey, existing);
}

/**
 * Error tracking
 */
export function trackError(error, context = {}) {
  if (!isFeatureEnabled("monitoring")) {
    return;
  }

  const errorKey = error.name || "UnknownError";
  const existing = metrics.errors.get(errorKey) || {
    count: 0,
    lastSeen: 0,
    contexts: [],
  };

  existing.count++;
  existing.lastSeen = Date.now();
  existing.contexts.push({
    message: error.message,
    stack: ENVIRONMENT.isDevelopment() ? error.stack : undefined,
    context,
    timestamp: Date.now(),
  });

  // Keep only last 50 error contexts
  if (existing.contexts.length > 50) {
    existing.contexts.shift();
  }

  metrics.errors.set(errorKey, existing);
}

/**
 * Get performance metrics summary
 */
export function getPerformanceMetrics() {
  const summary = {
    requests: {},
    responses: {},
    cache: {},
    errors: {},
    system: {
      uptime: Date.now(), // Simplified uptime
      memory: getMemoryUsage(),
      timestamp: new Date().toISOString(),
    },
  };

  // Aggregate request metrics
  for (const [key, data] of metrics.requests.entries()) {
    summary.requests[key] = {
      count: data.count,
      avgDuration: Math.round(data.avg * 100) / 100,
      minDuration: Math.round(data.min * 100) / 100,
      maxDuration: Math.round(data.max * 100) / 100,
      lastUpdate: new Date(data.lastUpdate).toISOString(),
    };
  }

  // Aggregate response metrics
  for (const [key, responses] of metrics.responses.entries()) {
    const successful = responses.filter((r) => r.status === "success").length;
    const failed = responses.filter((r) => r.status === "error").length;
    const avgDuration =
      responses.reduce((sum, r) => sum + r.duration, 0) / responses.length;

    summary.responses[key] = {
      total: responses.length,
      successful,
      failed,
      successRate: successful / responses.length,
      avgDuration: Math.round(avgDuration * 100) / 100,
    };
  }

  // Cache metrics
  for (const [key, data] of metrics.cache.entries()) {
    summary.cache[key] = {
      total: data.total,
      hits: data.hits,
      misses: data.misses,
      hitRate: Math.round(data.hitRate * 100) / 100,
      lastUpdate: new Date(data.lastUpdate).toISOString(),
    };
  }

  // Error metrics
  for (const [key, data] of metrics.errors.entries()) {
    summary.errors[key] = {
      count: data.count,
      lastSeen: new Date(data.lastSeen).toISOString(),
      recentContexts: data.contexts.slice(-5), // Last 5 contexts
    };
  }

  return summary;
}

/**
 * Clear performance metrics
 */
export function clearMetrics(type = "all") {
  switch (type) {
    case "requests":
      metrics.requests.clear();
      break;
    case "responses":
      metrics.responses.clear();
      break;
    case "cache":
      metrics.cache.clear();
      break;
    case "errors":
      metrics.errors.clear();
      break;
    case "all":
    default:
      metrics.requests.clear();
      metrics.responses.clear();
      metrics.cache.clear();
      metrics.errors.clear();
      break;
  }
}

/**
 * Performance optimization helpers
 */
export const PerformanceOptimizer = {
  // Debounce function calls
  debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        clearTimeout(timeout);
        func(...args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  },

  // Throttle function calls
  throttle(func, limit) {
    let inThrottle;
    return function executedFunction(...args) {
      if (!inThrottle) {
        func.apply(this, args);
        inThrottle = true;
        setTimeout(() => (inThrottle = false), limit);
      }
    };
  },

  // Memoize function results
  memoize(func, keyGenerator = (...args) => JSON.stringify(args)) {
    const cache = new Map();
    return function memoized(...args) {
      const key = keyGenerator(...args);
      if (cache.has(key)) {
        return cache.get(key);
      }
      const result = func.apply(this, args);
      cache.set(key, result);
      return result;
    };
  },

  // Batch operations
  batch(operations, batchSize = 10) {
    const batches = [];
    for (let i = 0; i < operations.length; i += batchSize) {
      batches.push(operations.slice(i, i + batchSize));
    }
    return batches;
  },
};

/**
 * Health check utilities
 */
export function getHealthStatus() {
  const metrics = getPerformanceMetrics();
  const issues = [];

  // Check error rates
  const totalErrors = Object.values(metrics.errors).reduce(
    (sum, e) => sum + e.count,
    0,
  );
  const totalRequests = Object.values(metrics.responses).reduce(
    (sum, r) => sum + r.total,
    0,
  );
  const errorRate = totalRequests > 0 ? totalErrors / totalRequests : 0;

  if (errorRate > 0.05) {
    // 5% error rate threshold
    issues.push(`High error rate: ${Math.round(errorRate * 100)}%`);
  }

  // Check response times
  const avgResponseTime =
    Object.values(metrics.requests).reduce((sum, r) => sum + r.avgDuration, 0) /
    Object.keys(metrics.requests).length;
  if (avgResponseTime > 1000) {
    // 1 second threshold
    issues.push(`Slow response time: ${Math.round(avgResponseTime)}ms`);
  }

  return {
    status: issues.length === 0 ? "healthy" : "degraded",
    issues,
    metrics: {
      errorRate: Math.round(errorRate * 100) / 100,
      avgResponseTime: Math.round(avgResponseTime * 100) / 100,
      totalRequests,
      totalErrors,
    },
    timestamp: new Date().toISOString(),
  };
}
