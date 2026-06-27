/**
 * 基础提供商类 + 规范 GeoData 契约（C+D 综合）
 *
 * - 两层接口（Design C）：tryExtractSync（同步，进程内 provider 如 Cloudflare）+ fetch（异步，网络 provider）
 * - 类型化错误（轻量 Design D）：ProviderError 携带 .code；classify() 把上游任意失败映射到封闭错误集
 * - 规范 GeoData：所有 provider 经 createGeoData 产出统一形状 {ip, country, location, network}，
 *   字符串脱敏 + 数字校验在此一处完成（provider→响应的唯一安全边界）
 *
 * 「无数据」与「错误」分离：无数据 → 返回 null；真正失败 → 抛 ProviderError（类型化）。
 * 不设 NOT_FOUND：「该 IP 无记录」属正常无数据，provider 返回 null。
 */

import { getDefaultUserAgent } from '../utils/userAgent.js';

export const ProviderErrorCode = Object.freeze({
  AUTH_FAILURE: 'AUTH_FAILURE', // 401/403 凭证或权限问题
  RATE_LIMITED: 'RATE_LIMITED', // 429 上游限流
  TIMEOUT: 'TIMEOUT', // 请求超时/中止
  NETWORK_FAILURE: 'NETWORK_FAILURE', // DNS/连接/网络层失败
  PARSE_ERROR: 'PARSE_ERROR', // 响应解析失败
  UPSTREAM_ERROR: 'UPSTREAM_ERROR' // 其他上游非预期状态
});

/**
 * 类型化 Provider 错误。orchestrator 按 err.code 决策兜底与遥测，不再解析 message 字符串。
 */
export class ProviderError extends Error {
  constructor(code, provider, message, options = {}) {
    super(`${provider}: ${code}${message ? ` — ${message}` : ''}`);
    this.name = 'ProviderError';
    this.code = code;
    this.provider = provider;
    this.retryable = Boolean(options.retryable);
    if (options.httpStatus !== undefined) {
      this.httpStatus = options.httpStatus;
    }
  }
}

const cleanStr = (v) => {
  if (typeof v !== 'string') {
    return null;
  }
  const s = v.replace(/[<>"'&]/g, '').replace(/[\x00-\x1F\x7F]/g, '').trim();
  return s.length > 0 ? s.substring(0, 255) : null;
};

// asn/latitude/longitude/accuracy：接受 number 或数字字符串（CF cf.latitude 可能是字符串）
const cleanNum = (v) => {
  if (typeof v === 'number') {
    return Number.isNaN(v) ? null : v;
  }
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isNaN(n) ? null : n;
  }
  return null;
};

/**
 * 规范 GeoData 构造器：所有 provider 经此产出统一形状。
 * 在此完成字符串脱敏与数字校验（provider→响应的唯一安全边界）。
 */
export function createGeoData({ ip, country = {}, location = {}, network = {} } = {}) {
  const c = country || {};
  const l = location || {};
  const co = l.coordinates || {};
  const n = network || {};
  return {
    ip: cleanStr(ip),
    country: {
      name: cleanStr(c.name),
      code: cleanStr(c.code),
      region: cleanStr(c.region),
      city: cleanStr(c.city),
      continent: cleanStr(c.continent),
      continentCode: cleanStr(c.continentCode)
    },
    location: {
      coordinates: {
        latitude: cleanNum(co.latitude),
        longitude: cleanNum(co.longitude),
        accuracy: cleanNum(co.accuracy)
      },
      timezone: cleanStr(l.timezone),
      postalCode: cleanStr(l.postalCode)
    },
    network: {
      asn: cleanNum(n.asn),
      organization: cleanStr(n.organization),
      isp: cleanStr(n.isp),
      domain: cleanStr(n.domain)
    }
  };
}

export function emptyGeoData() {
  return createGeoData();
}

export class BaseProvider {
  constructor(name, config = {}) {
    this.name = name;
    this.config = config;
    this.priority = config.priority || 1;
    this.tier = config.tier || 'async';
  }

  /** 是否已配置（凭证齐备/可用）。orchestrator 据此过滤。子类可重写。 */
  isConfigured() {
    return true;
  }

  /**
   * 同步快速路径（tier0）：进程内 provider（Cloudflare request.cf）零开销返回。
   * 默认返回 null（表示「我是异步 provider」或「本次请求无进程内数据」）。
   * 仅 tier:'sync' 的 provider 重写。
   */
  tryExtractSync(_ip, _ctx) {
    return null;
  }

  /**
   * 异步慢速路径（tier1/2）：网络 provider 查询。
   * 返回 GeoData | null（null = 该数据源无此 IP 记录，属正常）。
   * 抛 ProviderError 表示真正失败（凭证/限流/超时/网络/解析）。默认返回 null。
   */
  async fetch(_ip, _opts = {}) {
    return null;
  }

  /**
   * 共享 HTTP GET（替代各 provider 重复的 fetch 样板）。调用方负责解析与 classify。
   */
  async httpGet(url, { headers = {}, timeoutMs = 5000 } = {}) {
    return fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': getDefaultUserAgent(),
        Accept: 'application/json',
        ...headers
      },
      signal: AbortSignal.timeout(timeoutMs)
    });
  }

  /**
   * 将任意上游失败映射为类型化 ProviderError（轻量 D）。
   * 子类可重写以补充上游特定映射（如按 HTTP 状态码）。
   */
  classify(error, operation) {
    if (error instanceof ProviderError) {
      return error;
    }
    const name = error?.name || '';
    const msg = error?.message || String(error);
    if (/timeout|abort/i.test(name) || /timeout|超时/i.test(msg)) {
      return new ProviderError(ProviderErrorCode.TIMEOUT, this.name, `${operation}: ${msg}`);
    }
    if (/\b401\b|403|auth|认证|权限/.test(msg)) {
      return new ProviderError(ProviderErrorCode.AUTH_FAILURE, this.name, `${operation}: ${msg}`);
    }
    if (/\b429\b|rate|限流|限速/.test(msg)) {
      return new ProviderError(ProviderErrorCode.RATE_LIMITED, this.name, `${operation}: ${msg}`);
    }
    if (/network|fetch|ENOTFOUND|ECONN|网络/.test(msg)) {
      return new ProviderError(ProviderErrorCode.NETWORK_FAILURE, this.name, `${operation}: ${msg}`);
    }
    if (/json|parse|invalid.*format|解析|格式/.test(msg)) {
      return new ProviderError(ProviderErrorCode.PARSE_ERROR, this.name, `${operation}: ${msg}`);
    }
    return new ProviderError(ProviderErrorCode.UPSTREAM_ERROR, this.name, `${operation}: ${msg}`);
  }
}
