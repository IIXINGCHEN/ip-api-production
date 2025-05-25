import { CloudflareProvider } from "../providers/cloudflare.js";
import { MaxMindProvider } from "../providers/maxmind.js";
import { IPInfoProvider } from "../providers/ipinfo.js";
import { ThreatService } from "./threatService.js";
// import { PROVIDERS_CONFIG } from '../config/security.js' // Currently unused

export async function getGeoInfo(ip, request, options = {}) {
  try {
    // Validate IP address
    if (!isValidIP(ip)) {
      throw new Error("Invalid IP address");
    }

    // Get geolocation information from multiple providers
    const providers = getProviders();

    const results = await Promise.allSettled(
      providers.map((provider) => provider.getGeoInfo(ip, request, options)),
    );

    // Merge results with priority
    const geoInfo = mergeGeoResults(results, providers);

    // Add threat information if requested
    if (options.includeThreat) {
      try {
        const threatService = new ThreatService();
        geoInfo.threat = await threatService.getThreatInfo(ip, request);
      } catch (_error) {
        geoInfo.threat = { error: "Threat detection unavailable" };
      }
    }

    // Add metadata
    geoInfo.ip = ip;
    geoInfo.timestamp = new Date().toISOString();
    geoInfo.sources = results
      .map((result, index) => ({
        provider: providers[index].name,
        success: result.status === "fulfilled",
        priority: providers[index].priority,
      }))
      .filter((source) => source.success);

    // Add timezone information
    if (geoInfo.latitude && geoInfo.longitude) {
      geoInfo.timezone = getTimezoneFromCoordinates(
        geoInfo.latitude,
        geoInfo.longitude,
      );
    }

    // Add currency information
    if (geoInfo.country) {
      geoInfo.currency = getCurrencyFromCountry(geoInfo.country);
    }

    // Add language information
    if (geoInfo.country) {
      geoInfo.languages = getLanguagesFromCountry(geoInfo.country);
    }

    return geoInfo;
  } catch (_error) {
    throw new Error("Failed to get geolocation information");
  }
}

function getProviders() {
  const providers = [
    new CloudflareProvider(),
    new MaxMindProvider(),
    new IPInfoProvider(),
  ];

  // Sort by priority (highest first)
  return providers.sort((a, b) => b.priority - a.priority);
}

function mergeGeoResults(results, providers) {
  const merged = {
    ip: null,
    city: null,
    region: null,
    country: null,
    countryCode: null,
    countryRegion: null,
    continent: null,
    continentCode: null,
    latitude: null,
    longitude: null,
    accuracy: null,
    flag: null,
    asn: null,
    asOrganization: null,
    isp: null,
    organization: null,
    domain: null,
    usageType: null,
    sources: [],
  };

  // Process results in priority order
  results.forEach((result, index) => {
    if (
      result.status === "fulfilled" &&
      result.value &&
      result.value !== null
    ) {
      const data = result.value;
      const provider = providers[index];

      // Merge data with priority (higher priority overwrites lower)
      Object.keys(data).forEach((key) => {
        if (
          data[key] !== null &&
          data[key] !== undefined &&
          key !== "provider"
        ) {
          if (!merged[key] || provider.priority > (merged._lastPriority || 0)) {
            merged[key] = data[key];
            merged._lastPriority = provider.priority;
          }
        }
      });
    }
  });

  // Clean up internal fields
  delete merged._lastPriority;

  // Generate flag emoji if country code is available
  if (merged.countryCode && !merged.flag) {
    merged.flag = getFlag(merged.countryCode);
  }

  return merged;
}

function isValidIP(ip) {
  if (!ip || typeof ip !== "string") {
    return false;
  }

  // IPv4 regex
  const ipv4Regex =
    /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;

  // IPv6 regex (simplified)
  const ipv6Regex = /^(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$|^::1$|^::$/;

  return ipv4Regex.test(ip) || ipv6Regex.test(ip);
}

function getFlag(countryCode) {
  if (!countryCode || countryCode.length !== 2) {
    return null;
  }

  const codePoints = countryCode
    .toUpperCase()
    .split("")
    .map((char) => 127397 + char.charCodeAt(0));

  return String.fromCodePoint(...codePoints);
}

function getTimezoneFromCoordinates(lat, lon) {
  // This is a simplified implementation
  // In production, you might want to use a proper timezone lookup service
  const longitude = parseFloat(lon);

  if (isNaN(longitude)) {
    return null;
  }

  // Rough timezone calculation based on longitude
  const offset = Math.round(longitude / 15);
  const sign = offset >= 0 ? "+" : "-";
  const hours = Math.abs(offset).toString().padStart(2, "0");

  return `UTC${sign}${hours}:00`;
}

function getCurrencyFromCountry(countryCode) {
  // Simplified currency mapping
  const currencyMap = {
    US: { code: "USD", name: "US Dollar", symbol: "$" },
    GB: { code: "GBP", name: "British Pound", symbol: "£" },
    EU: { code: "EUR", name: "Euro", symbol: "€" },
    JP: { code: "JPY", name: "Japanese Yen", symbol: "¥" },
    CN: { code: "CNY", name: "Chinese Yuan", symbol: "¥" },
    CA: { code: "CAD", name: "Canadian Dollar", symbol: "C$" },
    AU: { code: "AUD", name: "Australian Dollar", symbol: "A$" },
    IN: { code: "INR", name: "Indian Rupee", symbol: "₹" },
    BR: { code: "BRL", name: "Brazilian Real", symbol: "R$" },
    RU: { code: "RUB", name: "Russian Ruble", symbol: "₽" },
  };

  return currencyMap[countryCode] || null;
}

function getLanguagesFromCountry(countryCode) {
  // Simplified language mapping
  const languageMap = {
    US: ["en"],
    GB: ["en"],
    CA: ["en", "fr"],
    FR: ["fr"],
    DE: ["de"],
    ES: ["es"],
    IT: ["it"],
    JP: ["ja"],
    CN: ["zh"],
    RU: ["ru"],
    BR: ["pt"],
    IN: ["hi", "en"],
    MX: ["es"],
    AR: ["es"],
    KR: ["ko"],
    NL: ["nl"],
    SE: ["sv"],
    NO: ["no"],
    DK: ["da"],
    FI: ["fi"],
  };

  return languageMap[countryCode] || [];
}
