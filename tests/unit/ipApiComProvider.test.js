/**
 * 🌐 IPApiComProvider 单元测试（mock fetch，确定性，不触达真实网络）
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { IPApiComProvider } from '../../src/providers/ipApiCom.js';

const sampleResponse = {
  status: 'success',
  country: 'United States',
  countryCode: 'US',
  region: 'VA',
  regionName: 'Virginia',
  city: 'Ashburn',
  zip: '20149',
  lat: 39.03,
  lon: -77.5,
  timezone: 'America/New_York',
  isp: 'Google LLC',
  org: 'Google Public DNS',
  as: 'AS15169 Google LLC',
  reverse: 'dns.google',
  mobile: false,
  proxy: false,
  hosting: false,
  query: '8.8.8.8'
};

describe('IPApiComProvider', () => {
  let provider;
  let originalFetch;

  beforeEach(() => {
    provider = new IPApiComProvider();
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('优先级与名称正确（默认禁用：需 ENABLE_INSECURE_IPAPI_FALLBACK=true）', () => {
    // 96107c0 security fix: IPApiComProvider 默认关闭（避免明文外发 IP），
    // 必须显式设置 ENABLE_INSECURE_IPAPI_FALLBACK=true 才启用。测试名"免 token
    // 始终可用"是误导——免的是 token，但仍需显式开关。
    expect(provider.priority).toBe(40);
    expect(provider.name).toBe('IPApiCom');
    // 默认 isConfigured() === false（PROVIDERS_CONFIG.endpoints.ipapicom.enabledByDefault: false）
    expect(provider.isConfigured()).toBe(false);
  });

  it('设置 ENABLE_INSECURE_IPAPI_FALLBACK=true 后 isConfigured() 为 true', () => {
    // 重新构造，传入 enabled 标志
    const enabledProvider = new IPApiComProvider({ ENABLE_INSECURE_IPAPI_FALLBACK: true });
    expect(enabledProvider.isConfigured()).toBe(true);
  });

  it('fetch 解析真实响应为规范 GeoData', async() => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async() => sampleResponse
    });

    const r = await provider.fetch('8.8.8.8', { language: 'en' });
    expect(r.ip).toBe('8.8.8.8');
    expect(r.country.name).toBe('United States');
    expect(r.country.code).toBe('US');
    expect(r.country.city).toBe('Ashburn');
    expect(r.location.coordinates.latitude).toBe(39.03);
    expect(r.location.coordinates.longitude).toBe(-77.5);
    expect(r.location.timezone).toBe('America/New_York');
    expect(r.network.asn).toBe(15169);
    expect(r.network.organization).toBe('Google LLC');
    expect(r.network.isp).toBe('Google LLC');
  });

  it('从 "AS15169 Google LLC" 解析 ASN 与组织', () => {
    expect(provider.parseASN('AS15169 Google LLC')).toBe(15169);
    expect(provider.parseAsOrganization('AS15169 Google LLC')).toBe('Google LLC');
    expect(provider.parseASN(null)).toBeNull();
  });

  it('HTTP 错误状态抛出含状态码的错误', async() => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      statusText: 'Too Many Requests'
    });
    await expect(provider.fetch('8.8.8.8', {})).rejects.toThrow(/429/);
  });

  it('上游 status!=success 抛出错误', async() => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async() => ({ status: 'fail', message: 'invalid query' })
    });
    await expect(provider.fetch('bad', {})).rejects.toThrow(/invalid query|查询失败/);
  });

  it('timeout 转为描述性错误', async() => {
    globalThis.fetch = vi.fn().mockImplementation(() => {
      const err = new Error('timed out');
      err.name = 'AbortError';
      return Promise.reject(err);
    });
    await expect(provider.fetch('8.8.8.8', {})).rejects.toThrow(/超时/);
  });
});
