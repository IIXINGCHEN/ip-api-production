/**
 * 🌍 GeoLookup — 接口合约测试
 *
 * 本测试断言构造器注入接口的契约：
 * - 默认 providers 是 DEFAULT_PROVIDER_REGISTRY 引用（非 null）
 * - 默认 cache / batchProcessor / monitor 是 GeoLookup 内部 new 出来的实例
 * - 注入 deps.providers / cache / batchProcessor / monitor / threatDetector 覆盖默认
 * - threatDetector 默认实现可注入并被构造器接住
 *
 * 本测试不验证 get() 的行为（端到端由 performanceOptimizer.test.js 覆盖，
 * 计划 PR 4 阶段 4 迁移到 GeoLookup）。
 */

import { describe, it, expect, vi } from 'vitest';
import { GeoLookup, getDefaultProviders, getDefaultThreatDetector } from '../../src/services/geoLookup.js';

describe('GeoLookup — 接口合约', () => {
  it('无参数构造产生一个可用的实例', () => {
    const g = new GeoLookup();
    expect(g).toBeInstanceOf(GeoLookup);
    // providers 默认 = DEFAULT_PROVIDER_REGISTRY 引用（getDefaultProviders()）
    expect(g.providers).toBe(getDefaultProviders());
    // cache / batchProcessor / monitor 默认由 GeoLookup 内部 new
    expect(g.cache).toBeDefined();
    expect(g.batchProcessor).toBeDefined();
    expect(g.monitor).toBeDefined();
    expect(g.isTest).toBe(false);
    expect(typeof g.threatDetector).toBe('function');
  });

  it('isTest 标志被记录', () => {
    const g = new GeoLookup({ isTest: true });
    expect(g.isTest).toBe(true);
  });

  it('接受注入的 fake providers 数组', () => {
    const fakeProvider = {
      name: 'FakeProvider',
      tier: 'sync',
      priority: 99,
      tryExtractSync: () => null,
      fetch: async() => null,
      isConfigured: () => true
    };
    const g = new GeoLookup({ providers: [fakeProvider] });
    expect(g.providers).toHaveLength(1);
    expect(g.providers[0]).toBe(fakeProvider);
  });

  it('接受注入的 fake cache / batchProcessor / monitor', () => {
    const cache = { get: vi.fn(), set: vi.fn() };
    const batchProcessor = { addRequest: vi.fn() };
    const monitor = { record: vi.fn() };

    const g = new GeoLookup({ cache, batchProcessor, monitor });
    expect(g.cache).toBe(cache);
    expect(g.batchProcessor).toBe(batchProcessor);
    expect(g.monitor).toBe(monitor);
  });

  it('接受注入的 fake threatDetector', () => {
    const detector = vi.fn().mockResolvedValue({ riskScore: 0, threats: [] });
    const g = new GeoLookup({ threatDetector: detector });
    expect(g.threatDetector).toBe(detector);
  });

  it('getDefaultProviders 返回模块级注册表（默认 4 个真 provider）', () => {
    const providers = getDefaultProviders();
    expect(Array.isArray(providers)).toBe(true);
    expect(providers.length).toBe(4);
    expect(providers.map((p) => p.ProviderClass.name)).toEqual([
      'CloudflareProvider', 'MaxMindProvider', 'IPInfoProvider', 'IPApiComProvider'
    ]);
  });

  it('getDefaultThreatDetector 返回函数（默认实现，调用 ThreatService.getInstance）', async() => {
    const detector = getDefaultThreatDetector();
    expect(typeof detector).toBe('function');
    // 不实际调用 — ThreatService 单例依赖大量模块（THREAT_RULES 等），
    // 此处仅验证导出形状；端到端行为由既有 threatService.test.js 覆盖。
  });
});
