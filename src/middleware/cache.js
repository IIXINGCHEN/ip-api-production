import { CACHE_CONFIG } from "../config/security.js";
import { isFeatureEnabled, getEnvSetting } from "../config/environment.js";

// Simple in-memory cache
// In production, you might want to use Redis or Cloudflare KV
const cache = new Map();

export const cacheMiddleware = async (c, next) => {
  // Check if caching is enabled in current environment
  if (!isFeatureEnabled("cache")) {
    await next();
    return;
  }

  const method = c.req.method;
  const path = c.req.path;
  const clientIP = c.get("clientIP");

  // Cleanup expired entries on each request (since we can't use setInterval)
  cleanupExpiredEntries();

  // Only cache GET requests
  if (method !== "GET") {
    await next();
    return;
  }

  // Generate cache key
  const cacheKey = generateCacheKey(path, clientIP);

  // Try to get from cache
  const cached = cache.get(cacheKey);
  if (cached && !isCacheExpired(cached)) {
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
  c.json = (data, status = 200) => {
    // Cache successful responses
    if (status >= 200 && status < 300) {
      const ttl = getCacheTTL(path);
      if (ttl > 0) {
        cache.set(cacheKey, {
          data,
          status,
          expiresAt: Date.now() + ttl * 1000,
          createdAt: Date.now(),
        });
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

function isCacheExpired(cached) {
  return Date.now() > cached.expiresAt;
}

// Cleanup expired cache entries on demand
// Note: setInterval is not allowed in Cloudflare Workers global scope
function cleanupExpiredEntries() {
  for (const [key, cached] of cache.entries()) {
    if (isCacheExpired(cached)) {
      cache.delete(key);
    }
  }
}

export const clearCache = (pattern) => {
  if (pattern) {
    for (const key of cache.keys()) {
      if (key.includes(pattern)) {
        cache.delete(key);
      }
    }
  } else {
    cache.clear();
  }
};

export const getCacheStats = () => {
  let totalEntries = 0;
  let expiredEntries = 0;

  for (const cached of cache.values()) {
    totalEntries++;
    if (isCacheExpired(cached)) {
      expiredEntries++;
    }
  }

  return {
    totalEntries,
    expiredEntries,
    activeEntries: totalEntries - expiredEntries,
    memoryUsage: cache.size,
  };
};
