import { PROVIDERS_CONFIG } from "../config/security.js";
import { BaseProvider } from "./BaseProvider.js";

export class IPInfoProvider extends BaseProvider {
  constructor() {
    super("IPInfo", {
      priority: PROVIDERS_CONFIG.priorities.ipinfo,
      ...PROVIDERS_CONFIG.endpoints.ipinfo
    });
  }

  async getIPInfo(ip, request, _options = {}) {
    try {
      if (!this.isConfigured()) {
        throw new Error("IPInfo not configured");
      }

      const response = await this.makeIPInfoRequest(ip, "json");
      return this.parseIPResponse(response);
    } catch (_error) {
      throw new Error("IPInfo IP lookup failed");
    }
  }

  async getGeoInfo(ip, request, _options = {}) {
    try {
      // IPInfo works without token for limited requests
      const response = await this.makeIPInfoRequest(ip, "json");
      return this.parseGeoResponse(response);
    } catch (_error) {
      // Don't throw error, just return null to let other providers handle it
      return null;
    }
  }

  async makeIPInfoRequest(ip, format = "json") {
    const baseUrl = this.config.url;
    const token = this.config.token;

    let url = `${baseUrl}/${ip}/${format}`;

    // Add token if available
    if (token) {
      url += `?token=${token}`;
    }

    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "User-Agent": "IP-API/2.0",
      },
      signal: AbortSignal.timeout(this.config.timeout),
    });

    if (!response.ok) {
      throw new Error(
        `IPInfo API error: ${response.status} ${response.statusText}`,
      );
    }

    return await response.json();
  }

  parseIPResponse(response) {
    return {
      ip: response.ip,
      type: getIPType(response.ip),
      version: getIPVersion(response.ip),
      isPrivate: isPrivateIP(response.ip),
      isLoopback: isLoopbackIP(response.ip),
      isMulticast: isMulticastIP(response.ip),
      hostname: response.hostname,
      provider: this.name,
    };
  }

  parseGeoResponse(response) {
    // Parse IPInfo response format
    const location = response.loc ? response.loc.split(",") : [null, null];
    const latitude = location[0] ? parseFloat(location[0]) : null;
    const longitude = location[1] ? parseFloat(location[1]) : null;

    return {
      ip: response.ip,
      city: response.city,
      region: response.region,
      country: response.country_name || this.getCountryName(response.country),
      countryCode: response.country,
      latitude,
      longitude,
      timezone: response.timezone,
      asn: response.asn ? this.parseASN(response.asn) : null,
      asOrganization: response.org,
      isp: response.org,
      organization: response.org,
      hostname: response.hostname,
      postal: response.postal,
      provider: this.name,
    };
  }

  parseASN(asnString) {
    // IPInfo returns ASN in format "AS15169 Google LLC"
    if (!asnString) {
      return null;
    }

    const match = asnString.match(/^AS(\d+)/);
    return match ? parseInt(match[1]) : null;
  }

  getCountryName(countryCode) {
    // Simple country code to name mapping
    const countryNames = {
      US: "United States",
      GB: "United Kingdom",
      CA: "Canada",
      AU: "Australia",
      DE: "Germany",
      FR: "France",
      JP: "Japan",
      CN: "China",
      IN: "India",
      BR: "Brazil",
      RU: "Russia",
      IT: "Italy",
      ES: "Spain",
      KR: "South Korea",
      MX: "Mexico",
      NL: "Netherlands",
      SE: "Sweden",
      NO: "Norway",
      DK: "Denmark",
      FI: "Finland",
    };

    return countryNames[countryCode] || countryCode;
  }

  isConfigured() {
    // IPInfo can work without a token but with rate limits
    // Return true if we have a token or if we want to use the free tier
    return true;
  }

  // IP validation functions are now imported from utils/ipValidation.js

  // Additional IPInfo-specific methods
  async getBulkData(ips) {
    if (!this.config.token) {
      throw new Error("Bulk requests require an IPInfo token");
    }

    const response = await fetch(`${this.config.url}/batch`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.config.token}`,
      },
      body: JSON.stringify(ips),
      signal: AbortSignal.timeout(this.config.timeout * 2), // Longer timeout for bulk
    });

    if (!response.ok) {
      throw new Error(
        `IPInfo bulk API error: ${response.status} ${response.statusText}`,
      );
    }

    return await response.json();
  }

  async getASNInfo(asn) {
    let url = `${this.config.url}/AS${asn}/json`;
    const token = this.config.token;

    if (token) {
      url += `?token=${token}`;
    }

    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(this.config.timeout),
    });

    if (!response.ok) {
      throw new Error(
        `IPInfo ASN API error: ${response.status} ${response.statusText}`,
      );
    }

    return await response.json();
  }
}
