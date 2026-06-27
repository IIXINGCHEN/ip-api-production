/**
 * 📊 Prometheus exposition 格式测试 — /api/v1/system/metrics
 *
 * 验证 Prometheus 文本 exposition 符合规范：
 * - 每指标含 # HELP / # TYPE 注释
 * - 指标名合法（[a-zA-Z_:][a-zA-Z0-9_:]*）
 * - 直方图 quantile 语法正确（合并 label 而非嵌套大括号）
 */

import { describe, it, expect, beforeEach } from 'vitest';
import '../setup.js';
import { app } from '../../src/app.js';
import { configManager } from '../../src/config/configManager.js';
import { monitoringService } from '../../src/monitoring/monitoringService.js';
import { buildPrometheusMetrics } from '../../src/routes/system.js';

const ADMIN_KEY = 'test-admin-key-12345';

const fetchPrometheus = async(query = '') => {
  const res = await app.fetch(new Request(`https://example.test/api/v1/system/metrics?format=prometheus${query}`, {
    headers: { 'X-API-Key': ADMIN_KEY }
  }));
  return { status: res.status, text: await res.text(), contentType: res.headers.get('content-type') };
};

describe('Prometheus exposition 格式', () => {
  beforeEach(async() => {
    await configManager.initialize();
    await monitoringService.start();
    monitoringService.metricsCollector.reset();
  });

  it('返回 text/plain 版本化内容类型', async() => {
    const { status, contentType } = await fetchPrometheus();
    expect(status).toBe(200);
    expect(contentType).toContain('text/plain');
    expect(contentType).toContain('version=');
  });

  it('包含标准 HELP/TYPE 注释', async() => {
    const { text } = await fetchPrometheus();
    expect(text).toContain('# HELP system_memory_usage_bytes');
    expect(text).toContain('# TYPE system_memory_usage_bytes gauge');
    expect(text).toContain('# HELP request_duration_seconds');
    expect(text).toContain('# TYPE request_duration_seconds summary');
  });

  it('指标名符合 Prometheus 命名规范', async() => {
    const { text } = await fetchPrometheus();
    const metricLines = text.split('\n').filter((l) => l && !l.startsWith('#'));
    expect(metricLines.length).toBeGreaterThan(0);
    metricLines.forEach((line) => {
      const name = line.split(/[{\s]/)[0];
      expect(name).toMatch(/^[a-zA-Z_:][a-zA-Z0-9_:]*$/);
    });
  });

  it('记录的计数器出现在 exposition 中', async() => {
    monitoringService.metricsCollector.incrementCounter('cache_hits', 7);
    monitoringService.metricsCollector.incrementCounter('cache_misses', 2);

    const { text } = await fetchPrometheus();
    expect(text).toContain('cache_hits_total');
    const hitsLine = text.split('\n').find((l) => l.startsWith('cache_hits_total'));
    expect(hitsLine).toMatch(/cache_hits_total\s+7/);
  });

  it('直方图 quantile 合并 label 而非嵌套大括号', async() => {
    monitoringService.metricsCollector.recordHistogram('request_duration', 150);

    const { text } = await fetchPrometheus();
    // 不应出现嵌套大括号（如 {...{...}...}），quantile 标签除外
    const hasNested = text.split('\n').some((l) => {
      if (!l.includes('{') || l.includes('quantile')) return false;
      return l.indexOf('{') !== l.lastIndexOf('{');
    });
    expect(hasNested).toBe(false);
    // summary quantile 标签合法
    expect(text).toMatch(/request_duration_seconds\{[^}]*quantile="0\.5"\}/);
    expect(text).toMatch(/request_duration_seconds\{[^}]*quantile="0\.95"\}/);
  });

  it('buildPrometheusMetrics 直接调用输出完整指标', () => {
    const metrics = {
      counters: { api_errors: 3, rate_limit_violations: 1, cache_hits: 10 },
      histograms: { 'request_duration{endpoint="ips"}': { p50: 100, p95: 200, p99: 300 } }
    };
    const status = { running: true, activeAlertsCount: 0, criticalAlertsCount: 0 };
    const mem = { heapUsed: 1000, heapTotal: 2000, external: 100 };
    const text = buildPrometheusMetrics(metrics, status, mem);
    expect(text).toContain('system_memory_usage_bytes');
    expect(text).toContain('api_errors_total 3');
    expect(text).toContain('monitoring_status 1');
    expect(text).toContain('health_status 1');
    // 毫秒换算为秒（100ms → 0.1）
    expect(text).toMatch(/request_duration_seconds\{endpoint="ips",quantile="0\.5"\} 0\.1/);
  });

  it('health_status 仅 critical 告警触发 0，warning 告警不影响（回归）', () => {
    const metrics = { counters: {}, histograms: {} };
    const mem = { heapUsed: 0, heapTotal: 0 };
    // 仅有 warning 告警 → 仍健康（旧实现按 activeAlertsCount 会误报 0）
    const warnText = buildPrometheusMetrics(metrics, { running: true, activeAlertsCount: 1, criticalAlertsCount: 0 }, mem);
    expect(warnText).toContain('health_status 1');
    // 有 critical 告警 → 不健康
    const critText = buildPrometheusMetrics(metrics, { running: true, activeAlertsCount: 1, criticalAlertsCount: 1 }, mem);
    expect(critText).toContain('health_status 0');
  });
});
