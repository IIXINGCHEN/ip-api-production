/**
 * 🔗 运维端点集成测试 (/api/v1/system/*)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import '../setup.js';
import { app } from '../../src/app.js';
import { configManager } from '../../src/config/configManager.js';
import { monitoringService } from '../../src/monitoring/monitoringService.js';

const ADMIN_KEY = 'test-admin-key-12345';
const USER_KEY = 'sk-test-1234567890abcdef';
const adminHeaders = { 'X-API-Key': ADMIN_KEY };

const req = async(path, init = {}) => {
  const res = await app.fetch(new Request(`https://example.test${path}`, init));
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { status: res.status, headers: res.headers, body };
};

describe('运维端点 /api/v1/system/*', () => {
  beforeEach(async() => {
    await configManager.initialize();
    await monitoringService.start();
    monitoringService.metricsCollector.reset();
  });

  afterEach(() => {
    monitoringService.stop();
  });

  describe('GET /api/v1/system/health', () => {
    it('管理员返回详细健康（组件级）', async() => {
      const { status, body } = await req('/api/v1/system/health', { headers: adminHeaders });
      expect(status).toBe(200);
      expect(body.data.status).toBeDefined();
      expect(body.data.checks).toBeDefined();
      expect(body.data.summary).toBeDefined();
      expect(body.data.memory).toBeDefined();
      expect(body.data.monitoring).toBeDefined();
      expect(body).not.toHaveProperty('success');
    });

    it('用户 key（非管理员）→ 403', async() => {
      const { status } = await req('/api/v1/system/health', { headers: { 'X-API-Key': USER_KEY } });
      expect(status).toBe(403);
    });

    it('无 key → 401', async() => {
      const { status } = await req('/api/v1/system/health');
      expect(status).toBe(401);
    });
  });

  describe('GET /api/v1/system/metrics', () => {
    beforeEach(() => {
      monitoringService.metricsCollector.incrementCounter('cache_hits', 5);
      monitoringService.metricsCollector.incrementCounter('cache_misses', 3);
      monitoringService.metricsCollector.recordHistogram('request_duration', 120);
    });

    it('默认返回 JSON 指标', async() => {
      const { status, body } = await req('/api/v1/system/metrics', { headers: adminHeaders });
      expect(status).toBe(200);
      expect(body.data.system).toBeDefined();
      expect(body.data.api).toBeDefined();
      expect(body.data.monitoring).toBeDefined();
    });

    it('format=prometheus 返回文本 exposition', async() => {
      const res = await app.fetch(new Request('https://example.test/api/v1/system/metrics?format=prometheus', {
        headers: adminHeaders
      }));
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/plain');
      const text = await res.text();
      expect(text).toContain('# HELP');
      expect(text).toContain('# TYPE');
      expect(text).toContain('system_memory_usage_bytes');
      expect(text).toContain('cache_hits_total');
    });

    it('Accept: text/plain 触发 prometheus 格式', async() => {
      const res = await app.fetch(new Request('https://example.test/api/v1/system/metrics', {
        headers: { ...adminHeaders, accept: 'text/plain' }
      }));
      expect(res.headers.get('content-type')).toContain('text/plain');
    });
  });

  describe('GET /api/v1/system/status', () => {
    it('管理员返回监控状态报告', async() => {
      const { status, body } = await req('/api/v1/system/status', { headers: adminHeaders });
      expect(status).toBe(200);
      expect(body.data.status).toBeDefined();
      expect(body.data.health).toBeDefined();
      expect(body.data.metrics).toBeDefined();
    });
  });

  describe('GET /api/v1/system/config', () => {
    it('管理员返回脱敏配置', async() => {
      const { status, body } = await req('/api/v1/system/config', { headers: adminHeaders });
      expect(status).toBe(200);
      expect(body.data.configuration).toBeDefined();
      expect(body.data.configuration.api).toBeDefined();
      expect(body.data.configuration.security).toBeDefined();
      // 确保无敏感字段
      expect(JSON.stringify(body.data)).not.toContain('password');
    });

    it('用户 key → 403', async() => {
      const { status } = await req('/api/v1/system/config', { headers: { 'X-API-Key': USER_KEY } });
      expect(status).toBe(403);
    });
  });

  describe('GET /api/v1/system/alerts', () => {
    it('管理员返回告警信息', async() => {
      const { status, body } = await req('/api/v1/system/alerts', { headers: adminHeaders });
      expect(status).toBe(200);
      expect(body.data.summary).toBeDefined();
      expect(body.data.summary.activeCount).toBeDefined();
    });
  });

  describe('GET /api/v1/system/memory', () => {
    it('管理员返回内存统计', async() => {
      const { status, body } = await req('/api/v1/system/memory', { headers: adminHeaders });
      expect(status).toBe(200);
      expect(body.data).toBeDefined();
    });
  });

  describe('POST /api/v1/system/memory:cleanup', () => {
    it('管理员触发清理，返回 before/after', async() => {
      const { status, body } = await req('/api/v1/system/memory:cleanup', {
        method: 'POST', headers: adminHeaders
      });
      expect(status).toBe(200);
      expect(body.data.action).toBe('cleanup');
    });
  });

  describe('POST /api/v1/system/memory:optimize', () => {
    it('管理员触发优化', async() => {
      const { status, body } = await req('/api/v1/system/memory:optimize', {
        method: 'POST', headers: adminHeaders
      });
      expect(status).toBe(200);
      expect(body.data.action).toBe('optimize');
    });
  });

  describe('GET /api/v1/system/performance', () => {
    it('管理员返回性能统计', async() => {
      const { status, body } = await req('/api/v1/system/performance', { headers: adminHeaders });
      expect(status).toBe(200);
      expect(body.data.performance).toBeDefined();
      expect(body.data.memory).toBeDefined();
      expect(body.data.configuration).toBeDefined();
    });
  });
});
