/**
 * 🌍 GeoLookup 构造期 providers 注入 — 消除 monkey-patch 验证
 *
 * 此文件验证：new GeoLookup({ providers: [fake] }) 后，getOptimizedProviders()
 * 返回 [fake instance]，不再走默认注册表。这是 PR 4 阶段产物（迁移自
 * PerformanceOptimizer 命名，因为 perf-optimizer.js 整文件已删除）。
 */

import { describe, it, expect } from 'vitest';
import { GeoLookup } from '../../src/services/geoLookup.js';
import { BaseProvider } from '../../src/providers/BaseProvider.js';

class FakeProvider extends BaseProvider {
  constructor() {
    super('FakeProvider', { priority: 99, tier: 'sync' });
    this.callCount = 0;
  }
  isConfigured() { return true; }
  tryExtractSync(_ip, _ctx) {
    this.callCount += 1;
    return null; // 不生产 geo data；只证明被调过
  }
  async fetch(_ip, _opts = {}) {
    this.callCount += 1;
    return null;
  }
}

describe('GeoLookup — 构造期 providers 注入', () => {
  it('不传 providers 时回落到默认注册表（行为不变）', async() => {
    const geo = new GeoLookup();
    const providers = await geo.getOptimizedProviders({});
    // 默认注册表 4 个 provider（cloudflare/maxmind/ipinfo/ipapicom）
    expect(providers.length).toBeGreaterThanOrEqual(1);
    expect(providers.every((p) => p instanceof BaseProvider)).toBe(true);
  });

  it('传 providers 时仅返回注入的 fake provider 类型（消除 monkey-patch 入口）', async() => {
    const geo = new GeoLookup({ providers: [{ ProviderClass: FakeProvider }] });
    const providers = await geo.getOptimizedProviders({});
    expect(providers).toHaveLength(1);
    expect(providers[0]).toBeInstanceOf(FakeProvider);
    // 默认 4 个真 provider 不在结果中
    const names = providers.map((p) => p.name);
    expect(names).toEqual(['FakeProvider']);
  });

  it('注入空 providers 数组得到空列表（不会回落到默认注册表）', async() => {
    const geo = new GeoLookup({ providers: [] });
    const providers = await geo.getOptimizedProviders({});
    expect(providers).toEqual([]);
  });
});
