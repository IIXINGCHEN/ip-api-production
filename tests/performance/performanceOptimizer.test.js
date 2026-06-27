/**
 * ⚡ 性能优化器测试
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PerformanceOptimizer } from '../../src/services/performanceOptimizer.js';
import { createMockRequest, testIPs } from '../setup.js';

describe('PerformanceOptimizer', () => {
  let optimizer;

  beforeEach(() => {
    optimizer = new PerformanceOptimizer();
  });

  afterEach(() => {
    optimizer.cleanup();
  });

  describe('基础功能', () => {
    it('应该正确初始化', () => {
      expect(optimizer.enabled).toBe(true);
      expect(optimizer.providerPool).toBeDefined();
      expect(optimizer.resultCache).toBeDefined();
      expect(optimizer.batchProcessor).toBeDefined();
      expect(optimizer.monitor).toBeDefined();
    });

    it('应该能够启用/禁用优化', () => {
      optimizer.setEnabled(false);
      expect(optimizer.enabled).toBe(false);

      optimizer.setEnabled(true);
      expect(optimizer.enabled).toBe(true);
    });
  });

  describe('结果缓存', () => {
    it('应该正确缓存和检索结果', () => {
      const ip = '8.8.8.8';
      const options = { includeThreat: true };
      const data = { ip, country: 'US' };

      // 设置缓存
      optimizer.resultCache.set(ip, options, data);

      // 检索缓存
      const cached = optimizer.resultCache.get(ip, options);
      expect(cached).toEqual(data);
    });

    it('应该正确生成缓存键', () => {
      const ip = '192.168.1.1';
      const options1 = { format: 'json' };
      const options2 = { format: 'json', includeThreat: true };

      const key1 = optimizer.resultCache.generateKey(ip, options1);
      const key2 = optimizer.resultCache.generateKey(ip, options2);

      expect(key1).not.toBe(key2);
      expect(key1).toContain('192.168.1.1');
      expect(key1).toContain('format=json');
    });

    it('应该正确管理缓存大小', () => {
      const smallCache = optimizer.resultCache;
      smallCache.maxSize = 3;

      // 添加3个项目
      smallCache.set('ip1', {}, { data: '1' });
      smallCache.set('ip2', {}, { data: '2' });
      smallCache.set('ip3', {}, { data: '3' });

      expect(smallCache.getStats().size).toBe(3);

      // 添加第4个项目，应该淘汰最旧的
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

      const provider1 = optimizer.providerPool.getProvider(MockProvider);
      const provider2 = optimizer.providerPool.getProvider(MockProvider);

      // 应该返回同一个实例
      expect(provider1).toBe(provider2);
      expect(provider1.name).toBe('MockProvider');
    });

    it('应该正确获取池统计信息', () => {
      const stats = optimizer.providerPool.getStats();
      expect(stats).toHaveProperty('size');
      expect(stats).toHaveProperty('instances');
      expect(Array.isArray(stats.instances)).toBe(true);
    });
  });

  describe('Provider 注册表加载', () => {
    // 回归保护：getOptimizedProviders 必须能加载 PROVIDER_REGISTRY 中声明的所有 provider 模块。
    // 历史问题：动态 await import('../providers/...') 在 workerd 本地 dev 下相对路径解析失败
    // （No such module），生产 esbuild 打包则正常。本测试确保模块加载路径在所有运行时都可用。
    it('应该成功加载注册表中的 provider 模块且不抛模块解析错误', async() => {
      const providers = await optimizer.getOptimizedProviders();

      // 返回值必须是数组；元素（若 isConfigured 通过）须带优先级用于排序
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

      const result1 = await optimizer.batchProcessor.addRequest(ip, requestFn, options);
      const result2 = await optimizer.batchProcessor.addRequest(ip, requestFn, options);

      // 两个请求应该得到相同的结果
      expect(result1).toEqual(result2);
      expect(result1.ip).toBe(ip);
      expect(result1.processed).toBe(true);
    }, 10000);

    it('应该区分相同IP但不同选项值的批处理键', () => {
      const ip = '8.8.8.8';
      const keyWithoutThreat = optimizer.batchProcessor.generateBatchKey(ip, {
        includeThreat: false,
        language: 'en'
      });
      const keyWithThreat = optimizer.batchProcessor.generateBatchKey(ip, {
        includeThreat: true,
        language: 'en'
      });

      expect(keyWithoutThreat).not.toBe(keyWithThreat);
    });

    it('应该正确清理批处理队列', async() => {
      const requestFn = async() => {
        return { test: 'data' };
      };

      // 添加一些请求
      const pendingRequests = [
        optimizer.batchProcessor.addRequest('ip1', requestFn).catch(error => error),
        optimizer.batchProcessor.addRequest('ip2', requestFn).catch(error => error)
      ];

      // 清理队列
      optimizer.batchProcessor.clear();
      await Promise.all(pendingRequests);

      // 验证队列已清空
      const stats = optimizer.batchProcessor.pendingRequests;
      expect(stats.size).toBe(0);
    });
  });

  describe('优化查询', () => {
    it('应该在请求威胁信息时保留威胁检测结果', async() => {
      optimizer.batchProcessor.maxBatchSize = 1;
      optimizer.getOptimizedProviders = () => [];

      const request = createMockRequest('/', {
        headers: {
          'user-agent': 'bot-scan-malicious/1.0',
          'x-forwarded-for': '192.168.1.1, 203.0.113.1',
          via: 'proxy-server'
        }
      });

      const result = await optimizer.getOptimizedGeoInfo(testIPs.suspicious, request, {
        includeThreat: true,
        language: 'en'
      });

      expect(result.threat).toBeDefined();
      expect(result.threat.riskScore).toBeGreaterThan(0);
    });
  });

  describe('性能监控', () => {
    it('应该正确记录性能指标', () => {
      const operationName = 'test_operation';
      const duration = 100;

      optimizer.monitor.record(operationName, duration);

      const stats = optimizer.monitor.getStats();
      expect(stats.metrics).toHaveProperty(operationName);
      expect(stats.metrics[operationName].count).toBe(1);
      expect(stats.metrics[operationName].avgTime).toBe(100);
    });

    it('应该正确计算平均时间', () => {
      const operationName = 'avg_test';

      optimizer.monitor.record(operationName, 100);
      optimizer.monitor.record(operationName, 200);
      optimizer.monitor.record(operationName, 300);

      const stats = optimizer.monitor.getStats();
      expect(stats.metrics[operationName].avgTime).toBe(200);
    });

    it('应该正确清理指标', () => {
      optimizer.monitor.record('test', 100);
      expect(optimizer.monitor.getStats().metrics).toHaveProperty('test');

      optimizer.monitor.clear();
      expect(optimizer.monitor.getStats().metrics).toEqual({});
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

      const compressed = PerformanceOptimizer.DataCompressor.compressGeoData(data);

      expect(compressed.country).toBe('United States of America'); // 应该保留
      expect(compressed.latitude).toBe(40.71277); // 应该保留精度
      expect(compressed.sources).toHaveLength(3); // 应该限制数量
    });

    it('应该正确处理空数据', () => {
      const result1 = PerformanceOptimizer.DataCompressor.compressGeoData(null);
      const result2 = PerformanceOptimizer.DataCompressor.compressGeoData(undefined);
      const result3 = PerformanceOptimizer.DataCompressor.compressGeoData({});

      expect(result1).toBe(null);
      expect(result2).toBe(undefined);
      expect(result3).toEqual({});
    });
  });

  describe('整体性能统计', () => {
    it('应该正确获取性能统计信息', () => {
      const stats = optimizer.getPerformanceStats();

      expect(stats).toHaveProperty('providerPool');
      expect(stats).toHaveProperty('cache');
      expect(stats).toHaveProperty('monitor');
      expect(stats).toHaveProperty('enabled');

      expect(typeof stats.providerPool.size).toBe('number');
      expect(typeof stats.cache.hits).toBe('number');
      expect(typeof stats.monitor.uptime).toBe('number');
    });

    it('应该正确跟踪缓存命中率', () => {
      const cache = optimizer.resultCache;

      // 添加一些缓存项
      cache.set('ip1', {}, { data: '1' });
      cache.set('ip2', {}, { data: '2' });

      // 访问缓存
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
      // 添加一些数据
      optimizer.resultCache.set('test', {}, { data: 'test' });
      optimizer.monitor.record('test', 100);

      // 清理资源
      optimizer.cleanup();

      // 验证资源已清理
      expect(optimizer.resultCache.getStats().size).toBe(0);
      expect(Object.keys(optimizer.monitor.getStats().metrics)).toHaveLength(0);
    });
  });

  describe('错误处理', () => {
    it('应该优雅处理无效输入', () => {
      expect(() => {
        optimizer.monitor.record('', -100);
      }).not.toThrow();

      expect(() => {
        optimizer.resultCache.set(null, null, null);
      }).not.toThrow();
    });

    it('应该优雅处理批处理错误', async() => {
      const errorFn = async() => {
        throw new Error('Test error');
      };

      // 批处理应该处理错误而不崩溃
      await expect(
        optimizer.batchProcessor.addRequest('ip1', errorFn)
      ).rejects.toThrow('Test error');
    }, 5000);
  });

  describe('配置管理', () => {
    it('应该使用正确的默认配置', () => {
      expect(optimizer.resultCache.maxSize).toBe(1000);
      expect(optimizer.resultCache.ttl).toBe(300000);
      expect(optimizer.batchProcessor.maxBatchSize).toBe(10);
      expect(optimizer.batchProcessor.maxWaitTime).toBe(50);
    });

    it('应该允许配置自定义参数', () => {
      const customOptimizer = new PerformanceOptimizer();

      // 验证默认值
      expect(customOptimizer.resultCache.maxSize).toBe(1000);

      customOptimizer.destroy();
    });
  });
});
