import { SECURITY_CONFIG } from "../config/security.js";
import { isFeatureEnabled, getEnvSetting } from "../config/environment.js";

// Simple in-memory rate limiter for Cloudflare Workers compatibility
const rateLimitStore = new Map();

export const rateLimitMiddleware = async (c, next) => {
  // Check if rate limiting is enabled in current environment
  if (!isFeatureEnabled("rateLimit")) {
    await next();
    return;
  }

  const clientIP = getClientIP(c.req);
  const now = Date.now();

  // Use environment-specific rate limit settings
  const envRateLimit = getEnvSetting("rateLimit");
  const windowMs = envRateLimit?.windowMs || SECURITY_CONFIG.rateLimit.windowMs;
  const maxRequests = envRateLimit?.max || SECURITY_CONFIG.rateLimit.max;

  // Clean up old entries
  cleanupOldEntries(now, windowMs);

  // Get or create rate limit data for this IP
  const key = `rateLimit:${clientIP}`;
  const rateLimitData = rateLimitStore.get(key) || {
    requests: [],
    windowStart: now,
  };

  // Remove requests outside the current window
  rateLimitData.requests = rateLimitData.requests.filter(
    (timestamp) => now - timestamp < windowMs,
  );

  // Check if rate limit exceeded
  if (rateLimitData.requests.length >= maxRequests) {
    const oldestRequest = Math.min(...rateLimitData.requests);
    const retryAfter = Math.ceil((oldestRequest + windowMs - now) / 1000);

    // Set rate limit headers
    c.header("X-Rate-Limit-Limit", maxRequests.toString());
    c.header("X-Rate-Limit-Remaining", "0");
    c.header(
      "X-Rate-Limit-Reset",
      Math.ceil((oldestRequest + windowMs) / 1000).toString(),
    );
    c.header("Retry-After", retryAfter.toString());

    return c.json(
      {
        error: "Too Many Requests",
        message: SECURITY_CONFIG.rateLimit.message.message,
        retryAfter: retryAfter,
        timestamp: new Date().toISOString(),
      },
      429,
    );
  }

  // Add current request
  rateLimitData.requests.push(now);
  rateLimitStore.set(key, rateLimitData);

  // Set rate limit headers
  const remaining = Math.max(0, maxRequests - rateLimitData.requests.length);
  c.header("X-Rate-Limit-Limit", maxRequests.toString());
  c.header("X-Rate-Limit-Remaining", remaining.toString());
  c.header("X-Rate-Limit-Reset", Math.ceil((now + windowMs) / 1000).toString());

  await next();
};

function getClientIP(req) {
  // In Cloudflare Workers, the real client IP is in cf-connecting-ip header
  return (
    req.header("cf-connecting-ip") ||
    req.header("cf-connecting-ipv6") ||
    req.header("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.header("x-real-ip") ||
    "127.0.0.1"
  );
}

function cleanupOldEntries(now, windowMs) {
  // Clean up entries older than 2 windows to prevent memory leaks
  const cutoff = now - windowMs * 2;

  for (const [key, data] of rateLimitStore.entries()) {
    if (data.windowStart < cutoff) {
      rateLimitStore.delete(key);
    }
  }
}
