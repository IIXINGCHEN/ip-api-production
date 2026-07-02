/**
 * 🌐 ip-api.com Provider（真实数据，免费免 token，异步兜底）
 *
 * 数据源：{{http://ip-api.com/json/{ip}}} —— 真实上游 HTTP 请求，非硬编码。
 * 限制（免费版）：HTTP-only（无 HTTPS）、45 req/min、非商用授权。
 * 生产默认禁用：必须显式 ENABLE_INSECURE_IPAPI_FALLBACK=true 才会启用。
 * 支持 lang 参数（pain point #6：language 不再被忽略）。
 */

import { PROVIDERS_CONFIG } from '../config/security.js';
import { BaseProvider, createGeoData } from './BaseProvider.js';
import { generateProviderUserAgent } from '../utils/userAgent.js';

const FIELDS = [
  'status', 'message',
  'country', 'countryCode', 'region', 'regionName', 'city', 'zip',
  'lat', 'lon', 'timezone',
  'isp', 'org', 'as', 'reverse', 'mobile', 'proxy', 'hosting', 'query'
].join(',');

function runtimeValue(env, name) {
  return env?.[name] || (typeof globalThis !== 'undefined' ? globalThis[name] : undefined) || null;
}

function isTruthy(value) {
  return value === true || String(value || '').toLowerCase() === 'true';
}

function isProduction(env = {}) {
  const value = runtimeValue(env, 'ENVIRONMENT') || runtimeValue(env, 'WORKER_ENV') || runtimeValue(env, 'NODE_ENV');
  return String(value || '').toLowerCase() === 'production';
}

export class IPApiComProvider extends BaseProvider {
  constructor(env = {}) {
    super('IPApiCom', {
      priority: PROVIDERS_CONFIG.priorities.ipapicom,
      tier: 'async',
      ...PROVIDERS_CONFIG.endpoints.ipapicom,
      env
    });
  }

  async fetch(ip, opts = {}) {
    try {
      const data = await this.makeRequest(ip, opts);
      return this.parseGeoResponse(ip, data);
    } catch (error) {
      throw this.classify(error, 'ip-api.com lookup');
    }
  }

  async makeRequest(ip, opts = {}) {
    const lang = encodeURIComponent((opts.language || 'en').slice(0, 2));
    const url = `${this.config.url}/json/${ip}?fields=${FIELDS}&lang=${lang}`;
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'User-Agent': generateProviderUserAgent('IPApiCom')
        },
        signal: opts.signal || AbortSignal.timeout(this.config.timeout)
      });

      if (!response.ok) {
        throw new Error(`ip-api.com HTTP ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      if (!data || typeof data !== 'object') {
        throw new Error('ip-api.com 返回格式无效');
      }
      if (data.status && data.status !== 'success') {
        throw new Error(`ip-api.com 查询失败: ${data.message || data.status}`);
      }
      return data;
    } catch (error) {
      if (error.name === 'AbortError') {
        throw new Error('ip-api.com 请求超时');
      }
      throw error;
    }
  }

  parseGeoResponse(ip, data) {
    const asn = this.parseASN(data.as);
    return createGeoData({
      ip: data.query || ip,
      country: {
        name: data.country || null, // ip-api.com 的 country 是国名全称
        code: data.countryCode || null,
        region: data.regionName || data.region || null,
        city: data.city || null,
        continent: null, // 免费版不返回 continent
        continentCode: null
      },
      location: {
        coordinates: { latitude: data.lat, longitude: data.lon },
        timezone: data.timezone || null,
        postalCode: data.zip || null
      },
      network: {
        asn,
        organization: this.parseAsOrganization(data.as) || data.org || data.isp || null,
        isp: data.isp || null,
        domain: null
      }
    });
  }

  parseASN(asString) {
    if (!asString) return null;
    const match = String(asString).match(/^AS(\d+)/);
    return match ? parseInt(match[1], 10) : null;
  }

  parseAsOrganization(asString) {
    if (!asString) return null;
    // 格式 "AS15169 Google LLC" → 去掉 ASN 前缀
    return String(asString).replace(/^AS\d+\s*/i, '').trim() || null;
  }

  isConfigured() {
    const enabled = isTruthy(runtimeValue(this.config.env, 'ENABLE_INSECURE_IPAPI_FALLBACK'));
    if (isProduction(this.config.env)) {
      return enabled;
    }
    // 非生产也默认关闭，避免开发/测试误把查询 IP 明文外发；需要时显式打开。
    return enabled;
  }
}
