import { PROVIDERS_CONFIG } from "../config/security.js";
import { BaseProvider } from "./BaseProvider.js";

export class MaxMindProvider extends BaseProvider {
  constructor() {
    super("MaxMind", {
      priority: PROVIDERS_CONFIG.priorities.maxmind,
      ...PROVIDERS_CONFIG.endpoints.maxmind
    });
  }

  async getIPInfo(ip, request, _options = {}) {
    try {
      if (!this.isConfigured()) {
        throw new Error("MaxMind not configured");
      }

      // Make actual API call to MaxMind GeoIP2 service
      const response = await this.makeMaxMindRequest('insights', ip);
      const ipInfo = this.parseIPResponse(response);

      ipInfo.provider = this.name;
      return ipInfo;
    } catch (error) {
      // Enhanced error handling for MaxMind API
      if (error.message.includes('401')) {
        throw new Error("MaxMind authentication failed - check credentials");
      }
      if (error.message.includes('403')) {
        throw new Error("MaxMind access denied - check account permissions");
      }
      if (error.message.includes('404')) {
        throw new Error("MaxMind IP not found in database");
      }
      if (error.message.includes('timeout')) {
        throw new Error("MaxMind API timeout - service unavailable");
      }

      throw new Error("MaxMind IP lookup failed");
    }
  }

  async getGeoInfo(ip, request, _options = {}) {
    try {
      if (!this.isConfigured()) {
        // Return null if not configured, let other providers handle it
        return null;
      }

      // Make actual API call to MaxMind GeoIP2 service
      const response = await this.makeMaxMindRequest('insights', ip);
      const geoInfo = this.parseGeoResponse(response);

      geoInfo.provider = this.name;
      return geoInfo;
    } catch (error) {
      // Enhanced error handling for MaxMind API
      if (error.message.includes('401')) {
        throw new Error("MaxMind authentication failed - check credentials");
      }
      if (error.message.includes('403')) {
        throw new Error("MaxMind access denied - check account permissions");
      }
      if (error.message.includes('404')) {
        throw new Error("MaxMind IP not found in database");
      }
      if (error.message.includes('timeout')) {
        throw new Error("MaxMind API timeout - service unavailable");
      }

      // Return null for other errors to let other providers handle it
      return null;
    }
  }





  async makeMaxMindRequest(service, ip) {
    // Make actual HTTP requests to MaxMind's GeoIP2 API
    const url = `${this.config.url}/geoip/v2.1/${service}/${ip}`;

    // Create basic auth header
    const credentials = `${this.config.userId}:${this.config.licenseKey}`;
    const auth = btoa(credentials); // Use btoa for browser compatibility

    try {
      const response = await fetch(url, {
        method: "GET",
        headers: {
          Authorization: `Basic ${auth}`,
          Accept: "application/json",
          "User-Agent": "IP-API/2.0 MaxMind-Client"
        },
        signal: AbortSignal.timeout(this.config.timeout),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(
          `MaxMind API error: ${response.status} ${response.statusText} - ${errorBody}`,
        );
      }

      const data = await response.json();
      return data;
    } catch (error) {
      if (error.name === 'AbortError') {
        throw new Error('MaxMind API timeout');
      }
      if (error.message.includes('fetch')) {
        throw new Error('MaxMind API network error');
      }
      throw new Error(`MaxMind request failed: ${error.message}`);
    }
  }

  parseIPResponse(response) {
    // Parse MaxMind IP response format
    return {
      ip: response.ip,
      type: response.traits?.user_type || "unknown",
      isAnonymousProxy: response.traits?.is_anonymous_proxy || false,
      isSatelliteProvider: response.traits?.is_satellite_provider || false,
      provider: this.name,
    };
  }

  parseGeoResponse(response) {
    // Parse MaxMind GeoIP2 response format with comprehensive data extraction
    const city = response.city?.names?.en || response.city?.names?.['zh-CN'];
    const country = response.country?.names?.en || response.country?.names?.['zh-CN'];
    const continent = response.continent?.names?.en || response.continent?.names?.['zh-CN'];

    const geoInfo = {
      ip: response.traits?.ip_address || null,
      city,
      region: response.subdivisions?.[0]?.names?.en || response.subdivisions?.[0]?.names?.['zh-CN'],
      regionCode: response.subdivisions?.[0]?.iso_code,
      country,
      countryCode: response.country?.iso_code,
      continent,
      continentCode: response.continent?.code,
      latitude: response.location?.latitude,
      longitude: response.location?.longitude,
      accuracy: response.location?.accuracy_radius,
      timezone: response.location?.time_zone,
      postalCode: response.postal?.code,
      metroCode: response.location?.metro_code,
      asn: response.traits?.autonomous_system_number,
      asOrganization: response.traits?.autonomous_system_organization,
      isp: response.traits?.isp,
      organization: response.traits?.organization,
      domain: response.traits?.domain,
      usageType: response.traits?.user_type,
      isAnonymousProxy: response.traits?.is_anonymous_proxy || false,
      isSatelliteProvider: response.traits?.is_satellite_provider || false,
      isLegitimateProxy: response.traits?.is_legitimate_proxy || false,
      provider: this.name,
      confidence: {
        country: response.country?.confidence,
        city: response.city?.confidence,
        subdivision: response.subdivisions?.[0]?.confidence,
        postal: response.postal?.confidence
      }
    };

    // Add flag emoji if country code is available
    if (geoInfo.countryCode) {
      geoInfo.flag = this.getFlag(geoInfo.countryCode);
    }

    return geoInfo;
  }

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

  isConfigured() {
    return !!(this.config.userId && this.config.licenseKey);
  }

  // IP validation functions are now imported from utils/ipValidation.js
}
