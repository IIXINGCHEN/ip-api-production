/**
 * ⚙️ 系统运维路由 (/api/v1/system/*)
 *
 * 全部端点需管理员 API 密钥（X-API-Key = API_KEY_ADMIN）。
 *   GET  /api/v1/system/health          详细健康（组件级检查）
 *   GET  /api/v1/system/metrics         Prometheus / JSON 指标
 *   GET  /api/v1/system/status          监控状态报告
 *   GET  /api/v1/system/config          运行时配置（脱敏）
 *   GET  /api/v1/system/alerts          活跃/历史告警
 *   GET  /api/v1/system/memory          内存统计
 *   POST /api/v1/system/memory:cleanup  触发内存清理（自定义方法）
 *   POST /api/v1/system/memory:optimize 触发内存优化（自定义方法）
 *   GET  /api/v1/system/performance     性能统计
 */

import { Hono } from 'hono';
import { generateRequestId } from '../utils/response.js';
import { ENVIRONMENT } from '../config/environment.js';
import secureLogger from '../utils/secureLogger.js';
import { createAdminAuthMiddleware } from '../middleware/auth.js';
import { config } from '../config/configManager.js';
import { monitoringService } from '../monitoring/monitoringService.js';
import { geoLookup } from '../services/geoLookup.js';
import memoryOptimizer from '../services/memoryOptimizer.js';
import { getMemoryUsage, getUptime } from '../utils/runtime.js';
import {
  buildSuccess,
  buildError,
  buildLinks,
  getBaseUrl
} from '../utils/responseBuilder.js';

const app = new Hono();

// 全部 system 端点需管理员密钥
app.use('/api/v1/system/*', createAdminAuthMiddleware());

function ctx(c) {
  return { requestId: c.get('requestId') || generateRequestId() };
}

// GET /api/v1/system — 运维根（索引）
app.get('/api/v1/system', (c) => {
  const startTime = Date.now();
  const base = getBaseUrl(c);
  const resource = {
    endpoints: [
      'GET /api/v1/system/health',
      'GET /api/v1/system/metrics',
      'GET /api/v1/system/status',
      'GET /api/v1/system/config',
      'GET /api/v1/system/alerts',
      'GET /api/v1/system/memory',
      'POST /api/v1/system/memory:cleanup',
      'POST /api/v1/system/memory:optimize',
      'GET /api/v1/system/performance'
    ]
  };
  const links = buildLinks(base, {
    self: { href: `${base}/api/v1/system`, method: 'GET' },
    health: { href: `${base}/api/v1/system/health`, method: 'GET' },
    metrics: { href: `${base}/api/v1/system/metrics`, method: 'GET' },
    status: { href: `${base}/api/v1/system/status`, method: 'GET' },
    memory: { href: `${base}/api/v1/system/memory`, method: 'GET' },
    performance: { href: `${base}/api/v1/system/performance`, method: 'GET' }
  });
  return c.json(buildSuccess(resource, { ctx: ctx(c), startTime, links }));
});

// GET /api/v1/system/health — 详细健康（组件级）
app.get('/api/v1/system/health', async(c) => {
  const startTime = Date.now();
  try {
    const memoryUsage = getMemoryUsage() || { heapUsed: 0, heapTotal: 1 };
    const healthResults = await monitoringService.healthChecker.checkAll();
    const overallHealth = monitoringService.healthChecker.getOverallHealth(healthResults);
    const monitoringStatus = monitoringService.getStatus();

    const resource = {
      status: overallHealth.status,
      message: overallHealth.message,
      timestamp: new Date().toISOString(),
      checks: healthResults,
      summary: {
        total: Object.keys(healthResults).length,
        healthy: Object.values(healthResults).filter((h) => h.status === 'healthy').length,
        unhealthy: Object.values(healthResults).filter((h) => h.status === 'unhealthy').length
      },
      memory: {
        usedMb: Math.round(memoryUsage.heapUsed / 1024 / 1024),
        totalMb: Math.round(memoryUsage.heapTotal / 1024 / 1024),
        usagePercent: Math.round((memoryUsage.heapUsed / memoryUsage.heapTotal) * 100)
      },
      monitoring: {
        uptimeSeconds: Math.floor(monitoringStatus.uptime / 1000),
        running: monitoringStatus.running,
        metricsCount: monitoringStatus.metricsCount,
        activeAlertsCount: monitoringStatus.activeAlertsCount
      }
    };

    const base = getBaseUrl(c);
    const links = buildLinks(base, {
      self: { href: `${base}/api/v1/system/health`, method: 'GET' },
      metrics: { href: `${base}/api/v1/system/metrics`, method: 'GET' },
      status: { href: `${base}/api/v1/system/status`, method: 'GET' }
    });

    monitoringService.metricsCollector.setGauge(
      'health_status',
      overallHealth.status === 'healthy' ? 1 : 0,
      { component: 'system' }
    );

    return c.json(buildSuccess(resource, { ctx: ctx(c), startTime, links }));
  } catch (error) {
    secureLogger.error('System health check failed', { error: error.message });
    monitoringService.metricsCollector.incrementCounter(
      'health_check_failures', 1, { error_type: error.name || 'Error' }
    );
    const details = ENVIRONMENT.isDevelopment() ? { error: error.message } : undefined;
    return c.json(
      buildError('HEALTH_CHECK_ERROR', '健康检查失败', details, { ctx: ctx(c), startTime }),
      { status: 500 }
    );
  }
});

// GET /api/v1/system/metrics — Prometheus / JSON
app.get('/api/v1/system/metrics', async(c) => {
  const startTime = Date.now();
  try {
    const monitoringMetrics = monitoringService.metricsCollector.getMetrics();
    const monitoringStatus = monitoringService.getStatus();
    const memoryUsage = getMemoryUsage() || { heapUsed: 0, heapTotal: 1, external: 0 };

    const acceptHeader = c.req.header('accept') || '';
    const requestedFormat = c.req.query('format');

    if (acceptHeader.includes('text/plain') || requestedFormat === 'prometheus') {
      const prometheusMetrics = buildPrometheusMetrics(monitoringMetrics, monitoringStatus, memoryUsage);
      return new Response(prometheusMetrics, {
        headers: {
          'Content-Type': 'text/plain; version=0.0.4',
          'Cache-Control': 'no-cache'
        }
      });
    }

    const base = getBaseUrl(c);
    const links = buildLinks(base, {
      self: { href: `${base}/api/v1/system/metrics`, method: 'GET' },
      health: { href: `${base}/api/v1/system/health`, method: 'GET' }
    });

    const resource = {
      system: {
        uptimeSeconds: Math.floor(getUptime()),
        memory: {
          heapMb: Math.round(memoryUsage.heapUsed / 1024 / 1024),
          heapTotalMb: Math.round(memoryUsage.heapTotal / 1024 / 1024),
          externalMb: Math.round((memoryUsage.external || 0) / 1024 / 1024),
          usagePercent: memoryUsage.heapTotal > 0
            ? Math.round((memoryUsage.heapUsed / memoryUsage.heapTotal) * 100)
            : 0
        }
      },
      api: {
        counters: monitoringMetrics.counters || {},
        histograms: monitoringMetrics.histograms || {},
        gauges: monitoringMetrics.gauges || {},
        rateLimitViolations: monitoringMetrics.counters?.rate_limit_violations || 0
      },
      monitoring: {
        status: monitoringStatus.running ? 'running' : 'stopped',
        uptimeSeconds: Math.floor(monitoringStatus.uptime / 1000),
        metricsCount: monitoringStatus.metricsCount
      }
    };

    return c.json(buildSuccess(resource, { ctx: ctx(c), startTime, links }));
  } catch (error) {
    secureLogger.error('Metrics collection failed', { error: error.message });
    return c.json(
      buildError('METRICS_ERROR', '指标收集失败', undefined, { ctx: ctx(c), startTime }),
      { status: 500 }
    );
  }
});

// GET /api/v1/system/status — 监控状态报告
app.get('/api/v1/system/status', async(c) => {
  const startTime = Date.now();
  try {
    const report = await monitoringService.getReport();
    const configStats = config.getStats();

    monitoringService.metricsCollector.incrementCounter('monitoring_status_access');

    const base = getBaseUrl(c);
    const links = buildLinks(base, {
      self: { href: `${base}/api/v1/system/status`, method: 'GET' },
      health: { href: `${base}/api/v1/system/health`, method: 'GET' },
      alerts: { href: `${base}/api/v1/system/alerts`, method: 'GET' }
    });

    return c.json(buildSuccess(report, { ctx: ctx(c), startTime, links, meta: { config: configStats } }));
  } catch (error) {
    secureLogger.error('Monitoring status failed', { error: error.message });
    return c.json(
      buildError('MONITORING_STATUS_ERROR', '获取监控状态失败', undefined, { ctx: ctx(c), startTime }),
      { status: 500 }
    );
  }
});

// GET /api/v1/system/config — 运行时配置（脱敏）
app.get('/api/v1/system/config', (c) => {
  const startTime = Date.now();
  try {
    const currentConfig = config.getAll();
    const configStats = config.getStats();

    const sanitizedConfig = {
      api: {
        name: currentConfig.api?.name,
        version: currentConfig.api?.version,
        timeout: currentConfig.api?.timeout,
        maxConcurrentRequests: currentConfig.api?.maxConcurrentRequests
      },
      security: {
        enableRateLimiting: currentConfig.security?.enableRateLimiting,
        rateLimitWindow: currentConfig.security?.rateLimitWindow,
        rateLimitMaxRequests: currentConfig.security?.rateLimitMaxRequests,
        enableInputValidation: currentConfig.security?.enableInputValidation,
        enableSecurityHeaders: currentConfig.security?.enableSecurityHeaders
      },
      cache: {
        enable: currentConfig.cache?.enable,
        ttl: currentConfig.cache?.ttl,
        maxSize: currentConfig.cache?.maxSize,
        strategy: currentConfig.cache?.strategy
      },
      monitoring: {
        enableMetrics: currentConfig.monitoring?.enableMetrics,
        enableHealthChecks: currentConfig.monitoring?.enableHealthChecks,
        enableAlerts: currentConfig.monitoring?.enableAlerts
      }
    };

    monitoringService.metricsCollector.incrementCounter('config_access', 1, { access_type: 'admin' });

    const base = getBaseUrl(c);
    const links = buildLinks(base, {
      self: { href: `${base}/api/v1/system/config`, method: 'GET' },
      status: { href: `${base}/api/v1/system/status`, method: 'GET' }
    });

    return c.json(buildSuccess({
      configuration: sanitizedConfig,
      status: {
        initialized: configStats.initialized,
        lastUpdated: configStats.lastUpdated,
        environment: configStats.environment
      }
    }, { ctx: ctx(c), startTime, links }));
  } catch (error) {
    secureLogger.error('Config access failed', { error: error.message });
    return c.json(
      buildError('CONFIG_ERROR', '获取配置失败', undefined, { ctx: ctx(c), startTime }),
      { status: 500 }
    );
  }
});

// GET /api/v1/system/alerts — 告警
app.get('/api/v1/system/alerts', (c) => {
  const startTime = Date.now();
  try {
    const activeAlerts = monitoringService.alertManager.getActiveAlerts();
    const recentAlerts = monitoringService.alertManager.getAlertHistory(50);
    const monitoringStatus = monitoringService.getStatus();

    monitoringService.metricsCollector.incrementCounter('alerts_access');

    const base = getBaseUrl(c);
    const links = buildLinks(base, {
      self: { href: `${base}/api/v1/system/alerts`, method: 'GET' },
      status: { href: `${base}/api/v1/system/status`, method: 'GET' }
    });

    return c.json(buildSuccess({
      active: activeAlerts,
      recent: recentAlerts,
      summary: {
        activeCount: activeAlerts.length,
        recentCount: recentAlerts.length,
        criticalCount: activeAlerts.filter((a) => a.level === 'critical').length,
        warningCount: activeAlerts.filter((a) => a.level === 'warning').length
      },
      monitoring: {
        enabled: config.get('monitoring.enableAlerts', false),
        alertRulesCount: monitoringStatus.alertRulesCount
      }
    }, { ctx: ctx(c), startTime, links }));
  } catch (error) {
    secureLogger.error('Alerts access failed', { error: error.message });
    return c.json(
      buildError('ALERTS_ERROR', '获取告警失败', undefined, { ctx: ctx(c), startTime }),
      { status: 500 }
    );
  }
});

// GET /api/v1/system/memory — 内存统计
app.get('/api/v1/system/memory', (c) => {
  const startTime = Date.now();
  const stats = memoryOptimizer.getMemoryStats();

  const base = getBaseUrl(c);
  const links = buildLinks(base, {
    self: { href: `${base}/api/v1/system/memory`, method: 'GET' },
    cleanup: { href: `${base}/api/v1/system/memory:cleanup`, method: 'POST' },
    optimize: { href: `${base}/api/v1/system/memory:optimize`, method: 'POST' }
  });

  return c.json(buildSuccess(stats, { ctx: ctx(c), startTime, links }));
});

// POST /api/v1/system/memory:cleanup — 触发内存清理（自定义方法）
app.post('/api/v1/system/memory:cleanup', (c) => {
  const startTime = Date.now();
  const before = memoryOptimizer.getCurrentMemoryUsage();
  memoryOptimizer.performCleanup();
  const after = memoryOptimizer.getCurrentMemoryUsage();

  const base = getBaseUrl(c);
  const links = buildLinks(base, {
    self: { href: `${base}/api/v1/system/memory:cleanup`, method: 'POST' },
    memory: { href: `${base}/api/v1/system/memory`, method: 'GET' }
  });

  return c.json(buildSuccess({
    action: 'cleanup',
    beforeMb: before ? Math.round(before.heapUsed / 1024 / 1024) : null,
    afterMb: after ? Math.round(after.heapUsed / 1024 / 1024) : null,
    freedMb: before && after ? Math.round((before.heapUsed - after.heapUsed) / 1024 / 1024) : null
  }, { ctx: ctx(c), startTime, links }));
});

// POST /api/v1/system/memory:optimize — 触发内存优化（自定义方法）
app.post('/api/v1/system/memory:optimize', (c) => {
  const startTime = Date.now();
  const optimizations = memoryOptimizer.optimizeMemoryUsage();

  const base = getBaseUrl(c);
  const links = buildLinks(base, {
    self: { href: `${base}/api/v1/system/memory:optimize`, method: 'POST' },
    memory: { href: `${base}/api/v1/system/memory`, method: 'GET' }
  });

  return c.json(buildSuccess({
    action: 'optimize',
    optimizations
  }, { ctx: ctx(c), startTime, links }));
});

// GET /api/v1/system/performance — 性能统计
app.get('/api/v1/system/performance', (c) => {
  const startTime = Date.now();
  const perfStats = geoLookup.getStats();
  const memoryStats = memoryOptimizer.getMemoryStats();
  const memoryLeaks = memoryOptimizer.detectMemoryLeaks();

  const base = getBaseUrl(c);
  const links = buildLinks(base, {
    self: { href: `${base}/api/v1/system/performance`, method: 'GET' },
    memory: { href: `${base}/api/v1/system/memory`, method: 'GET' }
  });

  return c.json(buildSuccess({
    performance: perfStats,
    memory: memoryStats,
    memoryLeaksDetected: memoryLeaks ? memoryLeaks.detected : false,
    leakIndicators: memoryLeaks ? memoryLeaks.indicators : [],
    configuration: {
      performanceOptimizationEnabled: geoLookup.enabled,
      memoryMonitoringActive: memoryStats.monitoring
    }
  }, { ctx: ctx(c), startTime, links }));
});

/**
 * 构建 Prometheus exposition 文本（内部直方图键形如 `request_duration{...}`）
 */
function buildPrometheusMetrics(monitoringMetrics, monitoringStatus, memoryUsage) {
  const counters = monitoringMetrics.counters || {};
  const histograms = monitoringMetrics.histograms || {};

  const lines = [
    '# HELP system_memory_usage_bytes Memory usage in bytes',
    '# TYPE system_memory_usage_bytes gauge',
    `system_memory_usage_bytes{type="heap"} ${memoryUsage.heapUsed}`,
    `system_memory_usage_bytes{type="heap_total"} ${memoryUsage.heapTotal}`,
    `system_memory_usage_bytes{type="external"} ${memoryUsage.external || 0}`,

    '# HELP api_errors_total Total API errors',
    '# TYPE api_errors_total counter',
    `api_errors_total ${counters.api_errors || 0}`,

    '# HELP rate_limit_violations_total Rate limit violations',
    '# TYPE rate_limit_violations_total counter',
    `rate_limit_violations_total ${counters.rate_limit_violations || 0}`,

    '# HELP cache_hits_total Cache hits',
    '# TYPE cache_hits_total counter',
    `cache_hits_total ${counters.cache_hits || 0}`,

    '# HELP cache_misses_total Cache misses',
    '# TYPE cache_misses_total counter',
    `cache_misses_total ${counters.cache_misses || 0}`,

    '# HELP request_duration_seconds Request duration summary',
    '# TYPE request_duration_seconds summary',
    ...Object.entries(histograms)
      .filter(([name]) => name === 'request_duration' || name.startsWith('request_duration{'))
      .map(([name, hist]) => {
        const labelMatch = name.match(/\{(.*)\}$/);
        const baseLabels = labelMatch ? labelMatch[1] : '';
        const withQuantile = (q) => `{${baseLabels ? `${baseLabels},` : ''}quantile="${q}"}`;
        return [
          `request_duration_seconds${withQuantile('0.5')} ${(hist.p50 || 0) / 1000}`,
          `request_duration_seconds${withQuantile('0.95')} ${(hist.p95 || 0) / 1000}`,
          `request_duration_seconds${withQuantile('0.99')} ${(hist.p99 || 0) / 1000}`
        ].join('\n');
      }),

    '# HELP system_uptime_seconds System uptime in seconds',
    '# TYPE system_uptime_seconds counter',
    `system_uptime_seconds ${Math.floor(getUptime())}`,

    '# HELP monitoring_status Monitoring service running',
    '# TYPE monitoring_status gauge',
    `monitoring_status ${monitoringStatus.running ? 1 : 0}`,

    '# HELP health_status Overall health (1=healthy; 0 仅当存在 critical 告警)',
    '# TYPE health_status gauge',
    `health_status ${(monitoringStatus.criticalAlertsCount ?? 0) === 0 ? 1 : 0}`
  ];

  return lines.join('\n');
}

export { app, buildPrometheusMetrics };
export default app;
