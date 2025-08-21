import { PROVIDERS_CONFIG } from "../config/security.js";
import { BaseProvider } from "./BaseProvider.js";

export class CloudflareProvider extends BaseProvider {
  constructor() {
    super("Cloudflare", {
      priority: PROVIDERS_CONFIG.priorities.cloudflare
    });
  }

  async getIPInfo(ip, request, _options = {}) {
    try {
      // 使用基础类的方法获取IP信息
      return this.getBaseIPInfo(ip);
    } catch (_error) {
      this.handleError(error, "IP lookup");
    }
  }

  async getGeoInfo(ip, request, _options = {}) {
    try {
      // Extract geolocation data from Cloudflare request object and headers
      const cf = request.cf || {};
      const headers = request.headers || new Headers();

      // Try to get data from cf object first, then fallback to headers
      const city = cf.city || this.getHeaderValue(headers, "cf-ipcity");
      const region =
        cf.region ||
        this.getHeaderValue(headers, "cf-region") ||
        this.getHeaderValue(headers, "cf-region-code");
      const country =
        cf.country || this.getHeaderValue(headers, "cf-ipcountry");
      const latitude =
        cf.latitude || this.getHeaderValue(headers, "cf-iplatitude");
      const longitude =
        cf.longitude || this.getHeaderValue(headers, "cf-iplongitude");
      const asOrganization =
        cf.asOrganization || this.getHeaderValue(headers, "x-asn");
      const colo =
        cf.colo || this.getHeaderValue(headers, "cf-ray")?.split("-")[1];

      const geoInfo = {
        ip,
        city,
        region,
        country,
        countryCode: country,
        countryRegion: region,
        continent: cf.continent,
        latitude: latitude ? parseFloat(latitude) : null,
        longitude: longitude ? parseFloat(longitude) : null,
        timezone: cf.timezone,
        asn: cf.asn,
        asOrganization,
        colo,
        provider: this.name,
      };

      // Generate flag emoji if country code is available
      if (geoInfo.countryCode) {
        geoInfo.flag = this.getFlag(geoInfo.countryCode);
      }

      // Get colo information from CF-RAY header (don't override region with colo)
      const cfRay = this.getHeaderValue(headers, "cf-ray");
      if (cfRay && !geoInfo.colo) {
        const parts = cfRay.split("-");
        if (parts.length > 1) {
          geoInfo.colo = parts[1];
          // Don't override geographic region with datacenter code
        }
      }

      // Convert string coordinates to numbers
      if (geoInfo.latitude && typeof geoInfo.latitude === "string") {
        geoInfo.latitude = parseFloat(geoInfo.latitude);
      }
      if (geoInfo.longitude && typeof geoInfo.longitude === "string") {
        geoInfo.longitude = parseFloat(geoInfo.longitude);
      }

      // Add additional Cloudflare-specific data
      geoInfo.datacenter = geoInfo.colo;
      geoInfo.cfRay = cfRay;

      return geoInfo;
    } catch (_error) {
      throw new Error("Cloudflare geo lookup failed");
    }
  }

  getHeaderValue(headers, name) {
    if (typeof headers.get === "function") {
      return headers.get(name);
    }
    if (typeof headers[name] !== "undefined") {
      return headers[name];
    }
    return null;
  }

  // IP validation functions are now imported from utils/ipValidation.js

  getFlag(countryCode) {
    if (!countryCode || countryCode.length !== 2) {
      return null;
    }

    const codePoints = countryCode
      .toUpperCase()
      .split("")
      .map((char) => 127397 + char.charCodeAt(0));

    return String.fromCodePoint(...codePoints);
  }

  // Helper method to check if we're running on Cloudflare Workers
  isCloudflareEnvironment() {
    return (
      typeof caches !== "undefined" &&
      typeof CloudflareWorkersGlobalScope !== "undefined"
    );
  }

  // Get additional Cloudflare-specific information
  getCloudflareMetadata(request) {
    const cf = request.cf || {};

    return {
      botManagement: cf.botManagement,
      clientTrustScore: cf.clientTrustScore,
      tlsVersion: cf.tlsVersion,
      tlsCipher: cf.tlsCipher,
      httpProtocol: cf.httpProtocol,
      requestPriority: cf.requestPriority,
    };
  }
}
