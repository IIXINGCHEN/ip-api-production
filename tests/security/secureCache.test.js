/**
 * 🔒 安全缓存服务测试
 * 测试 TTL/LRU、稳定键生成与统计特性。
 * （旧的 XOR 加密 / DJB2 校验和层已于 2026-06-25 审查移除——对内存缓存无真实威胁模型，属安全 theater。）
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SecureCache } from '../../src/utils/secureCache.js';

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

describe('SecureCache - Security Tests', () => {
  let cache;
  let originalEnv;

  beforeEach(() => {
    originalEnv = process.env.NODE_ENV;
    cache = new SecureCache({
      maxSize: 10,
      defaultTTL: 1000,
      enableCleanup: false // 禁用自动清理以便测试
    });
  });

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
    cache.destroy();
  });

  describe('基础缓存功能', () => {
    it('应该能够设置和获取缓存项', () => {
      const key = 'test-key';
      const value = { data: 'test-value', id: 123 };

      expect(cache.set(key, value)).toBe(true);
      const retrieved = cache.get(key);
      expect(retrieved).toEqual(value);
    });

    it('应该返回null对于不存在的键', () => {
      const result = cache.get('non-existent-key');
      expect(result).toBe(null);
    });

    it('应该正确检查键是否存在', () => {
      const key = 'test-key';
      const value = 'test-value';

      expect(cache.has(key)).toBe(false);
      cache.set(key, value);
      expect(cache.has(key)).toBe(true);
    });

    it('应该能够删除缓存项', () => {
      const key = 'test-key';
      const value = 'test-value';

      cache.set(key, value);
      expect(cache.has(key)).toBe(true);

      expect(cache.delete(key)).toBe(true);
      expect(cache.has(key)).toBe(false);
    });

    it('应该能够清空缓存', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      cache.set('key3', 'value3');

      expect(cache.getStats().size).toBe(3);

      cache.clear();
      expect(cache.getStats().size).toBe(0);
      expect(cache.get('key1')).toBe(null);
    });
  });

  describe('TTL过期测试', () => {
    it('应该在TTL过期后返回null', async() => {
      const key = 'test-key';
      const value = 'test-value';
      const shortTTL = 50; // 50ms

      cache.set(key, value, shortTTL);
      expect(cache.get(key)).toBe(value);

      await delay(shortTTL + 10);

      const result = cache.get(key);
      expect(result).toBe(null);
      expect(cache.has(key)).toBe(false);
    });

    it('应该正确处理has()方法的TTL检查', async() => {
      const key = 'test-key';
      const shortTTL = 50;

      cache.set(key, 'value', shortTTL);
      expect(cache.has(key)).toBe(true);

      await delay(shortTTL + 10);

      expect(cache.has(key)).toBe(false);
    });
  });

  describe('LRU淘汰测试', () => {
    it('应该在达到最大容量时保持大小限制', () => {
      const maxSize = 5;
      const smallCache = new SecureCache({ maxSize, enableCleanup: false });

      // 填满缓存
      for (let i = 0; i < maxSize; i++) {
        smallCache.set(`key${i}`, `value${i}`);
      }

      expect(smallCache.getStats().size).toBe(maxSize);

      // 添加多个新项
      for (let i = 0; i < 3; i++) {
        smallCache.set(`new-key${i}`, `new-value${i}`);
      }

      // 缓存大小不应该超过最大值太多
      const finalSize = smallCache.getStats().size;
      expect(finalSize).toBeLessThanOrEqual(maxSize + 1); // 允许1个误差

      // 验证最新添加的项存在
      expect(smallCache.get('new-key2')).toBe('new-value2');

      smallCache.destroy();
    });

    it('应该更新访问时间', async() => {
      cache.set('key1', 'value1');

      // 添加小延迟确保不同的创建时间
      await new Promise(resolve => setTimeout(resolve, 10));

      cache.set('key2', 'value2');

      // 访问key1使其成为最新
      cache.get('key1');

      // 添加新项导致淘汰
      for (let i = 3; i <= 12; i++) { // 超过maxSize
        cache.set(`key${i}`, `value${i}`);
      }

      // key1和key2都被淘汰了（正确的LRU行为）
      expect(cache.get('key1')).toBe(null);
      expect(cache.get('key2')).toBe(null);

      // 验证新添加的项存在
      expect(cache.get('key12')).toBe('value12'); // 最新的项应该存在
    });
  });

  describe('安全密钥生成测试', () => {
    it('应该生成一致的安全键', () => {
      const key = 'test-key';
      const secureKey1 = cache.generateSecureKey(key);
      const secureKey2 = cache.generateSecureKey(key);

      expect(secureKey1).toBe(secureKey2);
      expect(secureKey1).not.toBe(key); // 不应该与原始键相同
      expect(secureKey1.length).toBe(16); // 双 FNV-1a hex 固定 16 字符
    });

    it('共享长前缀的键不应碰撞（includeThreat true/false）', () => {
      // 回归：旧实现 btoa(key).substring(0,32) 仅由前 ~24 字节决定，
      // 导致 geo:8.8.8.8:...includeThreat=true / false 碰撞，返回错误缓存。
      const k1 = cache.generateSecureKey('geo:8.8.8.8:format=json&includeThreat=false&lang=en');
      const k2 = cache.generateSecureKey('geo:8.8.8.8:format=json&includeThreat=true&lang=en');
      expect(k1).not.toBe(k2);
    });

    it('应该为不同键生成不同的安全键', () => {
      const key1 = 'key1';
      const key2 = 'key2';

      const secureKey1 = cache.generateSecureKey(key1);
      const secureKey2 = cache.generateSecureKey(key2);

      expect(secureKey1).not.toBe(secureKey2);
    });

    it('应该使用盐值增强安全性', () => {
      const key = 'test-key';
      const secureKey1 = cache.generateSecureKey(key);
      const secureKey2 = cache.generateSecureKey(key, 'different-salt');

      expect(secureKey1).not.toBe(secureKey2);
    });
  });

  describe('统计信息测试', () => {
    it('应该跟踪正确的统计信息', () => {
      // 初始统计
      let stats = cache.getStats();
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
      expect(stats.sets).toBe(0);
      expect(stats.deletes).toBe(0);
      expect(stats.evictions).toBe(0);
      expect(stats.size).toBe(0);

      // 设置数据
      cache.set('key1', 'value1');
      stats = cache.getStats();
      expect(stats.sets).toBe(1);
      expect(stats.size).toBe(1);

      // 命中
      cache.get('key1');
      stats = cache.getStats();
      expect(stats.hits).toBe(1);

      // 未命中
      cache.get('non-existent');
      stats = cache.getStats();
      expect(stats.misses).toBe(1);

      // 删除
      cache.delete('key1');
      stats = cache.getStats();
      expect(stats.deletes).toBe(1);
      expect(stats.size).toBe(0);
    });

    it('应该计算正确的命中率', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');

      // 命中2次，未命中1次
      cache.get('key1');
      cache.get('key2');
      cache.get('non-existent');

      const stats = cache.getStats();
      expect(stats.hits).toBe(2);
      expect(stats.misses).toBe(1);
      expect(stats.hitRate).toBe('66.67%'); // 2/3 = 66.67%
    });
  });

  describe('清理功能测试', () => {
    it('应该清理过期项', async() => {
      const shortTTL = 50;
      const longTTL = 5000;

      cache.set('expire-soon', 'value1', shortTTL);
      cache.set('expire-later', 'value2', longTTL);

      await delay(shortTTL + 10);

      const cleanedCount = cache.cleanup();
      expect(cleanedCount).toBe(1);
      expect(cache.get('expire-soon')).toBe(null);
      expect(cache.get('expire-later')).toBe('value2');
    });

    it('应该启动和停止定期清理', () => {
      const cleanupCache = new SecureCache({
        cleanupInterval: 50,
        enableCleanup: true
      });

      expect(cleanupCache.cleanupTimer).toBeDefined();

      cleanupCache.stopCleanup();
      expect(cleanupCache.cleanupTimer).toBeNull();

      cleanupCache.destroy();
    });
  });

  describe('错误处理测试', () => {
    it('应该优雅处理无效输入', () => {
      expect(cache.set(null, 'value')).toBe(false);
      expect(cache.set(undefined, 'value')).toBe(false);
      expect(cache.get(null)).toBe(null);
      expect(cache.get(undefined)).toBe(null);
      expect(cache.delete(null)).toBe(false);
      expect(cache.delete(undefined)).toBe(false);
    });
  });

  describe('内存泄漏防护测试', () => {
    it('应该在销毁时清理所有资源', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');

      expect(cache.getStats().size).toBe(2);

      cache.destroy();

      expect(cache.getStats().size).toBe(0);
      expect(cache.cleanupTimer).toBeNull();
    });

    it('应该限制缓存大小防止内存溢出', () => {
      const smallCache = new SecureCache({
        maxSize: 3,
        enableCleanup: false
      });

      // 添加超过最大容量的项
      for (let i = 0; i < 10; i++) {
        smallCache.set(`key${i}`, `value${i}`);
      }

      // 缓存大小不应该超过最大值
      expect(smallCache.getStats().size).toBe(3);

      smallCache.destroy();
    });
  });
});
