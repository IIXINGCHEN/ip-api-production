import { PROVIDERS_CONFIG } from '../config/security.js';
import { BaseProvider, createGeoData } from './BaseProvider.js';
import { generateProviderUserAgent } from '../utils/userAgent.js';

function runtimeValue(env, name) {
  return env?.[name] || (typeof globalThis !== 'undefined' ? globalThis[name] : undefined) || null;
}

/**
 * 🔵 MaxMind GeoIP2 Provider（异步，需凭证）
 * 支持 language（names[lang]）—— pain point #6。
 */
export class MaxMindProvider extends BaseProvider {
  constructor(env = {}) {
    super('MaxMind', {
      priority: PROVIDERS_CONFIG.priorities.maxmind,
      tier: 'async',
      ...PROVIDERS_CONFIG.endpoints.maxmind,
      userId: runtimeValue(env, 'MAXMIND_USER_ID'),
      licenseKey: runtimeValue(env, 'MAXMIND_LICENSE_KEY')
    });
  }

  async fetch(ip, opts = {}) {
    if (!this.isConfigured()) {
      return null; // 未配置 → 无数据（正常），让其他 provider 处理
    }
    try {
      const response = await this.makeMaxMindRequest('insights', ip, opts);
      return this.parseGeoResponse(response, opts);
    } catch (error) {
      // 404（IP 不在库）→ 无数据；其他失败 → 类型化错误（可观测）
      if (/\b404\b|not found/i.test(error.message || '')) {
        return null;
      }
      throw this.classify(error, 'MaxMind lookup');
    }
  }

  async makeMaxMindRequest(service, ip, opts = {}) {
    const url = `${this.config.url}/geoip/v2.1/${service}/${ip}`;
    const credentials = `${this.config.userId}:${this.config.licenseKey}`;
    const auth = btoa(credentials);

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Basic ${auth}`,
          Accept: 'application/json',
          'User-Agent': generateProviderUserAgent('MaxMind')
        },
        signal: opts.signal || AbortSignal.timeout(this.config.timeout)
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(
          `MaxMind API error: ${response.status} ${response.statusText} - ${errorBody}`
        );
      }

      return await response.json();
    } catch (error) {
      if (error.name === 'AbortError') {
        throw new Error('MaxMind API timeout');
      }
      throw error;
    }
  }

  parseGeoResponse(response, opts = {}) {
    const lang = (opts.language || 'en').slice(0, 2);
    const names = (obj) => obj?.names?.[lang] || obj?.names?.en || null;

    return createGeoData({
      ip: response.traits?.ip_address || null,
      country: {
        name: names(response.country),
        code: response.country?.iso_code || null,
        region: names(response.subdivisions?.[0]) || null,
        city: names(response.city),
        continent: names(response.continent),
        continentCode: response.continent?.code || null
      },
      location: {
        coordinates: {
          latitude: response.location?.latitude,
          longitude: response.location?.longitude,
          accuracy: response.location?.accuracy_radius
        },
        timezone: response.location?.time_zone || null,
        postalCode: response.postal?.code || null
      },
      network: {
        asn: response.traits?.autonomous_system_number ?? null,
        organization: response.traits?.autonomous_system_organization || null,
        isp: response.traits?.isp || null,
        domain: response.traits?.domain || null
      }
    });
  }

  isConfigured() {
    return !!(this.config.userId && this.config.licenseKey);
  }
}
