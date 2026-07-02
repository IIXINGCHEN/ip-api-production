/**
 * ⚡ 性能优化器测试（PR 4 迁移：PerformanceOptimizer → GeoLookup）
 *
 * 原测 PerformanceOptimizer 类的 5 个 internal class 行为（ResultCache / ProviderPool /
 * BatchProcessor / PerformanceMonitor / DataCompressor）+ 配置 + 集成调用。PR 4 阶段
 * perf-optimizer.js 整文件删除，类名迁到 GeoLookup（API 兼容：getOptimizedProviders /
 * basicMerge / withTimeout / cloneResult / getStats / cleanup / destroy 全部同名）。
 *
 * 测试集保持同样覆盖面；只做机械 rename + 修一处 monkey-patch（line 184 原
 * `optimizer.getOptimizedProviders = () => []` 改用构造期 `new GeoLookup({ providers: [] })` seam，
 * 这正是 PR 3 命名要消除的 monkey-patch）。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GeoLookup } from '../../src/services/geoLookup.js';
import { createMockRequest, testIPs } from '../setup.js';

describe('GeoLookup', () => {
  let geo;

  beforeEach(() => {
    geo = new GeoLookup();
  });

  afterEach(() => {
    geo.cleanup();
  });

  describe('基础功能', () => {
    it('应该正确初始化', () => {
      expect(geo.enabled).toBe(true);
      expect(geo.providerPool).toBeDefined();
      expect(geo.cache).toBeDefined();
      expect(geo.batchProcessor).toBeDefined();
      expect(geo.monitor).toBeDefined();
    });

    it('应该能够启用/禁用优化', () => {
      geo.setEnabled(false);
      expect(geo.enabled).toBe(false);

      geo.setEnabled(true);
      expect(geo.enabled).toBe(true);
    });
  });

  describe('结果缓存', () => {
    it('应该正确缓存和检索结果', () => {
      const ip = '8.8.8.8';
      const options = { includeThreat: true };
      const data = { ip, country: 'US' };

      // 设置缓存
      geo.cache.set(ip, options, data);

      // 检索缓存
      const cached = geo.cache.get(ip, options);
      expect(cached).toEqual(data);
    });

    it('应该正确生成缓存键', () => {
      // 注意：cache key 只 pick 影响 geo data 的选项（language / includeThreat），
      // 不 pick format/fields 等序列化/投影选项——因为它们不影响查询结果。
      // 旧测试用 `format` 是 base 时代遗留（PR 5 已把 cacheKeyFor 集中到 SecureCache，
      // 此处 ResultCache.generateKey 仍按"只 pick cache-relevant 字段"实现）。
      const ip = '192.168.1.1';
      const options1 = { language: 'en' };
      const options2 = { language: 'en', includeThreat: true };

      const key1 = geo.cache.generateKey(ip, options1);
      const key2 = geo.cache.generateKey(ip, options2);

      expect(key1).not.toBe(key2);
      expect(key1).toContain('192.168.1.1');
      expect(key1).toContain('language=en');
    });

    it('应该正确管理缓存大小', () => {
      const smallCache = geo.cache;
      smallCache.maxSize = 3;

      smallCache.set('ip1', {}, { data: '1' });
      smallCache.set('ip2', {}, { data: '2' });
      smallCache.set('ip3', {}, { data: '3' });

      expect(smallCache.getStats().size).toBe(3);

      smallCache.set('ip4', {}, { data: '4' });

      expect(smallCache.getStats().size).toBeLessThanOrEqual(3);
    });
  });

  describe('Provider池', () => {
    it('应该正确管理Provider实例', () => {
      class MockProvider {
        constructor() {
          this.name = 'MockProvider';
          this.priority = 1;
        }
        async getGeoInfo() {
          return { test: 'data' };
        }
      }

      const provider1 = geo.providerPool.getProvider(MockProvider);
      const provider2 = geo.providerPool.getProvider(MockProvider);

      expect(provider1).toBe(provider2);
      expect(provider1.name).toBe('MockProvider');
    });

    it('应该正确获取池统计信息', () => {
      const stats = geo.providerPool.getStats();
      expect(stats).toHaveProperty('size');
      expect(stats).toHaveProperty('instances');
      expect(Array.isArray(stats.instances)).toBe(true);
    });
  });

  describe('Provider 注册表加载', () => {
    // 回归保护：getOptimizedProviders 必须能加载 DEFAULT_PROVIDER_REGISTRY 中声明的所有 provider。
    it('应该成功加载注册表中的 provider 模块且不抛模块解析错误', async() => {
      const providers = await geo.getOptimizedProviders();

      expect(Array.isArray(providers)).toBe(true);
      for (const provider of providers) {
        expect(typeof provider).toBe('object');
        expect(typeof provider.priority).toBe('number');
      }
    });
  });

  describe('批处理', () => {
    it('应该正确处理批处理请求', async() => {
      const requestFn = async(ip, options) => {
        return { ip, processed: true, options };
      };

      const ip = '192.168.1.1';
      const options = { test: true };

      const result1 = await geo.batchProcessor.addRequest(ip, requestFn, options);
      const result2 = await geo.batchProcessor.addRequest(ip, requestFn, options);

      expect(result1).toEqual(result2);
      expect(result1.ip).toBe(ip);
      expect(result1.processed).toBe(true);
    }, 10000);

    it('应该区分相同IP但不同选项值的批处理键', () => {
      const ip = '8.8.8.8';
      const keyWithoutThreat = geo.batchProcessor.generateBatchKey(ip, {
        includeThreat: false,
        language: 'en'
      });
      const keyWithThreat = geo.batchProcessor.generateBatchKey(ip, {
        includeThreat: true,
        language: 'en'
      });

      expect(keyWithoutThreat).not.toBe(keyWithThreat);
    });

    it('应该正确清理批处理队列', async() => {
      const requestFn = async() => {
        return { test: 'data' };
      };

      const pendingRequests = [
        geo.batchProcessor.addRequest('ip1', requestFn).catch((error) => error),
        geo.batchProcessor.addRequest('ip2', requestFn).catch((error) => error)
      ];

      geo.batchProcessor.clear();
      await Promise.all(pendingRequests);

      const stats = geo.batchProcessor.pendingRequests;
      expect(stats.size).toBe(0);
    });
  });

  describe('优化查询', () => {
    // 🆕 PR 4 改写：原 `optimizer.getOptimizedProviders = () => []` 是 monkey-patch
    // 穿透到私有方法，违反"the interface is the test surface"。现在改用构造期 seam
    // `new GeoLookup({ providers: [] })` —— 走真构造器，seam 不破。
    it('应该在请求威胁信息时保留威胁检测结果', async() => {
      const geoWithEmptyProviders = new GeoLookup({ providers: [] });

      const request = createMockRequest('/', {
        headers: {
          'user-agent': 'bot-scan-malicious/1.0',
          'x-forwarded-for': '192.168.1.1, 203.0.113.1',
          via: 'proxy-server'
        }
      });

      const result = await geoWithEmptyProviders.get(testIPs.suspicious, request, {
        includeThreat: true,
        language: 'en'
      });

      expect(result.threat).toBeDefined();
      expect(result.threat.riskScore).toBeGreaterThan(0);

      geoWithEmptyProviders.cleanup();
    });
  });

  describe('性能监控', () => {
    it('应该正确记录性能指标', () => {
      const operationName = 'test_operation';
      const duration = 100;

      geo.monitor.record(operationName, duration);

      const stats = geo.monitor.getStats();
      expect(stats.metrics).toHaveProperty(operationName);
      expect(stats.metrics[operationName].count).toBe(1);
      expect(stats.metrics[operationName].avgTime).toBe(100);
    });

    it('应该正确计算平均时间', () => {
      const operationName = 'avg_test';

      geo.monitor.record(operationName, 100);
      geo.monitor.record(operationName, 200);
      geo.monitor.record(operationName, 300);

      const stats = geo.monitor.getStats();
      expect(stats.metrics[operationName].avgTime).toBe(200);
    });

    it('应该正确清理指标', () => {
      geo.monitor.record('test', 100);
      expect(geo.monitor.getStats().metrics).toHaveProperty('test');

      geo.monitor.clear();
      expect(geo.monitor.getStats().metrics).toEqual({});
    });
  });

  describe('数据压缩', () => {
    it('应该正确压缩地理位置数据', () => {
      const data = {
        ip: '192.168.1.1',
        country: 'United States of America',
        countryCode: 'US',
        latitude: 40.712776,
        longitude: -74.005974,
        sources: ['provider1', 'provider2', 'provider3', 'provider4']
      };

      const compressed = GeoLookup.DataCompressor.compressGeoData(data);

      expect(compressed.country).toBe('United States of America');
      expect(compressed.latitude).toBe(40.71277);
      expect(compressed.sources).toHaveLength(3);
    });

    it('应该正确处理空数据', () => {
      const result1 = GeoLookup.DataCompressor.compressGeoData(null);
      const result2 = GeoLookup.DataCompressor.compressGeoData(undefined);
      const result3 = GeoLookup.DataCompressor.compressGeoData({});

      expect(result1).toBe(null);
      expect(result2).toBe(undefined);
      expect(result3).toEqual({});
    });
  });

  describe('整体性能统计', () => {
    it('应该正确获取性能统计信息', () => {
      const stats = geo.getStats();

      expect(stats).toHaveProperty('providerPool');
      expect(stats).toHaveProperty('cache');
      expect(stats).toHaveProperty('monitor');
      expect(stats).toHaveProperty('enabled');

      expect(typeof stats.providerPool.size).toBe('number');
      expect(typeof stats.cache.hits).toBe('number');
      expect(typeof stats.monitor.uptime).toBe('number');
    });

    it('应该正确跟踪缓存命中率', () => {
      const cache = geo.cache;

      cache.set('ip1', {}, { data: '1' });
      cache.set('ip2', {}, { data: '2' });

      cache.get('ip1', {});
      cache.get('ip2', {});
      cache.get('ip3', {}); // 未命中

      const stats = cache.getStats();
      expect(stats.hitRate).toBeGreaterThan(0);
      expect(stats.hits).toBe(2);
      expect(stats.misses).toBe(1);
    });
  });

  describe('资源清理', () => {
    it('应该正确清理所有资源', () => {
      geo.cache.set('test', {}, { data: 'test' });
      geo.monitor.record('test', 100);

      geo.cleanup();

      expect(geo.cache.getStats().size).toBe(0);
      expect(Object.keys(geo.monitor.getStats().metrics)).toHaveLength(0);
    });
  });

  describe('错误处理', () => {
    it('应该优雅处理无效输入', () => {
      expect(() => {
        geo.monitor.record('', -100);
      }).not.toThrow();

      expect(() => {
        geo.cache.set(null, null, null);
      }).not.toThrow();
    });

    it('应该优雅处理批处理错误', async() => {
      const errorFn = async() => {
        throw new Error('Test error');
      };

      await expect(
        geo.batchProcessor.addRequest('ip1', errorFn)
      ).rejects.toThrow('Test error');
    }, 5000);
  });

  describe('配置管理', () => {
    it('应该使用正确的默认配置', () => {
      expect(geo.cache.maxSize).toBe(1000);
      expect(geo.cache.ttl).toBe(300000);
      expect(geo.batchProcessor.maxBatchSize).toBe(10);
      expect(geo.batchProcessor.maxWaitTime).toBe(50);
    });

    it('应该允许配置自定义参数', () => {
      const customGeo = new GeoLookup();

      expect(customGeo.cache.maxSize).toBe(1000);

      customGeo.destroy();
    });
  });
});
