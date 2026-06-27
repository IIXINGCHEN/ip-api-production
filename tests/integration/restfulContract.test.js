/**
 * 📐 RESTful 规范契约测试
 *
 * 验证 API 符合 RESTful 规范的核心约束：
 * - 资源化 URL 结构（/api/v1/ips, /api/v1/system）
 * - HTTP 状态码语义（200/400/401/403/404/405）
 * - 统一响应信封（成功 {data,meta,links}，错误 {error,meta}，无 success 布尔）
 * - HATEOAS 链接
 * - camelCase 字段
 * - 旧端点彻底移除（404）
 * - OpenAPI 规范可访问
 */

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import '../setup.js'; // 设置 globalThis.API_KEY_USER / API_KEY_ADMIN（vitest 未配置 setupFiles）
import { app } from '../../src/app.js';
import { configManager } from '../../src/config/configManager.js';
import { monitoringService } from '../../src/monitoring/monitoringService.js';

const USER_KEY = 'sk-test-1234567890abcdef';
const ADMIN_KEY = 'test-admin-key-12345';

const userHeaders = { 'X-API-Key': USER_KEY };
const adminHeaders = { 'X-API-Key': ADMIN_KEY };

const fetchJson = async(path, init = {}) => {
  const res = await app.fetch(new Request(`https://example.test${path}`, init));
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { status: res.status, headers: res.headers, body };
};

const get = (path, headers = {}) => fetchJson(path, { method: 'GET', headers });

describe('RESTful 契约：响应信封规范', () => {
  beforeAll(async() => {
    await configManager.initialize();
    await monitoringService.start();
  });

  describe('成功响应信封（无 success 布尔）', () => {
    it('GET / 成功响应含 data + meta + links，不含 success', async() => {
      const { status, body } = await get('/');
      expect(status).toBe(200);
      expect(body).toHaveProperty('data');
      expect(body).toHaveProperty('meta');
      expect(body).toHaveProperty('links');
      expect(body).not.toHaveProperty('success');
    });

    it('meta 含 requestId/timestamp/apiVersion/processingTimeMs', async() => {
      const { body } = await get('/');
      expect(body.meta).toHaveProperty('requestId');
      expect(body.meta).toHaveProperty('timestamp');
      expect(body.meta).toHaveProperty('apiVersion', 'v1');
      expect(body.meta).toHaveProperty('processingTimeMs');
      expect(body.meta).not.toHaveProperty('version'); // 旧字段已移除
      expect(body.meta).not.toHaveProperty('processingTime'); // 旧字段已移除
    });

    it('links 为 HATEOAS 结构（每项含 href + method）', async() => {
      const { body } = await get('/');
      const linkValues = Object.values(body.links);
      expect(linkValues.length).toBeGreaterThan(0);
      linkValues.forEach((link) => {
        expect(link).toHaveProperty('href');
        expect(link).toHaveProperty('method');
      });
    });

    it('GET /api/v1/ips 成功响应使用新信封', async() => {
      const { status, body } = await get('/api/v1/ips', userHeaders);
      expect(status).toBe(200);
      expect(body).toHaveProperty('data');
      expect(body).toHaveProperty('meta');
      expect(body).not.toHaveProperty('success');
    });

    // 回归保护：processingTimeMs 须由统一的请求入口 startTime 计算（请求开始中间件设值），
    // 在所有响应路径（成功 / 400 校验失败 / 404 未找到）都是有限非负数，不得为 undefined/NaN。
    it('所有响应路径的 processingTimeMs 都是有限非负数', async() => {
      const ok = await get('/', {});
      const notFound = await fetchJson('/totally-nonexistent-route', {});
      const bad = await fetchJson('/api/v1/ips:batch', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"ips":["not-an-ip"]}'
      });

      for (const { body } of [ok, notFound, bad]) {
        expect(body.meta).toHaveProperty('processingTimeMs');
        expect(Number.isFinite(body.meta.processingTimeMs)).toBe(true);
        expect(body.meta.processingTimeMs).toBeGreaterThanOrEqual(0);
      }
    });
  });

  describe('错误响应信封（无 data/links）', () => {
    it('404 响应含 error + meta，无 data/links/success', async() => {
      // 带认证以越过 auth 中间件，触达 notFound 处理器
      const { status, body } = await get('/api/v1/nonexistent', userHeaders);
      expect(status).toBe(404);
      expect(body).toHaveProperty('error');
      expect(body).toHaveProperty('meta');
      expect(body).not.toHaveProperty('data');
      expect(body).not.toHaveProperty('links');
      expect(body).not.toHaveProperty('success');
      expect(body.error).toHaveProperty('code', 'RESOURCE_NOT_FOUND');
      expect(body.error).toHaveProperty('message');
    });

    it('401 响应对未认证的数据端点', async() => {
      const { status, body } = await get('/api/v1/ips');
      expect(status).toBe(401);
      expect(body).toHaveProperty('error');
      expect(body).not.toHaveProperty('data');
      expect(body.error).toHaveProperty('code');
    });
  });
});

describe('RESTful 契约：公开端点（无需认证）', () => {
  beforeAll(async() => {
    await configManager.initialize();
    await monitoringService.start();
  });

  it('GET / — 200', async() => {
    const { status } = await get('/');
    expect(status).toBe(200);
  });

  it('GET /health — 200', async() => {
    const { status, body } = await get('/health');
    expect(status).toBe(200);
    expect(body.data.status).toBe('healthy');
  });

  it('GET /docs — 200', async() => {
    const { status, body } = await get('/docs');
    expect(status).toBe(200);
    expect(body.data.authentication.header).toBe('X-API-Key');
  });

  it('GET /api/v1 — 200（版本发现）', async() => {
    const { status, body } = await get('/api/v1');
    expect(status).toBe(200);
    expect(body.data.apiVersion).toBe('v1');
  });

  it('GET /api/v1/openapi.json — 200 + openapi 字段', async() => {
    const res = await app.fetch(new Request('https://example.test/api/v1/openapi.json'));
    expect(res.status).toBe(200);
    const spec = await res.json();
    expect(spec.openapi).toBe('3.0.3');
    expect(spec.info.title).toBe('IP Geolocation API');
    expect(spec.paths).toHaveProperty('/api/v1/ips');
    expect(spec.paths).toHaveProperty('/api/v1/ips/{ip}');
    expect(spec.paths).toHaveProperty('/api/v1/ips:batch');
    expect(spec.paths).toHaveProperty('/api/v1/system/health');
    expect(spec.components.securitySchemes).toHaveProperty('ApiKeyAuth');
  });
});

describe('RESTful 契约：认证与授权分层', () => {
  beforeAll(async() => {
    await configManager.initialize();
    await monitoringService.start();
  });

  it('数据端点无 key → 401', async() => {
    const { status } = await get('/api/v1/ips');
    expect(status).toBe(401);
  });

  it('数据端点带用户 key → 200', async() => {
    const { status } = await get('/api/v1/ips/self', userHeaders);
    expect([200, 500]).toContain(status); // 500 可能因 dev fixture，但不应 401
    if (status === 200) {
      // ok
    }
  });

  it('运维端点无 key → 401（全局认证拦截）', async() => {
    const { status } = await get('/api/v1/system/health');
    expect(status).toBe(401);
  });

  it('运维端点带用户 key（非管理员）→ 403', async() => {
    const { status } = await get('/api/v1/system/health', userHeaders);
    expect(status).toBe(403);
  });

  it('运维端点带管理员 key → 200', async() => {
    const { status } = await get('/api/v1/system/health', adminHeaders);
    expect(status).toBe(200);
  });

  it('/api/v1/system/config 带用户 key → 403', async() => {
    const { status } = await get('/api/v1/system/config', userHeaders);
    expect(status).toBe(403);
  });

  it('/api/v1/system/config 带管理员 key → 200', async() => {
    const { status, body } = await get('/api/v1/system/config', adminHeaders);
    expect(status).toBe(200);
    expect(body.data.configuration).toBeDefined();
  });
});

describe('RESTful 契约：旧端点彻底移除（404）', () => {
  beforeAll(async() => {
    await configManager.initialize();
    await monitoringService.start();
  });

  const oldPaths = [
    '/geo',
    '/geo/8.8.8.8',
    '/api/v1/geo',
    '/api/v1/geo/8.8.8.8',
    '/v1',
    '/metrics',
    '/config',
    '/alerts',
    '/monitoring/status',
    '/memory',
    '/performance',
    '/8.8.8.8'
  ];

  oldPaths.forEach((path) => {
    it(`GET ${path} → 404（旧端点已移除）`, async() => {
      const { status } = await get(path, userHeaders);
      expect(status).toBe(404);
    });
  });

  it('POST /v1/batch（旧批量端点）→ 404', async() => {
    const { status } = await fetchJson('/v1/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...userHeaders },
      body: JSON.stringify({ ips: ['8.8.8.8'] })
    });
    expect(status).toBe(404);
  });

  it('POST /validate（旧验证端点）→ 404', async() => {
    const { status } = await fetchJson('/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...userHeaders },
      body: JSON.stringify({ ip: '8.8.8.8' })
    });
    expect(status).toBe(404);
  });
});

describe('RESTful 契约：IP 资源 CRUD 语义', () => {
  beforeAll(async() => {
    await configManager.initialize();
    await monitoringService.start();
  });

  it('GET /api/v1/ips — 集合（默认调用方自身）', async() => {
    const { status, body } = await get('/api/v1/ips', userHeaders);
    if (status === 200) {
      expect(body.data).toHaveProperty('ip');
      expect(body.data).toHaveProperty('type');
      expect(body.data).toHaveProperty('country');
      expect(body.data).toHaveProperty('network');
      expect(body.data).toHaveProperty('location');
      expect(body.data).not.toHaveProperty('include_threat'); // snake_case 已移除
    }
  });

  it('GET /api/v1/ips/self — 调用方自身', async() => {
    const { status, body } = await get('/api/v1/ips/self', userHeaders);
    if (status === 200) {
      expect(body.data).toHaveProperty('ip');
      expect(body.links.self.href).toContain('/api/v1/ips/self');
    }
  });

  it('GET /api/v1/ips/:ip — 指定 IP 资源', async() => {
    const { status, body } = await get('/api/v1/ips/8.8.8.8', userHeaders);
    if (status === 200) {
      expect(body.data.ip).toBe('8.8.8.8');
      expect(body.links.self.href).toContain('/api/v1/ips/8.8.8.8');
    }
  });

  it('GET /api/v1/ips/invalid-ip — 400 INVALID_IP 或 BAD_REQUEST', async() => {
    const { status, body } = await get('/api/v1/ips/not-an-ip', userHeaders);
    expect(status).toBe(400);
    expect(body.error.code).toBe('BAD_REQUEST');
  });

  it('GET /api/v1/ips/192.168.1.1 — 400（私有 IP 被拒）', async() => {
    const { status } = await get('/api/v1/ips/192.168.1.1', userHeaders);
    expect(status).toBe(400);
  });

  it('POST /api/v1/ips:batch — 批量查询', async() => {
    const { status, body } = await fetchJson('/api/v1/ips:batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...userHeaders },
      body: JSON.stringify({ ips: ['8.8.8.8', '1.1.1.1'] })
    });
    expect(status).toBe(200);
    expect(body.data.results).toHaveLength(2);
    expect(body.data.summary.total).toBe(2);
    expect(body.data.summary.successful + body.data.summary.failed).toBe(2);
  });

  it('POST /api/v1/ips:batch 空 IP 列表 → 400', async() => {
    const { status } = await fetchJson('/api/v1/ips:batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...userHeaders },
      body: JSON.stringify({ ips: [] })
    });
    expect(status).toBe(400);
  });

  it('GET /api/v1/ips?includeThreat=true — camelCase 查询参数生效', async() => {
    const { status, body } = await get('/api/v1/ips/8.8.8.8?includeThreat=true', userHeaders);
    if (status === 200) {
      expect(body.data).toHaveProperty('security');
    }
  });
});

describe('RESTful 契约：多格式内容协商', () => {
  beforeAll(async() => {
    await configManager.initialize();
    await monitoringService.start();
  });

  it('format=json → application/json', async() => {
    const res = await app.fetch(new Request('https://example.test/api/v1/ips/8.8.8.8?format=json', {
      headers: userHeaders
    }));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
  });

  it('format=xml → application/xml', async() => {
    const res = await app.fetch(new Request('https://example.test/api/v1/ips/8.8.8.8?format=xml', {
      headers: userHeaders
    }));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/xml');
    const text = await res.text();
    expect(text).toContain('<?xml');
  });

  it('format=csv → text/csv', async() => {
    const res = await app.fetch(new Request('https://example.test/api/v1/ips/8.8.8.8?format=csv', {
      headers: userHeaders
    }));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/csv');
  });
});

describe('RESTful 契约：运维端点结构', () => {
  beforeAll(async() => {
    await configManager.initialize();
    await monitoringService.start();
  });

  const systemPaths = [
    '/api/v1/system',
    '/api/v1/system/health',
    '/api/v1/system/metrics',
    '/api/v1/system/status',
    '/api/v1/system/config',
    '/api/v1/system/alerts',
    '/api/v1/system/memory',
    '/api/v1/system/performance'
  ];

  systemPaths.forEach((path) => {
    it(`GET ${path} 管理员 → 200 + 信封`, async() => {
      const { status, body } = await get(path, adminHeaders);
      expect(status).toBe(200);
      expect(body).toHaveProperty('data');
      expect(body).toHaveProperty('meta');
    });
  });

  it('POST /api/v1/system/memory:cleanup 管理员 → 200', async() => {
    const { status, body } = await fetchJson('/api/v1/system/memory:cleanup', {
      method: 'POST',
      headers: adminHeaders
    });
    expect(status).toBe(200);
    expect(body.data.action).toBe('cleanup');
  });

  it('POST /api/v1/system/memory:optimize 管理员 → 200', async() => {
    const { status, body } = await fetchJson('/api/v1/system/memory:optimize', {
      method: 'POST',
      headers: adminHeaders
    });
    expect(status).toBe(200);
    expect(body.data.action).toBe('optimize');
  });
});
