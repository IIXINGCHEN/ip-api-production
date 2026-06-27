import { PROVIDERS_CONFIG } from '../config/security.js';
import { BaseProvider, createGeoData } from './BaseProvider.js';

/**
 * 🌥️ Cloudflare Provider（同步，tier0 快速路径）
 *
 * 从 request.cf 与 cf-* 头提取地理位置——无网络调用、零 Promise 开销。
 * 仅 CF 提供 ISO 国码（cf.country），不提供国名 → country.name 为 null（不编造）。
 * 无真实 cf 数据时字段为 null（No Mock Data Policy）。
 */
export class CloudflareProvider extends BaseProvider {
  constructor() {
    super('Cloudflare', {
      priority: PROVIDERS_CONFIG.priorities.cloudflare,
      tier: 'sync'
    });
  }

  tryExtractSync(ip, ctx = {}) {
    const cf = ctx.cf || {};
    const headers = ctx.headers || new Headers();
    const h = (name) => {
      if (typeof headers.get === 'function') {
        return headers.get(name);
      }
      return headers[name] ?? null;
    };

    const asOrganization = cf.asOrganization || h('x-asn');

    return createGeoData({
      ip,
      country: {
        name: null, // CF 仅给 ISO code，不提供国名；不编造
        code: cf.country || h('cf-ipcountry'),
        region: cf.region || h('cf-region') || h('cf-region-code'),
        city: cf.city || h('cf-ipcity'),
        continent: cf.continent ?? null,
        continentCode: null
      },
      location: {
        coordinates: {
          latitude: cf.latitude ?? h('cf-iplatitude'),
          longitude: cf.longitude ?? h('cf-iplongitude')
        },
        timezone: cf.timezone ?? null,
        postalCode: null // CF 不提供邮政编码
      },
      network: {
        asn: cf.asn ?? null,
        organization: asOrganization,
        isp: asOrganization,
        domain: null
      }
    });
  }
}
