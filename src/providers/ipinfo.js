import { PROVIDERS_CONFIG } from '../config/security.js';
import { BaseProvider, createGeoData } from './BaseProvider.js';
import { generateProviderUserAgent } from '../utils/userAgent.js';

function runtimeValue(env, name) {
  return env?.[name] || (typeof globalThis !== 'undefined' ? globalThis[name] : undefined) || null;
}

/**
 * 🟢 IPInfo Provider（异步，需 token）
 */
export class IPInfoProvider extends BaseProvider {
  constructor(env = {}) {
    super('IPInfo', {
      priority: PROVIDERS_CONFIG.priorities.ipinfo,
      tier: 'async',
      ...PROVIDERS_CONFIG.endpoints.ipinfo,
      token: runtimeValue(env, 'IPINFO_TOKEN')
    });
  }

  async fetch(ip, opts = {}) {
    try {
      const response = await this.makeIPInfoRequest(ip, opts);
      return this.parseGeoResponse(response, opts);
    } catch (error) {
      // 抛类型化错误：orchestrator 的 allSettled 会跳过并记录，兜底逻辑不受影响
      throw this.classify(error, 'IPInfo lookup');
    }
  }

  async makeIPInfoRequest(ip, opts = {}) {
    const baseUrl = this.config.url;
    const token = this.config.token;

    let url = `${baseUrl}/${ip}/json`;
    if (token) {
      url += `?token=${encodeURIComponent(token)}`;
    }

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'User-Agent': generateProviderUserAgent('IPInfo')
        },
        signal: opts.signal || AbortSignal.timeout(this.config.timeout)
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(
          `IPInfo API error: ${response.status} ${response.statusText} - ${errorBody}`
        );
      }

      const data = await response.json();
      if (!data || typeof data !== 'object') {
        throw new Error('Invalid response format from IPInfo API');
      }
      return data;
    } catch (error) {
      if (error.name === 'AbortError') {
        throw new Error('IPInfo API timeout');
      }
      throw error;
    }
  }

  parseGeoResponse(response, _opts = {}) {
    const location = response.loc ? response.loc.split(',') : [null, null];
    return createGeoData({
      ip: response.ip || null,
      country: {
        name: response.country_name || null,
        code: response.country || null,
        region: response.region || null,
        city: response.city || null,
        continent: null,
        continentCode: null
      },
      location: {
        coordinates: { latitude: location[0], longitude: location[1] },
        timezone: response.timezone || null,
        postalCode: response.postal || null // 修复字段漂移：IPInfo 的 postal → postalCode
      },
      network: {
        asn: this.parseASN(response.asn),
        organization: response.org || null,
        isp: response.org || null,
        domain: null
      }
    });
  }

  parseASN(asnString) {
    if (!asnString) return null;
    const match = String(asnString).match(/^AS(\d+)/);
    return match ? parseInt(match[1], 10) : null;
  }

  isConfigured() {
    // 无 token 时禁用：否则每次查询都无认证打到 ipinfo.io（SLO/成本/隐私风险）
    return Boolean(this.config.token);
  }
}
