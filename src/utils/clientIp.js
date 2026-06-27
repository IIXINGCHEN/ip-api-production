/**
 * 🌐 客户端 IP 提取（按部署平台信任链）
 *
 * 区分两种用途：
 * - getTrustedClientIP：平台边缘设置、客户端无法伪造的 IP，用作限流/认证锁定键。
 *   Cloudflare → CF-Connecting-IP；Vercel/Netlify → X-Forwarded-For 左值（平台边缘覆写）；
 *   其他入口 → null（调用方应回退到紧限流的 'unknown' 桶，避免伪造 IP 绕过限流/锁定）。
 * - getBestEffortClientIP：尽力而为的客户端 IP，用作地理自查询（/self）的提示。
 *   优先可信源，回退到 XFF/X-Real-IP/X-Client-IP（不可信，但仅影响返回的地理数据，无安全后果）。
 */

import { isValidIP } from './ipValidation.js';

function headerValue(req, name) {
  const headers = req?.headers;
  if (!headers) {
    return null;
  }
  if (typeof headers.get === 'function') {
    return headers.get(name);
  }
  return headers[name] ?? null;
}

function leftmostXFF(req) {
  const xff = headerValue(req, 'x-forwarded-for');
  if (!xff) {
    return null;
  }
  return xff.split(',')[0].trim();
}

function envFlag(...names) {
  for (const name of names) {
    if (typeof globalThis !== 'undefined' && globalThis[name]) {
      return true;
    }
  }
  if (typeof process !== 'undefined' && process.env) {
    for (const name of names) {
      if (process.env[name]) {
        return true;
      }
    }
  }
  return false;
}

/**
 * 平台可信客户端 IP（用作限流/认证锁定键）。null = 无可信源。
 */
export function getTrustedClientIP(req) {
  // Cloudflare：CF-Connecting-IP 由 CF 边缘注入，客户端无法伪造
  const cf = headerValue(req, 'cf-connecting-ip');
  if (cf && isValidIP(cf)) {
    return cf;
  }

  // Vercel / Netlify：平台边缘覆写 X-Forwarded-For，左值为真实客户端
  if (envFlag('VERCEL') || envFlag('VERCEL_ENV') || envFlag('NETLIFY') || envFlag('CONTEXT')) {
    const leftmost = leftmostXFF(req);
    if (leftmost && isValidIP(leftmost)) {
      return leftmost;
    }
  }

  return null;
}

/**
 * 尽力而为的客户端 IP（地理自查询用）。
 */
export function getBestEffortClientIP(req) {
  const cf = headerValue(req, 'cf-connecting-ip');
  if (cf && isValidIP(cf)) {
    return cf;
  }

  const xff = leftmostXFF(req);
  if (xff && isValidIP(xff)) {
    return xff;
  }

  const xreal = headerValue(req, 'x-real-ip');
  if (xreal && isValidIP(xreal)) {
    return xreal;
  }

  const xclient = headerValue(req, 'x-client-ip');
  if (xclient && isValidIP(xclient)) {
    return xclient;
  }

  return '127.0.0.1';
}
