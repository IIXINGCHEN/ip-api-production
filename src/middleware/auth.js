/**
 * 🔒 身份验证中间件
 * 实施API密钥验证和安全控制
 */

import { ERROR_TYPES } from '../utils/errorHandler.js';
import { SECURITY_CONFIG } from '../config/security.js';
import { secureCompare, generateRequestId } from '../utils/response.js';
import { buildError } from '../utils/responseBuilder.js';

// 失败尝试记录的硬上限：防止伪造 IP 暴力破解撑爆 attempts Map
const MAX_AUTH_ENTRIES = 10000;
// 惰性清理计数器：每 N 个请求触发一次过期清理（Workers 无后台定时器）
let authCleanupCounter = 0;
const AUTH_CLEANUP_INTERVAL = 100;

/**
 * API密钥验证器
 */
class APIKeyValidator {
  constructor() {
    this.validKeys = new Set();
    this.attempts = new Map(); // 记录失败尝试
    this.lockouts = new Map(); // 记录锁定的IP
    this.initializeKeys();
  }

  /**
   * 初始化有效的API密钥
   */
  initializeKeys() {
    this.validKeys = this.getValidKeys();

    console.log(`🔒 Initialized with ${this.validKeys.size} valid API keys`);
  }

  getValidKeys(env = {}) {
    const keys = new Set();
    const adminKey = getRuntimeValue(env, 'API_KEY_ADMIN');
    const userKey = getRuntimeValue(env, 'API_KEY_USER');

    if (adminKey) keys.add(adminKey);
    if (userKey) keys.add(userKey);

    return keys;
  }

  /**
   * 验证API密钥
   */
  validateKey(apiKey, clientIP, env = {}) {
    if (!apiKey) {
      return { valid: false, reason: 'missing_key' };
    }

    // 检查IP是否被锁定（透出 expiresAt 供中间件设置 Retry-After 头）
    const lockout = this.lockouts.get(clientIP);
    if (lockout && Date.now() <= lockout.expiresAt) {
      return { valid: false, reason: 'ip_locked', expiresAt: lockout.expiresAt };
    }
    if (lockout) {
      this.lockouts.delete(clientIP); // 锁已过期，清理
    }

    // 检查密钥是否有效（常量时间：遍历全部有效键逐一 secureCompare，不提前短路，
    // 使时序与命中位置/键内容无关。管理员路径同样使用 secureCompare。）
    const validKeys = this.getValidKeys(env);
    let isValid = false;
    for (const candidate of validKeys) {
      if (secureCompare(apiKey, candidate)) {
        isValid = true;
      }
    }

    if (!isValid) {
      this.recordFailedAttempt(clientIP);
      return { valid: false, reason: 'invalid_key' };
    }

    // 清除失败记录（成功登录）
    this.clearFailedAttempts(clientIP);
    return { valid: true };
  }

  /**
   * 检查IP是否被锁定
   */
  isIPLocked(clientIP) {
    const lockout = this.lockouts.get(clientIP);
    if (!lockout) return false;

    // 检查锁定是否过期
    if (Date.now() > lockout.expiresAt) {
      this.lockouts.delete(clientIP);
      return false;
    }

    return true;
  }

  /**
   * 记录失败尝试
   */
  recordFailedAttempt(clientIP) {
    // 硬上限：达到上限时淘汰最旧条目，防止 attempts Map 无界增长（伪造 IP 场景）
    if (this.attempts.size >= MAX_AUTH_ENTRIES) {
      this.evictOldestAttempt();
    }
    const attempts = this.attempts.get(clientIP) || { count: 0, firstAttempt: Date.now() };
    attempts.count++;
    attempts.lastAttempt = Date.now();
    this.attempts.set(clientIP, attempts);

    // 检查是否需要锁定
    if (attempts.count >= SECURITY_CONFIG.apiKey.maxFailedAttempts) {
      const lockoutDuration = SECURITY_CONFIG.apiKey.lockoutDuration;
      this.lockouts.set(clientIP, {
        reason: 'too_many_failed_attempts',
        attempts: attempts.count,
        expiresAt: Date.now() + lockoutDuration
      });

      console.warn(`🔒 IP ${clientIP} locked due to ${attempts.count} failed attempts`);
    }
  }

  /**
   * 清除失败记录
   */
  clearFailedAttempts(clientIP) {
    this.attempts.delete(clientIP);
    this.lockouts.delete(clientIP);
  }

  /**
   * 淘汰最旧的失败尝试记录（firstAttempt 最小者）
   */
  evictOldestAttempt() {
    let oldestIP = null;
    let oldestTime = Infinity;
    for (const [ip, attempt] of this.attempts.entries()) {
      if (attempt.firstAttempt < oldestTime) {
        oldestTime = attempt.firstAttempt;
        oldestIP = ip;
      }
    }
    if (oldestIP) {
      this.attempts.delete(oldestIP);
    }
  }

  /**
   * 获取安全统计信息
   */
  getSecurityStats() {
    return {
      validKeysCount: this.getValidKeys().size,
      failedAttempts: this.attempts.size,
      lockedIPs: this.lockouts.size,
      lockedIPsList: Array.from(this.lockouts.keys())
    };
  }
}

// 全局验证器实例
const apiKeyValidator = new APIKeyValidator();

function getRuntimeValue(env, name) {
  return env?.[name] ||
    globalThis?.[name] ||
    (typeof process !== 'undefined' ? process.env?.[name] : undefined) ||
    null;
}

/**
 * 身份验证中间件工厂
 */
export function createAuthMiddleware(options = {}) {
  const {
    requireAuth = true,
    headerName = SECURITY_CONFIG.apiKey.header,
    publicEndpoints = ['/health', '/', '/docs']
  } = options;

  return async(c, next) => {
    const path = c.req.path;
    const method = c.req.method;
    const clientIP = c.get('trustedClientIP') || 'unknown';

    // 惰性清理过期的锁定/尝试记录（Workers 无后台定时器；每 N 个请求触发一次）
    if (++authCleanupCounter >= AUTH_CLEANUP_INTERVAL) {
      authCleanupCounter = 0;
      try { cleanupAuthData(); } catch { /* 清理失败不影响请求处理 */ }
    }

    // 检查是否为公开端点
    const isPublicEndpoint = publicEndpoints.some(endpoint => {
      if (endpoint === path) return true;
      if (endpoint.endsWith('*') && path.startsWith(endpoint.slice(0, -1))) return true;
      return false;
    });

    // 公开端点的OPTIONS请求总是允许（CORS预检）
    if (isPublicEndpoint && method === 'OPTIONS') {
      await next();
      return;
    }

    // 如果不需要身份验证或者是公开端点，直接通过
    if (!requireAuth || isPublicEndpoint) {
      await next();
      return;
    }

    // 获取API密钥
    const apiKey = c.req.header(headerName);

    // 验证API密钥
    const validation = apiKeyValidator.validateKey(apiKey, clientIP, c.env);

    if (!validation.valid) {
      // 记录安全事件
      console.warn(`🚨 Authentication failed for ${clientIP}: ${validation.reason}`);

      // 返回适当的错误响应（统一 RESTful 信封）
      const code = validation.reason === 'ip_locked'
        ? ERROR_TYPES.TOO_MANY_REQUESTS.code
        : ERROR_TYPES.UNAUTHORIZED.code;
      let statusCode = 401;
      let message = 'Authentication required';

      if (validation.reason === 'ip_locked') {
        statusCode = 429;
        message = 'Too many failed attempts. Please try again later.';
      } else if (validation.reason === 'missing_key') {
        message = 'API key is required';
      } else if (validation.reason === 'invalid_key') {
        message = 'Invalid API key';
      }

      const requestId = c.get('requestId') || generateRequestId();
      const startTime = c.get('startTime');
      // ip_locked 时设置 Retry-After，与速率限制中间件保持一致（RFC 6585 §4 对 429 的预期头）
      if (validation.reason === 'ip_locked' && validation.expiresAt) {
        const retryAfter = Math.max(1, Math.ceil((validation.expiresAt - Date.now()) / 1000));
        c.header('Retry-After', retryAfter.toString());
      }
      return c.json(
        buildError(code, message, { reason: validation.reason }, { ctx: { requestId }, startTime }),
        { status: statusCode }
      );
    }

    // 将API密钥信息添加到上下文
    c.set('authenticated', true);
    c.set('apiKey', apiKey);
    c.set('authTimestamp', Date.now());

    await next();
  };
}

/**
 * 管理员身份验证中间件（更严格的验证）
 */
export function createAdminAuthMiddleware() {
  return async(c, next) => {
    const apiKey = c.req.header(SECURITY_CONFIG.apiKey.header);
    const clientIP = c.get('trustedClientIP') || 'unknown';

    // 验证管理员密钥
    const adminKey = getRuntimeValue(c.env, 'API_KEY_ADMIN');
    if (!apiKey || !secureCompare(apiKey, adminKey)) {
      console.warn(`🚨 Admin access denied for ${clientIP}`);
      return c.json(
        buildError(
          ERROR_TYPES.FORBIDDEN.code,
          'Administrator access required',
          null,
          { ctx: { requestId: c.get('requestId') || generateRequestId() } }
        ),
        { status: 403 }
      );
    }

    c.set('adminAccess', true);
    await next();
  };
}

/**
 * 清理过期的锁定和尝试记录
 */
export function cleanupAuthData() {
  const now = Date.now();

  // 清理过期的锁定
  for (const [ip, lockout] of apiKeyValidator.lockouts.entries()) {
    if (now > lockout.expiresAt) {
      apiKeyValidator.lockouts.delete(ip);
    }
  }

  // 清理过期的失败尝试（24小时）
  const dayAgo = now - (24 * 60 * 60 * 1000);
  for (const [ip, attempts] of apiKeyValidator.attempts.entries()) {
    if (attempts.lastAttempt < dayAgo) {
      apiKeyValidator.attempts.delete(ip);
    }
  }
}

// 注意：在Cloudflare Workers中不使用setInterval
// 清理操作将在每次请求时检查并执行

export default {
  createAuthMiddleware,
  createAdminAuthMiddleware,
  cleanupAuthData
};
