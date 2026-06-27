/**
 * ⚡ performanceOptimizer.basicMerge 优先级合并测试（规范 GeoData 嵌套形状）
 *
 * 锁定：合并必须优先级感知——高优先级 provider 数据胜出，低优先级仅填空；
 * provider 归因到含可用地理数据的最高优先级来源。
 */

import { describe, it, expect } from 'vitest';
import { PerformanceOptimizer } from '../../src/services/performanceOptimizer.js';

const opt = new PerformanceOptimizer();

// 模拟 provider（带 priority）
const mkProvider = (name, priority) => ({ name, priority });

// 构造规范 GeoData（仅 country 可变，location/network 为空壳）
const geo = (country = {}) => ({ country, location: { coordinates: {} }, network: {} });

const fulfilled = (value) => ({ status: 'fulfilled', value });

describe('basicMerge 优先级感知合并（规范 GeoData）', () => {
  it('高优先级 provider 同字段值胜出（不被低优先级覆盖）', () => {
    const providers = [mkProvider('Cloudflare', 100), mkProvider('IPApiCom', 40)];
    const results = [
      fulfilled(geo({ code: 'CF' })),
      fulfilled(geo({ code: 'FB' }))
    ];
    const merged = opt.basicMerge(results, providers, '8.8.8.8');
    expect(merged.country.code).toBe('CF');
  });

  it('低优先级 provider 填补高优先级的空字段', () => {
    const providers = [mkProvider('Cloudflare', 100), mkProvider('IPApiCom', 40)];
    const results = [
      fulfilled(geo({ code: 'US' })),            // Cloudflare 有 code 无 city
      fulfilled(geo({ city: 'Ashburn' }))        // IPApiCom 补 city
    ];
    const merged = opt.basicMerge(results, providers, '8.8.8.8');
    expect(merged.country.code).toBe('US');
    expect(merged.country.city).toBe('Ashburn');
  });

  it('provider 归因到含可用地理数据的最高优先级来源（非平凡字段）', () => {
    const providers = [mkProvider('Cloudflare', 100), mkProvider('IPApiCom', 40)];
    // Cloudflare 无地理数据；IPApiCom 贡献地理
    const results = [
      fulfilled(geo({})),
      fulfilled(geo({ name: 'United States', city: 'Ashburn' }))
    ];
    const merged = opt.basicMerge(results, providers, '8.8.8.8');
    expect(merged.country.name).toBe('United States');
    expect(merged.country.city).toBe('Ashburn');
    expect(merged.provider).toBe('IPApiCom'); // 非 Cloudflare
  });

  it('高优先级有地理数据时归因为高优先级', () => {
    const providers = [mkProvider('Cloudflare', 100), mkProvider('IPApiCom', 40)];
    const results = [
      fulfilled(geo({ code: 'US', city: 'CF City' })),
      fulfilled(geo({ code: 'US2', city: 'IPApiCom City' }))
    ];
    const merged = opt.basicMerge(results, providers, '8.8.8.8');
    expect(merged.provider).toBe('Cloudflare');
    expect(merged.country.city).toBe('CF City'); // 高优先级胜出
  });

  it('null/undefined 叶子不参与合并，非空兄弟字段保留', () => {
    const providers = [mkProvider('Cloudflare', 100)];
    const results = [
      fulfilled({
        country: { code: null, city: undefined },
        location: { coordinates: {}, timezone: 'UTC' },
        network: {}
      })
    ];
    const merged = opt.basicMerge(results, providers, '8.8.8.8');
    expect(merged.country.code).toBeUndefined();
    expect(merged.location.timezone).toBe('UTC');
  });

  it('所有 provider 无地理数据时 provider 归因为 unknown', () => {
    const providers = [mkProvider('Cloudflare', 100)];
    const results = [fulfilled(geo({}))];
    const merged = opt.basicMerge(results, providers, '8.8.8.8');
    expect(merged.provider).toBe('unknown');
  });

  it('rejected provider 结果被跳过', () => {
    const providers = [mkProvider('Cloudflare', 100), mkProvider('IPApiCom', 40)];
    const results = [
      { status: 'rejected', reason: new Error('fail') },
      fulfilled(geo({ code: 'US', city: 'Ashburn' }))
    ];
    const merged = opt.basicMerge(results, providers, '8.8.8.8');
    expect(merged.country.code).toBe('US');
    expect(merged.provider).toBe('IPApiCom');
  });
});
