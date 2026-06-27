/**
 * 📊 监控服务主类（facade）
 *
 * 子组件已拆分到独立文件：metricsCollector / healthChecker / alertManager。
 * 本文件仅做组装、默认规则注册、周期调度与状态聚合。
 * 子组件类通过 re-export 保持向后兼容（旧 import 路径不变）。
 */

import { hasReliableTimers, getMemoryUsage } from '../utils/runtime.js';
import { MetricsCollector } from './metricsCollector.js';
import { HealthChecker } from './healthChecker.js';
import { AlertManager } from './alertManager.js';
import { config } from '../config/configManager.js';

// 向后兼容 re-export
export { MetricsCollector } from './metricsCollector.js';
export { HealthChecker } from './healthChecker.js';
export { AlertManager } from './alertManager.js';

export class MonitoringService {
  constructor() {
    this.metricsCollector = new MetricsCollector();
    this.healthChecker = new HealthChecker();
    this.alertManager = new AlertManager();
    this.isRunning = false;
    this.intervalId = null;
    this.lazyMode = false; // Workers 运行时下由请求驱动监控周期
    this.maintenanceInterval = 30000;
    this.lastCycleAt = 0;
  }

  async start() {
    if (this.isRunning) {
      console.log('📊 Monitoring service already running');
      return;
    }

    console.log('📊 Starting monitoring service...');

    try {
      this.alertManager.enabled = config.get('monitoring.enableAlerts', false);
    } catch (error) {
      console.warn('⚠️ Could not load monitoring configuration:', error.message);
      this.alertManager.enabled = false;
    }

    this.registerDefaultHealthChecks();
    this.registerDefaultAlertRules();
    await this.startPeriodicMonitoring();

    this.isRunning = true;
    console.log('📊 Monitoring service started successfully');
  }

  stop() {
    if (!this.isRunning) {
      console.log('📊 Monitoring service not running');
      return;
    }

    console.log('📊 Stopping monitoring service...');
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.lazyMode = false;
    this.isRunning = false;
    console.log('📊 Monitoring service stopped');
  }

  registerDefaultHealthChecks() {
    this.healthChecker.register('memory', async() => {
      const usage = getMemoryUsage();
      if (!usage) {
        // workerd 等运行时拿不到真实堆信息（polyfill 返回全零），视为不适用而非失败
        return {
          healthy: true,
          message: 'Memory metrics not available in this runtime',
          details: { available: false }
        };
      }
      const usedPercent = (usage.heapUsed / usage.heapTotal) * 100;
      return {
        healthy: usedPercent < 90,
        message: `Memory usage: ${usedPercent.toFixed(2)}%`,
        details: {
          heapUsed: Math.round(usage.heapUsed / 1024 / 1024) + 'MB',
          heapTotal: Math.round(usage.heapTotal / 1024 / 1024) + 'MB',
          usedPercent: usedPercent.toFixed(2)
        }
      };
    }, { critical: true });

    this.healthChecker.register('response_time', async() => {
      // request_duration 以带 label 的键存储（request_duration{endpoint="ips",...}），
      // 需聚合所有变体求加权均值。旧实现读了从不写入的 customMetrics['response_time_average']
      // → 永远 0ms/healthy，延迟回归永不触发。
      const metrics = this.metricsCollector.getMetrics();
      let totalSum = 0;
      let totalCount = 0;
      for (const [key, h] of Object.entries(metrics.histograms)) {
        if (key === 'request_duration' || key.startsWith('request_duration{')) {
          totalSum += h.sum || 0;
          totalCount += h.count || 0;
        }
      }
      const avgResponseTime = totalCount > 0 ? totalSum / totalCount : 0;
      return {
        healthy: avgResponseTime < 1000,
        message: `Average response time: ${avgResponseTime.toFixed(2)}ms`,
        details: { avgResponseTime, sampleCount: totalCount }
      };
    }, { critical: true });

    this.healthChecker.register('error_rate', async() => {
      const metrics = this.metricsCollector.getMetrics();
      const errorCount = metrics.counters['errors_total'] || 0;
      const requestCount = metrics.counters['requests_total'] || 1;
      const errorRate = (errorCount / requestCount) * 100;
      return {
        healthy: errorRate < 5,
        message: `Error rate: ${errorRate.toFixed(2)}%`,
        details: { errorRate, errorCount, requestCount }
      };
    }, { critical: true });
  }

  registerDefaultAlertRules() {
    this.alertManager.addRule('memory_high', {
      level: 'warning',
      metric: 'gauges.memory_usedPercent',
      threshold: 80,
      operator: '>',
      message: 'Memory usage is high',
      critical: false
    });

    this.alertManager.addRule('memory_critical', {
      level: 'critical',
      metric: 'gauges.memory_usedPercent',
      threshold: 95,
      operator: '>',
      message: 'Memory usage is critically high',
      critical: true
    });

    this.alertManager.addRule('error_rate_high', {
      level: 'warning',
      condition: (metrics) => {
        const errorCount = metrics.counters['errors_total'] || 0;
        const requestCount = metrics.counters['requests_total'] || 1;
        return (errorCount / requestCount) * 100 > 10;
      },
      message: 'Error rate is above 10%',
      critical: false
    });
  }

  /**
   * Node 进程用 setInterval；workerd 中请求上下文外的定时器不执行
   * （nodejs_compat 下 typeof setInterval 恒为 'function'，无法区分），
   * 改为惰性模式：由请求路径调用 runMaintenanceIfDue() 驱动监控周期。
   */
  async startPeriodicMonitoring() {
    let interval = 30000;
    try {
      interval = config.get('monitoring.metricsInterval', 30000);
    } catch (error) {
      console.warn('⚠️ Could not load metrics interval configuration, using default');
    }

    this.maintenanceInterval = interval;
    this.lastCycleAt = Date.now();

    if (!hasReliableTimers()) {
      this.lazyMode = true;
      console.log('📊 Periodic monitoring running in lazy (request-driven) mode');
      return;
    }

    this.intervalId = setInterval(() => {
      this.runMonitoringCycle();
    }, interval);
  }

  async runMonitoringCycle() {
    this.lastCycleAt = Date.now();
    try {
      await this.healthChecker.checkAll();
      const metrics = this.metricsCollector.getMetrics();
      const alerts = await this.alertManager.checkAlerts(metrics);
      this.metricsCollector.incrementCounter('monitoring_cycles');

      if (alerts.length > 0) {
        console.log(`🚨 ${alerts.length} alert(s) triggered`);
      }
      this.metricsCollector.cleanup();
    } catch (error) {
      console.error('Monitoring cycle error:', error);
      this.metricsCollector.incrementCounter('monitoring_errors');
    }
  }

  /**
   * 惰性维护入口：周期到期则返回执行 Promise（可交给 waitUntil），否则 null。
   * lastCycleAt 在周期开始即更新，天然防止并发请求重复触发。
   */
  runMaintenanceIfDue() {
    if (!this.isRunning || !this.lazyMode) {
      return null;
    }
    if (Date.now() - this.lastCycleAt < this.maintenanceInterval) {
      return null;
    }
    return this.runMonitoringCycle();
  }

  getStatus() {
    const activeAlerts = this.alertManager.getActiveAlerts();
    return {
      running: this.isRunning,
      uptime: Date.now() - this.metricsCollector.startTime,
      lastUpdate: new Date().toISOString(),
      metricsCount: this.metricsCollector.metrics.size,
      healthChecksCount: this.healthChecker.checks.size,
      alertRulesCount: this.alertManager.alertRules.size,
      activeAlertsCount: activeAlerts.length,
      criticalAlertsCount: activeAlerts.filter((a) => a.level === 'critical').length
    };
  }

  async getReport() {
    const metrics = this.metricsCollector.getMetrics();
    const healthResults = await this.healthChecker.checkAll();
    const overallHealth = this.healthChecker.getOverallHealth(healthResults);
    const activeAlerts = this.alertManager.getActiveAlerts();

    return {
      timestamp: new Date().toISOString(),
      status: this.getStatus(),
      metrics,
      health: { overall: overallHealth, checks: healthResults },
      alerts: {
        active: activeAlerts,
        recent: this.alertManager.getAlertHistory(10)
      },
      configuration: await this.getConfiguration()
    };
  }

  async getConfiguration() {
    try {
      return {
        monitoringEnabled: config.get('monitoring.enableMetrics', true),
        healthChecksEnabled: config.get('monitoring.enableHealthChecks', true),
        alertsEnabled: config.get('monitoring.enableAlerts', false)
      };
    } catch (error) {
      return {
        monitoringEnabled: true,
        healthChecksEnabled: true,
        alertsEnabled: false,
        error: 'Configuration not available'
      };
    }
  }
}

// 🌍 全局监控服务实例
export const monitoringService = new MonitoringService();

export default monitoringService;
