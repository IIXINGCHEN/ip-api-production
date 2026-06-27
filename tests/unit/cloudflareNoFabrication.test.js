/**
 * 🔬 Cloudflare provider 无编造数据测试（No Mock Data Policy）
 *
 * 无论开发还是生产，无 request.cf 真实数据时返回 null 字段（规范 GeoData），
 * 绝不编造国家/城市/坐标，也不附加 dataSource 标记。
 *
 * 注意：C+D 重构后 provider 改用同步 tryExtractSync(ip, ctx)，返回规范 GeoData
 * （country/location/network 嵌套结构）。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const setEnv = (env) => {
  if (env) globalThis.ENVIRONMENT = env;
  else delete globalThis.ENVIRONMENT;
  if (typeof process !== 'undefined' && process.env) {
    if (env) process.env.ENVIRONMENT = env;
    else delete process.env.ENVIRONMENT;
  }
};

describe('CloudflareProvider 无编造数据 (No Mock Data Policy)', () => {
  let originalEnv;

  beforeEach(() => {
    originalEnv = globalThis.ENVIRONMENT;
    vi.resetModules();
  });

  afterEach(() => {
    setEnv(originalEnv);
  });

  it('dev: 空 cf 不编造，返回 null 字段且无 dataSource 标记', async() => {
    setEnv('development');
    vi.resetModules();
    const { CloudflareProvider } = await import('../../src/providers/cloudflare.js');
    const p = new CloudflareProvider();
    const r = p.tryExtractSync('8.8.8.8', { cf: {}, headers: new Headers() });
    expect(r.country.name).toBeNull();
    expect(r.country.city).toBeNull();
    expect(r.country.code).toBeNull();
    expect(r.network.organization).toBeNull();
    expect(r.network.asn).toBeNull();
    expect(r.dataSource).toBeUndefined();
    // 不应存在任何编造标记
    expect(r.approxFromPrefix).toBeUndefined();
  });

  it('dev: 未知 IP 也不编造（旧版按 /24 hash 选区域，现已移除）', async() => {
    setEnv('development');
    vi.resetModules();
    const { CloudflareProvider } = await import('../../src/providers/cloudflare.js');
    const p = new CloudflareProvider();
    const r1 = p.tryExtractSync('203.0.113.42', { cf: {}, headers: new Headers() });
    const r2 = p.tryExtractSync('203.0.113.99', { cf: {}, headers: new Headers() });
    expect(r1.country.name).toBeNull();
    expect(r1.country.city).toBeNull();
    expect(r1.dataSource).toBeUndefined();
    expect(r1.approxFromPrefix).toBeUndefined();
    expect(r2.country.name).toBeNull();
  });

  it('dev: IPv6 空 cf 也不编造（旧版返回 XX/Unknown，现已移除）', async() => {
    setEnv('development');
    vi.resetModules();
    const { CloudflareProvider } = await import('../../src/providers/cloudflare.js');
    const p = new CloudflareProvider();
    const r = p.tryExtractSync('2001:db8::1', { cf: {}, headers: new Headers() });
    expect(r.country.name).toBeNull();
    expect(r.country.city).toBeNull();
    expect(r.dataSource).toBeUndefined();
  });

  it('production: 空 cf 返回 null 字段，无 dataSource 标记', async() => {
    setEnv('production');
    vi.resetModules();
    const { CloudflareProvider } = await import('../../src/providers/cloudflare.js');
    const p = new CloudflareProvider();
    const r = p.tryExtractSync('8.8.8.8', { cf: {}, headers: new Headers() });
    expect(r.country.name).toBeNull();
    expect(r.country.city).toBeNull();
    expect(r.dataSource).toBeUndefined();
  });

  it('production: 真实 cf 数据原样透传，无编造标记', async() => {
    setEnv('production');
    vi.resetModules();
    const { CloudflareProvider } = await import('../../src/providers/cloudflare.js');
    const p = new CloudflareProvider();
    const r = p.tryExtractSync('8.8.8.8', {
      cf: { country: 'US', city: 'Mountain View', region: 'CA', asn: 15169, asOrganization: 'Google LLC' },
      headers: new Headers()
    });
    expect(r.country.code).toBe('US');
    expect(r.country.city).toBe('Mountain View');
    expect(r.network.organization).toBe('Google LLC');
    expect(r.dataSource).toBeUndefined();
  });

  it('CloudflareProvider 不再有 getDevelopmentGeoData 方法', async() => {
    vi.resetModules();
    const { CloudflareProvider } = await import('../../src/providers/cloudflare.js');
    const p = new CloudflareProvider();
    expect(typeof p.getDevelopmentGeoData).toBe('undefined');
  });
});
