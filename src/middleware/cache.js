import { CACHE_CONFIG } from "../config/security.js";
import { isFeatureEnabled, getEnvSetting } from "../config/environment.js";

// Enhanced cache system with production-ready storage
// Supports both in-memory cache and external storage (Cloudflare KV, Redis)
class CacheStorage {
  constructor() {
    this.memoryCache = new Map();
    this.kvStorage = null;
    this.redisClient = null;

    // Initialize external storage if available
    this.initializeExternalStorage();
  }

  async initializeExternalStorage() {
    // Check for Cloudflare KV storage
    if (typeof globalThis.CACHE_KV !== 'undefined') {
      this.kvStorage = globalThis.CACHE_KV;
    }

    // Check for Redis connection (if available)
    if (typeof globalThis.REDIS_URL !== 'undefined') {
      try {
        // Redis client would be initialized here in a real implementation
        // this.redisClient = new Redis(globalThis.REDIS_URL);
      } catch (_error) {
        // Redis connection failed, falling back to memory cache
      }
    }
  }

  async get(key) {
    // Try external storage first (KV or Redis)
    if (this.kvStorage) {
      try {
        const value = await this.kvStorage.get(key, 'json');
        if (value && !this.isExpired(value)) {
          return value;
        }
      } catch (_error) {
        // KV storage read failed, silently fallback
      }
    }

    if (this.redisClient) {
      try {
        const value = await this.redisClient.get(key);
        if (value) {
          const parsed = JSON.parse(value);
          if (!this.isExpired(parsed)) {
            return parsed;
          }
        }
      } catch (_error) {
        // Redis read failed, silently fallback
      }
    }

    // Fallback to memory cache
    const memoryValue = this.memoryCache.get(key);
    if (memoryValue && !this.isExpired(memoryValue)) {
      return memoryValue;
    }

    return null;
  }

  async set(key, value, ttlSeconds) {
    const cacheEntry = {
      ...value,
      expiresAt: Date.now() + ttlSeconds * 1000,
      createdAt: Date.now()
    };

    // Store in external storage
    if (this.kvStorage) {
      try {
        await this.kvStorage.put(key, JSON.stringify(cacheEntry), {
          expirationTtl: ttlSeconds
        });
      } catch (_error) {
        // KV storage write failed, silently continue
      }
    }

    if (this.redisClient) {
      try {
        await this.redisClient.setex(key, ttlSeconds, JSON.stringify(cacheEntry));
      } catch (_error) {
        // Redis write failed, silently continue
      }
    }

    // Always store in memory cache as fallback
    this.memoryCache.set(key, cacheEntry);
  }

  async delete(key) {
    if (this.kvStorage) {
      try {
        await this.kvStorage.delete(key);
      } catch (_error) {
        // KV storage delete failed, silently continue
      }
    }

    if (this.redisClient) {
      try {
        await this.redisClient.del(key);
      } catch (_error) {
        // Redis delete failed, silently continue
      }
    }

    this.memoryCache.delete(key);
  }

  clear() {
    this.memoryCache.clear();
    // Note: External storage clearing would need specific implementation
  }

  isExpired(cacheEntry) {
    return Date.now() > cacheEntry.expiresAt;
  }

  getStats() {
    let totalEntries = 0;
    let expiredEntries = 0;

    for (const cached of this.memoryCache.values()) {
      totalEntries++;
      if (this.isExpired(cached)) {
        expiredEntries++;
      }
    }

    return {
      totalEntries,
      expiredEntries,
      activeEntries: totalEntries - expiredEntries,
      memoryUsage: this.memoryCache.size,
      hasKVStorage: !!this.kvStorage,
      hasRedis: !!this.redisClient
    };
  }
}

const cache = new CacheStorage();

export const cacheMiddleware = async (c, next) => {
  // Check if caching is enabled in current environment
  if (!isFeatureEnabled("cache")) {
    await next();
    return;
  }

  const method = c.req.method;
  const path = c.req.path;
  const clientIP = c.get("clientIP");

  // Cleanup expired entries periodically (for memory cache)
  await cleanupExpiredEntries();

  // Only cache GET requests
  if (method !== "GET") {
    await next();
    return;
  }

  // Generate cache key
  const cacheKey = generateCacheKey(path, clientIP);

  // Try to get from cache (now async)
  const cached = await cache.get(cacheKey);
  if (cached) {
    c.header("X-Cache-Status", "HIT");
    c.header(
      "X-Cache-TTL",
      Math.ceil((cached.expiresAt - Date.now()) / 1000).toString(),
    );

    // Return cached response
    return c.json(cached.data, cached.status);
  }

  // Cache miss - continue with request
  c.header("X-Cache-Status", "MISS");

  // Store original json method
  const originalJson = c.json.bind(c);

  // Override json method to cache the response
  c.json = async (data, status = 200) => {
    // Cache successful responses
    if (status >= 200 && status < 300) {
      const ttl = getCacheTTL(path);
      if (ttl > 0) {
        try {
          await cache.set(cacheKey, {
            data,
            status
          }, ttl);
        } catch (_error) {
          // Cache write failed, silently continue
        }
      }
    }

    return originalJson(data, status);
  };

  await next();
};

function generateCacheKey(path, clientIP) {
  // For IP-specific endpoints, include IP in cache key
  if (path === "/" || path === "/geo") {
    return `${path}:${clientIP}`;
  }

  // For other endpoints, use path only
  return path;
}

function getCacheTTL(path) {
  // Use environment-specific TTL values
  const envTTL = getEnvSetting("cache.ttl");

  if (path === "/") {
    return envTTL?.ip || CACHE_CONFIG.ttl.ip;
  } else if (path === "/geo") {
    return envTTL?.geo || CACHE_CONFIG.ttl.geo;
  } else if (path.includes("threat")) {
    return envTTL?.threat || CACHE_CONFIG.ttl.threat;
  }

  return 0; // No caching by default
}

function _isCacheExpired(cached) {
  return Date.now() > cached.expiresAt;
}

// Cleanup expired cache entries on demand
// Note: setInterval is not allowed in Cloudflare Workers global scope
async function cleanupExpiredEntries() {
  // Only cleanup memory cache here, external storage handles its own expiration
  const memoryCache = cache.memoryCache;
  for (const [key, cached] of memoryCache.entries()) {
    if (cache.isExpired(cached)) {
      memoryCache.delete(key);
    }
  }
}

export const clearCache = async (pattern) => {
  if (pattern) {
    // Clear from memory cache
    for (const key of cache.memoryCache.keys()) {
      if (key.includes(pattern)) {
        await cache.delete(key);
      }
    }
  } else {
    cache.clear();
  }
};

export const getCacheStats = () => {
  return cache.getStats();
};
