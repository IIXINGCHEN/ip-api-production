/**
 * 🔒 生产级响应工具函数
 *
 * 仅保留全局在用的：generateRequestId（请求 ID）、secureCompare（常量时间比较）。
 * 历史的 formatGeoResponse / formatIPResponse / getCountryNameFromCode 等含硬编码
 * 国名表与遗留格式化器，已被 src/utils/responseBuilder.js + geoFormatter.js 取代，
 * 本次审查（No Mock Data Policy）移除死代码与硬编码映射表。
 */

/**
 * 生成安全的请求 ID（跨 isolate 唯一：时间戳 + 加密随机后缀）
 * 旧实现用 globalThis 计数器，Workers 多 isolate 各自从 0 计数 → 同毫秒碰撞。
 * 现用 crypto.getRandomValues（Workers/Node 均支持）取 8 字节随机后缀，碰撞概率可忽略。
 */
function generateSecureRequestId() {
  const timestamp = Date.now().toString(36);
  let random = '';
  try {
    const g = typeof globalThis !== 'undefined' ? globalThis.crypto : undefined;
    if (g && typeof g.getRandomValues === 'function') {
      const bytes = g.getRandomValues(new Uint8Array(8));
      random = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    }
  } catch {
    random = '';
  }
  if (!random) {
    random = Math.floor(Math.random() * 0xffffffffffff).toString(16);
  }
  return `${timestamp}-${random}`;
}

export function generateRequestId() {
  return generateSecureRequestId();
}

/**
 * 常量时间字符串比较，避免时序攻击泄漏 API key 长度/前缀信息。
 * 两个输入长度不同时立即返回 false（长度本身是公开的元数据，不算泄漏）。
 */
export function secureCompare(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') {
    return false;
  }
  if (a.length !== b.length) {
    return false;
  }

  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);

  let mismatch = 0;
  for (let i = 0; i < ab.length; i++) {
    mismatch |= ab[i] ^ bb[i];
  }
  return mismatch === 0;
}

export default { generateRequestId, secureCompare };
