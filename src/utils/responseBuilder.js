/**
 * 📦 统一 RESTful 响应信封构造器
 *
 * 成功：{ data, meta, links }
 * 失败：{ error, meta }（无 data/links，HTTP 状态码表达成败）
 *
 * 移除了旧版顶层 `success` 布尔（RESTful 用 HTTP 状态码），
 * 字段统一 camelCase，时间用 `processingTimeMs` 显式单位。
 */

import { generateRequestId } from './response.js';

const API_VERSION = 'v1';

/**
 * 构造 meta 元数据块
 * @param {object} ctx - 请求上下文（Hono Context 或 { requestId }）
 * @param {number} startTime - 请求起始时间戳（ms）
 * @param {object} [extra] - 额外 meta 字段
 */
export function buildMeta(ctx = {}, startTime, extra = {}) {
  const timestamp = new Date().toISOString();
  const meta = {
    requestId: ctx.requestId || (ctx.get && ctx.get('requestId')) || generateRequestId(),
    timestamp,
    apiVersion: API_VERSION,
    processingTimeMs: startTime ? Date.now() - startTime : 0
  };
  return { ...meta, ...extra };
}

/**
 * 构造成功响应体
 * @param {*} data - 资源数据
 * @param {object} [opts]
 * @param {object} [opts.ctx] - 请求上下文
 * @param {number} [opts.startTime] - 起始时间戳
 * @param {object} [opts.links] - HATEOAS 链接
 * @param {object} [opts.meta] - 额外 meta 字段（如 cached、provider）
 */
export function buildSuccess(data, opts = {}) {
  const { ctx, startTime, links = null, meta: extraMeta = {} } = opts;
  const body = {
    data,
    meta: buildMeta(ctx, startTime, extraMeta)
  };
  if (links) {
    body.links = links;
  }
  return body;
}

/**
 * 构造错误响应体（不含 data/links）
 * @param {string} code - 错误码（如 'INVALID_IP'）
 * @param {string} message - 人类可读消息
 * @param {object} [details] - 额外详情（dev 环境透传，prod 自动脱敏由调用方控制）
 * @param {object} [opts] - { ctx, startTime }
 */
export function buildError(code, message, details = null, opts = {}) {
  const { ctx, startTime } = opts;
  const error = { code, message };
  if (details !== null && details !== undefined) {
    error.details = details;
  }
  return {
    error,
    meta: buildMeta(ctx, startTime)
  };
}

/**
 * 构造 HATEOAS 链接对象
 * @param {string} baseUrl
 * @param {object} rels - { rel: 'path', ... } 或 { rel: { href, method }, ... }
 */
export function buildLinks(baseUrl, rels = {}) {
  const links = {};
  for (const [rel, value] of Object.entries(rels)) {
    if (typeof value === 'string') {
      links[rel] = { href: `${baseUrl}${value}`, method: 'GET' };
    } else {
      links[rel] = value;
    }
  }
  return links;
}

/**
 * 从 Hono Context 提取基础 URL
 */
export function getBaseUrl(c) {
  try {
    const host = c?.req?.header?.('host') || 'localhost';
    const protocol = c?.req?.header?.('x-forwarded-proto') || 'https';
    return `${protocol}://${host}`;
  } catch {
    return 'https://localhost';
  }
}

export { API_VERSION };
