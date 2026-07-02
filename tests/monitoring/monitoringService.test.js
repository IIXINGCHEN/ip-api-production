/**
 * 📊 监控服务测试
 * 测试配置管理、指标收集、健康检查和告警管理
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { configManager, config } from '../../src/config/configManager.js';
import {
  monitoringService,
  MetricsCollector,
  HealthChecker,
  AlertManager
} from '../../src/monitoring/monitoringService.js';

// 模拟环境变量
const originalEnv = { ...process.env };
const TEST_ENV_KEYS = [
  'API_RATE_LIMIT',
  'API_TIMEOUT',
  'CACHE_TTL',
  'IPINFO_TOKEN',
  'LOG_LEVEL',
  'MAXMIND_LICENSE_KEY'
];

function resetProcessEnv() {
  process.env = { ...originalEnv, NODE_ENV: 'test' };
  TEST_ENV_KEYS.forEach(key => {
    delete process.env[key];
  });
}

describe('ConfigManager', () => {
  beforeEach(() => {
    resetProcessEnv();

    // 重置配置管理器状态
    configManager.config = null;
    configManager.isInitialized = false;
    configManager.lastUpdated = null;
  });

  afterEach(() => {
    // 恢复环境变量
    process.env = { ...originalEnv };
  });

  describe('配置初始化', () => {
    it('应该正确初始化默认配置', async() => {
      await configManager.initialize();

      expect(configManager.isInitialized).toBe(true);
      expect(configManager.config).toBeDefined();
      expect(configManager.config.api.name).toBe('IP Geolocation API');
      expect(configManager.config.api.version).toBe('2.0.0');
      expect(configManager.config.security.enableRateLimiting).toBe(true);
      expect(configManager.config.cache.enable).toBe(true);
    });

    it('应该从环境变量加载配置', async() => {
      process.env.API_TIMEOUT = '15000';
      process.env.LOG_LEVEL = 'debug';
      process.env.CACHE_TTL = '600000';

      await configManager.initialize();

      expect(configManager.get('api.timeout')).toBe(15000);
      expect(configManager.get('logging.level')).toBe('debug');
      expect(configManager.get('cache.ttl')).toBe(600000);
    });

    it('应该根据环境选择正确的配置', async() => {
      process.env.NODE_ENV = 'production';

      await configManager.initialize();

      expect(configManager.get('logging.level')).toBe('warn');
      expect(configManager.get('security.enableIpBlocking')).toBe(true);
      expect(configManager.get('monitoring.enableAlerts')).toBe(true);
    });
  });

  describe('配置获取和设置', () => {
    beforeEach(async() => {
      await configManager.initialize();
    });

    it('应该正确获取嵌套配置值', () => {
      expect(configManager.get('api.timeout')).toBe(10000);
      expect(configManager.get('security.rateLimitMaxRequests')).toBe(100);
      expect(configManager.get('cache.ttl')).toBe(300000);
    });

    it('应该返回默认值当配置不存在时', () => {
      expect(configManager.get('nonexistent.key', 'default')).toBe('default');
      expect(configManager.get('api.nonexistent', 42)).toBe(42);
    });

    it('应该正确设置配置值', () => {
      configManager.set('api.timeout', 15000);
      expect(configManager.get('api.timeout')).toBe(15000);

      configManager.set('new.nested.value', 'test');
      expect(configManager.get('new.nested.value')).toBe('test');
    });

    it('应该在未初始化时抛出错误', () => {
      configManager.isInitialized = false;

      expect(() => {
        configManager.get('api.timeout');
      }).toThrow('Configuration not initialized');
    });
  });

  describe('配置验证', () => {
    beforeEach(async() => {
      await configManager.initialize();
    });

    it('应该验证有效配置', () => {
      const validation = configManager.validate();
      expect(validation.valid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });

    it('应该检测无效配置值', () => {
      configManager.set('api.timeout', 50000); // 超过最大值30000

      const validation = configManager.validate();
      expect(validation.valid).toBe(false);
      expect(validation.errors.length).toBeGreaterThan(0);
    });
  });

  describe('配置统计', () => {
    beforeEach(async() => {
      await configManager.initialize();
    });

    it('应该返回正确的配置统计信息', () => {
      const stats = configManager.getStats();

      expect(stats.initialized).toBe(true);
      expect(stats.lastUpdated).toBeDefined();
      expect(stats.environment).toBeDefined();
      expect(stats.configSize).toBeGreaterThan(0);
    });
  });
});

describe('MetricsCollector', () => {
  let metricsCollector;

  beforeEach(() => {
    metricsCollector = new MetricsCollector();
  });

  describe('计数器', () => {
    it('应该正确递增计数器', () => {
      metricsCollector.incrementCounter('test_counter');
      expect(metricsCollector.counters.get('test_counter')).toBe(1);

      metricsCollector.incrementCounter('test_counter', 5);
      expect(metricsCollector.counters.get('test_counter')).toBe(6);
    });

    it('应该支持带标签的计数器', () => {
      metricsCollector.incrementCounter('api_requests', 1, {
        method: 'GET',
        endpoint: '/geo'
      });

      expect(metricsCollector.counters.get('api_requests{endpoint="/geo",method="GET"}')).toBe(1);
    });
  });

  describe('仪表盘', () => {
    it('应该正确设置仪表盘值', () => {
      metricsCollector.setGauge('cpu_usage', 75.5);
      expect(metricsCollector.gauges.get('cpu_usage')).toBe(75.5);

      metricsCollector.setGauge('memory_usage', 1024, { type: 'heap' });
      expect(metricsCollector.gauges.get('memory_usage{type="heap"}')).toBe(1024);
    });
  });

  describe('直方图', () => {
    it('应该正确记录直方图数据', () => {
      const values = [10, 20, 30, 40, 50];
      values.forEach(value => {
        metricsCollector.recordHistogram('response_time', value);
      });

      const histogram = metricsCollector.histograms.get('response_time');
      expect(histogram.count).toBe(5);
      expect(histogram.sum).toBe(150);
      expect(histogram.min).toBe(10);
      expect(histogram.max).toBe(50);
      expect(histogram.mean).toBe(30);
    });

    it('应该正确计算百分位数', () => {
      const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      values.forEach(value => {
        metricsCollector.recordHistogram('test_histogram', value);
      });

      const stats = metricsCollector.getHistogramStats();
      const histogram = stats.test_histogram;

      expect(histogram.p50).toBe(5);
      expect(histogram.p95).toBe(10);
      expect(histogram.p99).toBe(10);
    });
  });

  describe('计时器', () => {
    it('应该正确测量执行时间', () => {
      const timer = metricsCollector.startTimer('operation_time');

      // 模拟一些操作
      setTimeout(() => {}, 10);

      const duration = timer.end();
      expect(duration).toBeGreaterThanOrEqual(0);

      const histogram = metricsCollector.histograms.get('operation_time');
      expect(histogram.count).toBe(1);
    });
  });

  describe('指标收集', () => {
    it('应该返回完整的指标数据', () => {
      metricsCollector.incrementCounter('requests');
      metricsCollector.setGauge('active_connections', 10);
      metricsCollector.recordHistogram('response_time', 100);

      const metrics = metricsCollector.getMetrics();

      expect(metrics.counters.requests).toBe(1);
      expect(metrics.gauges.active_connections).toBe(10);
      expect(metrics.histograms.response_time).toBeDefined();
      expect(metrics.uptime).toBeGreaterThan(0);
    });
  });

  describe('指标清理', () => {
    it('应该正确清理过期指标', () => {
      // 记录一些指标
      for (let i = 0; i < 50; i++) {
        metricsCollector.recordMetric('counter', 'test', i);
      }

      expect(metricsCollector.metrics.size).toBeGreaterThan(0);

      // 清理1小时前的指标
      metricsCollector.cleanup(3600000);

      // 由于所有指标都是最近的，不应该被清理
      expect(metricsCollector.metrics.size).toBeGreaterThan(0);
    });

    it('应该重置所有指标', () => {
      metricsCollector.incrementCounter('test');
      metricsCollector.setGauge('test_gauge', 10);

      metricsCollector.reset();

      expect(metricsCollector.counters.size).toBe(0);
      expect(metricsCollector.gauges.size).toBe(0);
      expect(metricsCollector.histograms.size).toBe(0);
    });
  });
});

describe('HealthChecker', () => {
  let healthChecker;

  beforeEach(() => {
    healthChecker = new HealthChecker();
  });

  describe('健康检查注册', () => {
    it('应该正确注册健康检查', () => {
      const checkFn = async() => ({ healthy: true, message: 'OK' });

      healthChecker.register('test_check', checkFn, {
        timeout: 5000,
        critical: true
      });

      expect(healthChecker.checks.has('test_check')).toBe(true);
      const check = healthChecker.checks.get('test_check');
      expect(check.fn).toBe(checkFn);
      expect(check.timeout).toBe(5000);
      expect(check.critical).toBe(true);
    });
  });

  describe('健康检查执行', () => {
    beforeEach(() => {
      // 注册一些测试检查
      healthChecker.register('healthy_check', async() => ({
        healthy: true,
        message: 'All good'
      }));

      healthChecker.register('unhealthy_check', async() => ({
        healthy: false,
        message: 'Something wrong'
      }), { critical: true });

      healthChecker.register('error_check', async() => {
        throw new Error('Check failed');
      });
    });

    it('应该正确执行单个健康检查', async() => {
      const result = await healthChecker.check('healthy_check');

      expect(result.status).toBe('healthy');
      expect(result.message).toBe('All good');
      expect(result.critical).toBe(false);
      expect(result.duration).toBeGreaterThan(0);
    });

    it('应该处理不健康的检查', async() => {
      const result = await healthChecker.check('unhealthy_check');

      expect(result.status).toBe('unhealthy');
      expect(result.message).toBe('Something wrong');
      expect(result.critical).toBe(true);
    });

    it('应该处理检查错误', async() => {
      const result = await healthChecker.check('error_check');

      expect(result.status).toBe('unhealthy');
      expect(result.message).toBe('Health check failed');
      expect(result.error).toBeDefined();
    });

    it('应该跳过未启用的检查', async() => {
      healthChecker.register('disabled_check', async() => ({
        healthy: true,
        message: 'Should not run'
      }), { enabled: false });

      const result = await healthChecker.check('disabled_check');
      expect(result.status).toBe('skipped');
    });
  });

  describe('批量健康检查', () => {
    beforeEach(() => {
      healthChecker.register('check1', async() => ({ healthy: true }));
      healthChecker.register('check2', async() => ({ healthy: false }), { critical: true });
      healthChecker.register('check3', async() => ({ healthy: true }));
    });

    it('应该执行所有健康检查', async() => {
      const results = await healthChecker.checkAll();

      expect(Object.keys(results)).toHaveLength(3);
      expect(results.check1.status).toBe('healthy');
      expect(results.check2.status).toBe('unhealthy');
      expect(results.check3.status).toBe('healthy');
    });
  });

  describe('整体健康状态', () => {
    beforeEach(() => {
      healthChecker.register('healthy_check', async() => ({ healthy: true }));
      healthChecker.register('critical_unhealthy', async() => ({ healthy: false }), { critical: true });
      healthChecker.register('non_critical_unhealthy', async() => ({ healthy: false }), { critical: false });
    });

    it('应该正确评估整体健康状态', async() => {
      const results = await healthChecker.checkAll();
      const overall = healthChecker.getOverallHealth(results);

      expect(overall.status).toBe('critical');
      expect(overall.failedChecks).toContain('critical_unhealthy');
    });

    it('应该在所有检查通过时返回健康状态', async() => {
      const results = await healthChecker.checkAll();
      delete results.critical_unhealthy;
      delete results.non_critical_unhealthy;

      const overall = healthChecker.getOverallHealth(results);
      expect(overall.status).toBe('healthy');
    });
  });
});

describe('AlertManager', () => {
  let alertManager;

  beforeEach(() => {
    alertManager = new AlertManager();
  });

  describe('告警规则管理', () => {
    it('应该正确添加告警规则', () => {
      const rule = {
        level: 'warning',
        metric: 'cpu_usage',
        threshold: 80,
        operator: '>',
        message: 'CPU usage is high'
      };

      alertManager.addRule('high_cpu', rule);

      expect(alertManager.alertRules.has('high_cpu')).toBe(true);
      expect(alertManager.alertRules.get('high_cpu')).toEqual(rule);
    });
  });

  describe('告警检查', () => {
    beforeEach(() => {
      // 添加测试告警规则
      alertManager.addRule('high_cpu', {
        level: 'warning',
        metric: 'gauges.cpu_usage',
        threshold: 80,
        operator: '>',
        message: 'CPU usage is high'
      });

      alertManager.addRule('memory_critical', {
        level: 'critical',
        metric: 'gauges.memory_usage',
        threshold: 90,
        operator: '>',
        message: 'Memory usage is critically high'
      });

      alertManager.addRule('error_rate', {
        level: 'warning',
        condition: (metrics) => {
          const errors = metrics.counters.errors_total || 0;
          const requests = metrics.counters.requests_total || 1;
          return (errors / requests) * 100 > 10;
        },
        message: 'Error rate is above 10%'
      });
    });

    it('应该触发阈值告警', () => {
      const metrics = {
        gauges: {
          cpu_usage: 85,
          memory_usage: 75
        },
        counters: {
          errors_total: 5,
          requests_total: 100
        }
      };

      const alerts = alertManager.checkAlerts(metrics);

      expect(alerts).toHaveLength(1);
      expect(alerts[0].name).toBe('high_cpu');
      expect(alerts[0].level).toBe('warning');
      expect(alerts[0].message).toBe('CPU usage is high');
    });

    it('应该触发严重告警', () => {
      const metrics = {
        gauges: {
          cpu_usage: 85,
          memory_usage: 95
        },
        counters: {
          errors_total: 5,
          requests_total: 100
        }
      };

      const alerts = alertManager.checkAlerts(metrics);

      expect(alerts).toHaveLength(2);
      expect(alerts.some(alert => alert.name === 'high_cpu')).toBe(true);
      expect(alerts.some(alert => alert.name === 'memory_critical')).toBe(true);
      expect(alerts.some(alert => alert.level === 'critical')).toBe(true);
    });

    it('应该触发条件告警', () => {
      const metrics = {
        gauges: {
          cpu_usage: 50,
          memory_usage: 60
        },
        counters: {
          errors_total: 15,
          requests_total: 100
        }
      };

      const alerts = alertManager.checkAlerts(metrics);

      expect(alerts).toHaveLength(1);
      expect(alerts[0].name).toBe('error_rate');
      expect(alerts[0].level).toBe('warning');
    });

    it('应该在没有告警条件时返回空数组', () => {
      const metrics = {
        gauges: {
          cpu_usage: 50,
          memory_usage: 60
        },
        counters: {
          errors_total: 5,
          requests_total: 100
        }
      };

      const alerts = alertManager.checkAlerts(metrics);
      expect(alerts).toHaveLength(0);
    });
  });

  describe('告警管理', () => {
    beforeEach(() => {
      alertManager.addRule('test_rule', {
        level: 'warning',
        metric: 'test_metric',
        threshold: 50,
        operator: '>',
        message: 'Test alert'
      });
    });

    it('应该正确管理活跃告警', () => {
      const metrics = { test_metric: 75 };
      alertManager.checkAlerts(metrics);

      const activeAlerts = alertManager.getActiveAlerts();
      expect(activeAlerts).toHaveLength(1);
      expect(activeAlerts[0].acknowledged).toBe(false);
    });

    it('应该正确确认告警', () => {
      const metrics = { test_metric: 75 };
      alertManager.checkAlerts(metrics);

      const activeAlerts = alertManager.getActiveAlerts();
      const alertId = activeAlerts[0].id;

      alertManager.acknowledgeAlert(alertId);

      const updatedAlerts = alertManager.getActiveAlerts();
      expect(updatedAlerts).toHaveLength(0); // 已确认的告警不再活跃
    });

    it('应该记录告警历史', () => {
      const metrics1 = { test_metric: 75 };
      const metrics2 = { test_metric: 100 };

      alertManager.checkAlerts(metrics1);
      alertManager.checkAlerts(metrics2);

      const history = alertManager.getAlertHistory();
      expect(history.length).toBe(2);
    });

    it('同一规则重复触发应去重，活跃告警不按周期累积（M9 回归）', () => {
      const metrics = { test_metric: 75 };
      alertManager.checkAlerts(metrics);
      alertManager.checkAlerts(metrics);
      alertManager.checkAlerts(metrics);

      // 旧实现每次 checkAlerts 都 push，this.alerts 无界增长；现按规则名去重
      expect(alertManager.alerts.length).toBe(1);
      expect(alertManager.getActiveAlerts()).toHaveLength(1);
    });
  });
});

describe('MonitoringService Integration', () => {
  beforeEach(async() => {
    // 确保配置管理器已初始化
    await configManager.initialize();
  });

  describe('服务启动和停止', () => {
    it('应该正确启动监控服务', async() => {
      await monitoringService.start();

      expect(monitoringService.isRunning).toBe(true);
      expect(monitoringService.intervalId).toBeDefined();

      // 验证默认健康检查已注册
      expect(monitoringService.healthChecker.checks.has('memory')).toBe(true);
      expect(monitoringService.healthChecker.checks.has('response_time')).toBe(true);
      expect(monitoringService.healthChecker.checks.has('error_rate')).toBe(true);

      // 验证默认告警规则已添加
      expect(monitoringService.alertManager.alertRules.has('memory_high')).toBe(true);
      expect(monitoringService.alertManager.alertRules.has('memory_critical')).toBe(true);
    });

    it('应该正确停止监控服务', () => {
      monitoringService.stop();

      expect(monitoringService.isRunning).toBe(false);
      expect(monitoringService.intervalId).toBeNull();
    });
  });

  describe('监控状态', () => {
    it('应该返回正确的监控状态', () => {
      const status = monitoringService.getStatus();

      expect(status.running).toBeDefined();
      expect(status.uptime).toBeGreaterThan(0);
      expect(status.metricsCount).toBeGreaterThanOrEqual(0);
      expect(status.healthChecksCount).toBeGreaterThanOrEqual(0);
      expect(status.alertRulesCount).toBeGreaterThanOrEqual(0);
      expect(status.activeAlertsCount).toBeGreaterThanOrEqual(0);
    });
  });

  describe('监控报告', () => {
    beforeEach(async() => {
      await monitoringService.start();
    });

    afterEach(() => {
      monitoringService.stop();
    });

    it('应该生成完整的监控报告', async() => {
      // 记录一些测试数据
      monitoringService.metricsCollector.incrementCounter('test_requests');
      monitoringService.metricsCollector.setGauge('test_gauge', 42);
      monitoringService.metricsCollector.recordHistogram('test_histogram', 100);

      const report = await monitoringService.getReport();

      expect(report.timestamp).toBeDefined();
      expect(report.status).toBeDefined();
      expect(report.metrics).toBeDefined();
      expect(report.health).toBeDefined();
      expect(report.alerts).toBeDefined();
      expect(report.configuration).toBeDefined();

      // 验证指标数据
      expect(report.metrics.counters.test_requests).toBe(1);
      expect(report.metrics.gauges.test_gauge).toBe(42);
      expect(report.metrics.histograms.test_histogram).toBeDefined();

      // 验证健康检查
      expect(report.health.overall).toBeDefined();
      expect(report.health.checks).toBeDefined();

      // 验证告警
      expect(report.alerts.active).toBeDefined();
      expect(report.alerts.recent).toBeDefined();

      // 验证配置
      expect(report.configuration.monitoringEnabled).toBeDefined();
      expect(report.configuration.healthChecksEnabled).toBeDefined();
      expect(report.configuration.alertsEnabled).toBeDefined();
    });

    it('response_time 健康检查聚合 request_duration 直方图（M8 回归）', async() => {
      monitoringService.metricsCollector.recordHistogram('request_duration', 50, { endpoint: 'test' });
      const result = await monitoringService.healthChecker.check('response_time');
      expect(result.status).toBe('healthy');
      // 旧实现读 customMetrics['response_time_average']（从不写入）→ 永远 0.00ms；聚合后应反映真实值 50ms
      expect(result.message).toContain('50.00ms');
    });
  });
});
