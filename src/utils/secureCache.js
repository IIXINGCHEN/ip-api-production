/**
 * 🔒 安全缓存管理器
 *
 * 提供 TTL/LRU 缓存与碰撞无关的稳定键生成。
 *
 * 安全说明（2026-06-25 审查）：旧的 encrypt/decrypt（XOR + 把部分密钥存进缓存条目）
 * 与 calculateChecksum（弱 DJB2）是「安全 theater」——对 isolate 内的内存缓存无真实
 * 威胁模型，假加密反而泄露部分密钥、假校验和静默吞掉损坏当未命中。已整体移除。
 * 真正需要保密/防篡改时应使用 WebCrypto（AES-GCM / HMAC），密钥不入缓存条目。
 */

import { ENVIRONMENT } from '../config/environment.js';

class SecureCache {
  constructor(options = {}) {
    this.maxSize = options.maxSize || 10000;
    this.defaultTTL = options.defaultTTL || 300000; // 5分钟
    this.cache = new Map();
    this.cleanupInterval = options.cleanupInterval || 60000; // 1分钟
    this.cleanupTimer = null;
    this.stats = {
      hits: 0,
      misses: 0,
      sets: 0,
      deletes: 0,
      evictions: 0
    };

    // 启动定期清理
    if (options.enableCleanup !== false) {
      this.startCleanup();
    }
  }

  /**
   * 生成稳定的缓存键
   *
   * 双 FNV-1a 哈希覆盖完整输入（key + salt），输出 16 位 hex。
   * 旧实现 btoa(...).substring(0,32) 仅由输入前 ~24 字节决定，导致共享长前缀的
   * 键（如同一 IP 的 includeThreat=true / false）碰撞，返回错误缓存项。
   */
  generateSecureKey(key, salt = 'ip-api-cache-salt') {
    const input = String(key) + salt;
    let h1 = 0x811c9dc5;
    let h2 = 0x84222325;
    for (let i = 0; i < input.length; i++) {
      const c = input.charCodeAt(i);
      h1 = Math.imul(h1 ^ c, 0x01000193);
      h2 = Math.imul(h2 ^ c, 0x05031813);
    }
    return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0');
  }

  isValidKey(key) {
    return key !== null && key !== undefined;
  }

  /**
   * 设置缓存项
   */
  set(key, value, ttl = this.defaultTTL) {
    if (!this.isValidKey(key)) {
      return false;
    }

    try {
      const secureKey = this.generateSecureKey(key);
      const isUpdate = this.cache.has(secureKey);

      // 如果不是更新，且缓存已满，淘汰最旧的项
      if (!isUpdate && this.cache.size >= this.maxSize) {
        this.evictOldest();
      }

      const cacheEntry = {
        data: value,
        timestamp: Date.now(),
        ttl,
        accessCount: 0,
        lastAccessed: Date.now()
      };

      this.cache.set(secureKey, cacheEntry);
      this.stats.sets++;

      return true;
    } catch (error) {
      // 缓存设置失败
      return false;
    }
  }

  /**
   * 获取缓存项
   */
  get(key) {
    if (!this.isValidKey(key)) {
      this.stats.misses++;
      return null;
    }

    try {
      const secureKey = this.generateSecureKey(key);
      const entry = this.cache.get(secureKey);

      if (!entry) {
        this.stats.misses++;
        return null;
      }

      // 检查TTL
      if (Date.now() - entry.timestamp > entry.ttl) {
        this.cache.delete(secureKey);
        this.stats.deletes++;
        this.stats.misses++;
        return null;
      }

      // 更新访问统计
      entry.accessCount++;
      entry.lastAccessed = Date.now();
      this.stats.hits++;

      return entry.data;
    } catch (error) {
      this.stats.misses++;
      return null;
    }
  }

  /**
   * 删除缓存项
   */
  delete(key) {
    if (!this.isValidKey(key)) {
      return false;
    }

    const secureKey = this.generateSecureKey(key);
    const deleted = this.cache.delete(secureKey);
    if (deleted) {
      this.stats.deletes++;
    }
    return deleted;
  }

  /**
   * 检查缓存项是否存在
   */
  has(key) {
    if (!this.isValidKey(key)) {
      return false;
    }

    const secureKey = this.generateSecureKey(key);
    const entry = this.cache.get(secureKey);

    if (!entry) {
      return false;
    }

    // 检查TTL
    if (Date.now() - entry.timestamp > entry.ttl) {
      this.cache.delete(secureKey);
      return false;
    }

    return true;
  }

  /**
   * 清空缓存
   */
  clear() {
    const size = this.cache.size;
    this.cache.clear();
    this.stats.deletes += size;
  }

  /**
   * 淘汰最旧的缓存项
   */
  evictOldest() {
    let oldestKey = null;
    let oldestTime = Infinity;

    for (const [key, entry] of this.cache.entries()) {
      if (entry.lastAccessed < oldestTime) {
        oldestTime = entry.lastAccessed;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.cache.delete(oldestKey);
      this.stats.evictions++;
    }
  }

  /**
   * 清理过期项
   */
  cleanup() {
    const now = Date.now();
    const keysToDelete = [];

    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp > entry.ttl) {
        keysToDelete.push(key);
      }
    }

    keysToDelete.forEach(key => {
      this.cache.delete(key);
      this.stats.deletes++;
    });

    return keysToDelete.length;
  }

  /**
   * 启动定期清理（仅在有可靠定时器的 Node 运行时有效；Workers 靠 get/has 的懒过期）
   */
  startCleanup() {
    if (typeof setInterval !== 'undefined') {
      this.cleanupTimer = setInterval(() => {
        this.cleanup();
      }, this.cleanupInterval);
    }
  }

  /**
   * 停止定期清理
   */
  stopCleanup() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  /**
   * 获取缓存统计
   */
  getStats() {
    const hitRate = this.stats.hits + this.stats.misses > 0
      ? (this.stats.hits / (this.stats.hits + this.stats.misses) * 100).toFixed(2)
      : '0.00';

    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      hitRate: `${hitRate}%`,
      hits: this.stats.hits,
      misses: this.stats.misses,
      sets: this.stats.sets,
      deletes: this.stats.deletes,
      evictions: this.stats.evictions
    };
  }

  /**
   * 获取详细的缓存信息（仅非生产，用于调试）
   */
  getDetailedInfo() {
    if (ENVIRONMENT.isProduction()) {
      return { error: 'Detailed cache info not available in production' };
    }

    const entries = [];
    for (const [key, entry] of this.cache.entries()) {
      entries.push({
        key: key.substring(0, 20) + '...',
        age: Date.now() - entry.timestamp,
        ttl: entry.ttl,
        accessCount: entry.accessCount,
        lastAccessed: Date.now() - entry.lastAccessed
      });
    }

    return {
      stats: this.getStats(),
      entries: entries.sort((a, b) => b.lastAccessed - a.lastAccessed)
    };
  }

  /**
   * 销毁缓存实例
   */
  destroy() {
    this.stopCleanup();
    this.clear();
  }
}

// 创建全局缓存实例 - 延迟初始化以避免Cloudflare Workers全局作用域问题
let geoCache = null;
let rateLimitCache = null;

function getGeoCache() {
  if (!geoCache) {
    geoCache = new SecureCache({
      maxSize: 10000,
      defaultTTL: 300000, // 5分钟
      enableCleanup: true
    });
  }
  return geoCache;
}

function getRateLimitCache() {
  if (!rateLimitCache) {
    rateLimitCache = new SecureCache({
      maxSize: 5000,
      defaultTTL: 900000, // 15分钟
      enableCleanup: true
    });
  }
  return rateLimitCache;
}

export { SecureCache, getGeoCache, getRateLimitCache };
