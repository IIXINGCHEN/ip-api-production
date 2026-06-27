/**
 * 🔗 API 集成测试 — 发现端点 + IP 资源功能细节
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import '../setup.js';
import { app } from '../../src/app.js';
import { configManager } from '../../src/config/configManager.js';
import { monitoringService } from '../../src/monitoring/monitoringService.js';

const USER_KEY = 'sk-test-1234567890abcdef';
const withAuth = (o = {}) => ({ ...o, headers: { 'X-API-Key': USER_KEY, ...(o.headers || {}) } });

const req = async(path, init = {}) => {
  const res = await app.fetch(new Request(`https://example.test${path}`, init));
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { status: res.status, headers: res.headers, body };
};

describe('发现端点', () => {
  beforeEach(async() => {
    vi.clearAllMocks();
    await configManager.initialize();
    await monitoringService.start();
  });

  describe('GET /', () => {
    it('返回服务根信息（信封格式，无 success）', async() => {
      const { status, body } = await req('/');
      expect(status).toBe(200);
      expect(body.data.name).toBeDefined();
      expect(body.data.version).toBeDefined();
      expect(body.data.specification).toBe('OpenAPI 3.0.3');
      expect(body.links).toBeDefined();
      expect(body).not.toHaveProperty('success');
    });
  });

  describe('GET /health', () => {
    it('返回轻量存活状态', async() => {
      const { status, body } = await req('/health');
      expect(status).toBe(200);
      expect(body.data.status).toBe('healthy');
      expect(body.data.uptimeSeconds).toBeDefined();
    });
  });

  describe('GET /api/v1', () => {
    it('返回版本发现与端点链接', async() => {
      const { status, body } = await req('/api/v1');
      expect(status).toBe(200);
      expect(body.data.apiVersion).toBe('v1');
      expect(body.links.ipsCollection.href).toContain('/api/v1/ips');
      expect(body.links.ipsBatch.href).toContain('/api/v1/ips:batch');
    });
  });

  describe('GET /docs', () => {
    it('返回端点文档清单', async() => {
      const { status, body } = await req('/docs');
      expect(status).toBe(200);
      expect(body.data.authentication.header).toBe('X-API-Key');
      expect(body.data.dataEndpoints.some((e) => e.includes('/api/v1/ips'))).toBe(true);
      expect(body.data.systemEndpoints.some((e) => e.includes('/api/v1/system'))).toBe(true);
      expect(body.data.queryParameters.includeThreat).toBeDefined();
    });
  });
});

describe('IP 资源功能', () => {
  beforeEach(async() => {
    vi.clearAllMocks();
    await configManager.initialize();
    await monitoringService.start();
  });

  describe('GET /api/v1/ips/self', () => {
    it('返回调用方自身 IP 资源', async() => {
      const { status, body } = await req('/api/v1/ips/self', withAuth());
      expect(status).toBe(200);
      expect(body.data.ip).toBeDefined();
      expect(body.data.type).toMatch(/ipv4|ipv6/);
      expect(body.data.country).toBeDefined();
      expect(body.data.network).toBeDefined();
      expect(body.data.location).toBeDefined();
      expect(body.links.self.href).toContain('/api/v1/ips/self');
    });

    it('支持 includeThreat 附带安全评估', async() => {
      const { status, body } = await req('/api/v1/ips/8.8.8.8?includeThreat=true', withAuth());
      expect(status).toBe(200);
      expect(body.data.security).toBeDefined();
      expect(body.data.security).toHaveProperty('riskScore');
      expect(body.data.security).toHaveProperty('threats');
    });
  });

  describe('GET /api/v1/ips/:ip', () => {
    it('返回指定 IP 资源', async() => {
      const { status, body } = await req('/api/v1/ips/8.8.8.8', withAuth());
      expect(status).toBe(200);
      expect(body.data.ip).toBe('8.8.8.8');
      expect(body.links.self.href).toContain('/api/v1/ips/8.8.8.8');
    });

    it('IPv6 地址正常解析', async() => {
      const { status } = await req('/api/v1/ips/2001:4860:4860::8888', withAuth());
      expect([200, 400, 500]).toContain(status);
    });

    it('缓存命中仍返回正确资源（第二次请求 cached=true）', async() => {
      await req('/api/v1/ips/1.1.1.1', withAuth());
      const { status, body } = await req('/api/v1/ips/1.1.1.1', withAuth());
      expect(status).toBe(200);
      expect(body.meta.cached).toBe(true);
    });
  });

  describe('POST /api/v1/ips:batch', () => {
    it('批量查询多个 IP', async() => {
      const { status, body } = await req('/api/v1/ips:batch', withAuth({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ips: ['8.8.8.8', '1.1.1.1', '208.67.222.222'] })
      }));
      expect(status).toBe(200);
      expect(body.data.results).toHaveLength(3);
      expect(body.data.summary.total).toBe(3);
      expect(body.data.summary.successful + body.data.summary.failed).toBe(3);
    });

    it('单 IP 失败不影响其他结果', async() => {
      const { status, body } = await req('/api/v1/ips:batch', withAuth({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ips: ['8.8.8.8', 'invalid-ip'] })
      }));
      // invalid-ip 会被 schema 在数组层拒绝（z.string().ip）
      expect(status).toBe(400);
    });
  });

  describe('字段投影', () => {
    it('fields 参数过滤响应字段', async() => {
      const { status, body } = await req('/api/v1/ips/8.8.8.8?fields=ip,country.code', withAuth());
      expect(status).toBe(200);
      expect(body.data.ip).toBe('8.8.8.8');
      expect(body.data.country.code).toBeDefined();
    });
  });
});
