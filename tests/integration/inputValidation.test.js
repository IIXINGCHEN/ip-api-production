/**
 * 🔒 输入验证集成测试 — 新 RESTful 端点
 */

import { describe, it, expect, beforeEach } from 'vitest';
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
  return { status: res.status, body };
};

describe('IP 地址验证', () => {
  beforeEach(async() => {
    await configManager.initialize();
    await monitoringService.start();
  });

  it('接受有效 IPv4', async() => {
    const { status } = await req('/api/v1/ips/8.8.8.8', withAuth());
    expect(status).toBe(200);
  });

  it('拒绝无效 IP → 400 BAD_REQUEST', async() => {
    const { status, body } = await req('/api/v1/ips/not-an-ip', withAuth());
    expect(status).toBe(400);
    expect(body.error.code).toBe('BAD_REQUEST');
  });

  it('拒绝私有 IP → 400', async() => {
    const { status } = await req('/api/v1/ips/192.168.1.1', withAuth());
    expect(status).toBe(400);
  });

  it('拒绝环回 IP → 400', async() => {
    const { status } = await req('/api/v1/ips/127.0.0.1', withAuth());
    expect(status).toBe(400);
  });
});

describe('查询参数验证', () => {
  beforeEach(async() => {
    await configManager.initialize();
    await monitoringService.start();
  });

  it('接受有效查询参数', async() => {
    const url = '/api/v1/ips/8.8.8.8?format=json&includeThreat=true&fields=ip,country,city';
    const { status } = await req(url, withAuth());
    expect(status).toBe(200);
  });

  it('拒绝无效 format → 400', async() => {
    const { status } = await req('/api/v1/ips/8.8.8.8?format=invalid', withAuth());
    expect(status).toBe(400);
  });

  it('拒绝过长字段列表 → 400', async() => {
    const longFields = 'ip,country,' + 'field'.repeat(100);
    const { status } = await req(`/api/v1/ips/8.8.8.8?fields=${encodeURIComponent(longFields)}`, withAuth());
    expect(status).toBe(400);
  });

  it('拒绝无效语言代码 → 400', async() => {
    const { status } = await req('/api/v1/ips/8.8.8.8?lang=x', withAuth());
    expect(status).toBe(400);
  });

  it('拒绝超范围 timeout → 400', async() => {
    const { status } = await req('/api/v1/ips/8.8.8.8?timeout=15000', withAuth());
    expect(status).toBe(400);
  });

  it('拒绝非法 callback 函数名 → 400', async() => {
    const { status } = await req('/api/v1/ips/8.8.8.8?callback=123invalid', withAuth());
    expect(status).toBe(400);
  });

  it('拒绝过长 callback → 400', async() => {
    const { status } = await req(`/api/v1/ips/8.8.8.8?callback=${'a'.repeat(200)}`, withAuth());
    expect(status).toBe(400);
  });
});

describe('批量请求验证', () => {
  beforeEach(async() => {
    await configManager.initialize();
    await monitoringService.start();
  });

  it('接受有效批量请求', async() => {
    const { status, body } = await req('/api/v1/ips:batch', withAuth({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ips: ['8.8.8.8', '1.1.1.1'] })
    }));
    expect(status).toBe(200);
    expect(body.data.results).toHaveLength(2);
  });

  it('拒绝过大 IP 列表（>100）→ 400', async() => {
    const largeList = Array.from({ length: 150 }, (_, i) => `8.8.8.${i % 255}`);
    const { status } = await req('/api/v1/ips:batch', withAuth({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ips: largeList })
    }));
    expect(status).toBe(400);
  });

  it('拒绝空 IP 列表 → 400', async() => {
    const { status } = await req('/api/v1/ips:batch', withAuth({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ips: [] })
    }));
    expect(status).toBe(400);
  });

  it('拒绝包含无效 IP 的批量请求 → 400', async() => {
    const { status } = await req('/api/v1/ips:batch', withAuth({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ips: ['8.8.8.8', 'not-an-ip'] })
    }));
    expect(status).toBe(400);
  });

  it('拒绝包含私有 IP 的批量请求 → 400', async() => {
    const { status } = await req('/api/v1/ips:batch', withAuth({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ips: ['8.8.8.8', '192.168.1.1'] })
    }));
    expect(status).toBe(400);
  });
});

describe('错误响应规范', () => {
  beforeEach(async() => {
    await configManager.initialize();
    await monitoringService.start();
  });

  it('错误响应含 error + meta，无 data/success', async() => {
    const { status, body } = await req('/api/v1/ips/not-an-ip', withAuth());
    expect(status).toBe(400);
    expect(body).toHaveProperty('error');
    expect(body).toHaveProperty('meta');
    expect(body).not.toHaveProperty('data');
    expect(body).not.toHaveProperty('success');
    expect(body.error).toHaveProperty('code');
    expect(body.error).toHaveProperty('message');
    expect(body.meta).toHaveProperty('requestId');
    expect(body.meta).toHaveProperty('apiVersion', 'v1');
  });

  it('非开发环境隐藏错误详情', async() => {
    const { body } = await req('/api/v1/ips/not-an-ip', withAuth());
    expect(body.error.details).toBeUndefined();
  });
});
