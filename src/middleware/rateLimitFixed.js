/**
 * 🔒 改进的速率限制中间件
 * 使用内存Map + LRU策略，适用于Cloudflare Workers
 */

import { SECURITY_CONFIG } from '../config/security.js';
import { ERROR_TYPES } from '../utils/errorHandler.js';
import { buildError } from '../utils/responseBuilder.js';
import { generateRequestId } from '../utils/response.js';

// 全局速率限制存储
const rateLimitStore = new Map();
const MAX_ENTRIES = 10000;
const CLEANUP_THRESHOLD = 0.9; // 90%时触发清理

/**
 * 速率限制数据结构
 */
class RateLimitEntry {
  constructor() {
    this.requests = [];
    this.firstRequest = Date.now();
    this.lastRequest = Date.now();
  }

  addRequest(timestamp) {
    this.requests.push(timestamp);
    this.lastRequest = timestamp;
  }

  cleanExpired(windowStart) {
    this.requests = this.requests.filter(time => time > windowStart);
    return this.requests.length;
  }

  getCount() {
    return this.requests.length;
  }
}

/**
 * LRU清理策略
 */
function performLRUCleanup() {
  if (rateLimitStore.size < MAX_ENTRIES * CLEANUP_THRESHOLD) {
    return;
  }

  const entries = Array.from(rateLimitStore.entries())
    .sort((a, b) => a[1].lastRequest - b[1].lastRequest);

  const toDelete = Math.floor(MAX_ENTRIES * 0.1); // 删除10%最旧的
  for (let i = 0; i < toDelete && i < entries.length; i++) {
    rateLimitStore.delete(entries[i][0]);
  }

  console.log(`🧹 Rate limit cleanup: removed ${toDelete} entries, current size: ${rateLimitStore.size}`);
}

/**
 * 判断请求路径是否在跳过列表中。
 * 匹配规则：精确匹配 || 前缀匹配（仅当列表项以 / 结尾时）。
 * 这样避免 prefix 误匹配（如 '/health' 不会匹配 '/healthadmin'）。
 */
function shouldSkipRateLimit(path, skipList) {
  if (!skipList || skipList.length === 0) {
    return false;
  }
  for (const entry of skipList) {
    if (entry.endsWith('/')) {
      // 单独的 '/' 没有有意义的"前缀"，等同于精确匹配根路径。
      // 任何 path 都 startsWith('/')，所以必须显式排除长度为 1 的情况。
      if (entry === '/') {
        if (path === '/') return true;
        continue;
      }
      if (path === entry.slice(0, -1) || path.startsWith(entry)) {
        return true;
      }
    } else if (path === entry) {
      return true;
    }
  }
  return false;
}

/**
 * 创建速率限制中间件
 */
export function createRateLimitMiddleware(options = {}) {
  const {
    windowMs = SECURITY_CONFIG.rateLimit.windowMs,
    max = SECURITY_CONFIG.rateLimit.max,
    skipSuccessfulRequests = false,
    skipFailedRequests = false,
    // 跳过速率限制的端点列表（精确或前缀匹配，末尾加 / 视为前缀）。
    // 必须显式传入；空数组表示不跳过任何端点。
    skipEndpoints = []
  } = options;

  return async(c, next) => {
    const path = c.req.path;

    // 公共端点（如 /health、/metrics）放行，不计入限流计数器，
    // 避免健康检查或监控抓取打爆限流阈值。
    if (shouldSkipRateLimit(path, skipEndpoints)) {
      await next();
      return;
    }

    // 限流键用平台可信 IP：未识别入口回退 'unknown'（单一紧限流桶），避免伪造 XFF 绕过限流
    const clientIP = c.get('trustedClientIP') || 'unknown';
    const now = Date.now();
    const windowStart = now - windowMs;

    // 获取或创建客户端记录
    let entry = rateLimitStore.get(clientIP);
    if (!entry) {
      entry = new RateLimitEntry();
      rateLimitStore.set(clientIP, entry);
    }

    // 清理过期请求
    const currentCount = entry.cleanExpired(windowStart);

    // 检查是否超过限制
    if (currentCount >= max) {
      const oldestRequest = entry.requests[0];
      const retryAfter = Math.ceil((oldestRequest + windowMs - now) / 1000);

      // 设置速率限制头
      c.header('Retry-After', retryAfter.toString());
      c.header('X-RateLimit-Limit', max.toString());
      c.header('X-RateLimit-Remaining', '0');
      c.header('X-RateLimit-Reset', Math.ceil((oldestRequest + windowMs) / 1000).toString());

      return c.json(
        buildError(
          ERROR_TYPES.TOO_MANY_REQUESTS.code,
          'Too many requests. Please try again later.',
          { limit: max, windowSeconds: windowMs / 1000, retryAfter },
          { ctx: { requestId: c.get('requestId') || generateRequestId() } }
        ),
        { status: 429 }
      );
    }

    // 记录当前请求
    entry.addRequest(now);

    // 设置速率限制头
    c.header('X-RateLimit-Limit', max.toString());
    c.header('X-RateLimit-Remaining', (max - entry.getCount()).toString());
    c.header('X-RateLimit-Reset', Math.ceil((now + windowMs) / 1000).toString());

    // 执行请求
    await next();

    // 根据响应状态决定是否计数
    const status = c.res.status;
    if ((skipSuccessfulRequests && status < 400) || (skipFailedRequests && status >= 400)) {
      // 移除刚才添加的请求
      entry.requests.pop();
    }

    // 定期执行LRU清理
    if (Math.random() < 0.01) { // 1%概率触发清理检查
      performLRUCleanup();
    }
  };
}

/**
 * 重置特定IP的速率限制
 */
export function resetRateLimit(clientIP) {
  const existed = rateLimitStore.has(clientIP);
  rateLimitStore.delete(clientIP);
  return existed;
}

export default {
  createRateLimitMiddleware,
  resetRateLimit
};
