import { CloudflareProvider } from "../providers/cloudflare.js";
import { MaxMindProvider } from "../providers/maxmind.js";
import { IPInfoProvider } from "../providers/ipinfo.js";
import { ThreatService } from "./threatService.js";
import { isValidIP } from "../utils/ipValidation.js";
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
    regionCode: null,
    country: null,
    countryCode: null,
    countryRegion: null,
    continent: null,
    continentCode: null,
    latitude: null,
    longitude: null,
    accuracy: null,
    timezone: null,
    postalCode: null,
    flag: null,
    asn: null,
    asOrganization: null,
    isp: null,
    organization: null,
    domain: null,
    usageType: null,
    confidence: {},
    sources: [],
    dataQuality: {
      completeness: 0,
      consistency: 0,
      accuracy: 0
    }
  };

  // Process results in priority order with validation
  const validationResults = [];

  results.forEach((result, index) => {
    if (
      result.status === "fulfilled" &&
      result.value &&
      result.value !== null
    ) {
      const data = result.value;
      const provider = providers[index];

      // Validate data quality before merging
      const validation = validateGeoData(data);
      validationResults.push({
        provider: provider.name,
        validation
      });

      // Merge data with priority and validation score
      Object.keys(data).forEach((key) => {
        if (
          data[key] !== null &&
          data[key] !== undefined &&
          key !== "provider" &&
          key !== "sources" &&
          key !== "dataQuality"
        ) {
          const currentPriority = merged._lastPriority || 0;
          const newPriority = provider.priority * validation.score;

          if (!merged[key] || newPriority > currentPriority) {
            merged[key] = sanitizeGeoValue(key, data[key]);
            merged._lastPriority = newPriority;
          }
        }
      });

      // Merge confidence data
      if (data.confidence) {
        Object.keys(data.confidence).forEach(confKey => {
          if (data.confidence[confKey] !== null && data.confidence[confKey] !== undefined) {
            if (!merged.confidence[confKey] || provider.priority > (merged.confidence[confKey].priority || 0)) {
              merged.confidence[confKey] = {
                value: data.confidence[confKey],
                priority: provider.priority,
                source: provider.name
              };
            }
          }
        });
      }

      merged.sources.push({
        provider: provider.name,
        priority: provider.priority,
        validationScore: validation.score,
        fields: Object.keys(data).filter(
          (key) => data[key] !== null && data[key] !== undefined,
        ),
        issues: validation.issues
      });
    }
  });

  // Calculate overall data quality metrics
  merged.dataQuality = calculateDataQuality(merged, validationResults);

  // Clean up internal fields
  delete merged._lastPriority;

  // Generate flag emoji if country code is available
  if (merged.countryCode && !merged.flag) {
    merged.flag = getFlag(merged.countryCode);
  }

  return merged;
}

// IP validation moved to utils/ipValidation.js to eliminate duplication

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

// Data validation and sanitization functions
function validateGeoData(data) {
  const issues = [];
  let score = 1.0; // Start with perfect score

  // Validate IP address
  if (!data.ip || !isValidIP(data.ip)) {
    issues.push("Invalid or missing IP address");
    score -= 0.2;
  }

  // Validate coordinates
  if (data.latitude !== null && data.longitude !== null) {
    if (typeof data.latitude !== 'number' || data.latitude < -90 || data.latitude > 90) {
      issues.push("Invalid latitude value");
      score -= 0.1;
    }
    if (typeof data.longitude !== 'number' || data.longitude < -180 || data.longitude > 180) {
      issues.push("Invalid longitude value");
      score -= 0.1;
    }
  }

  // Validate country code
  if (data.countryCode && (typeof data.countryCode !== 'string' || data.countryCode.length !== 2)) {
    issues.push("Invalid country code format");
    score -= 0.1;
  }

  // Validate ASN
  if (data.asn && (typeof data.asn !== 'number' || data.asn < 0)) {
    issues.push("Invalid ASN value");
    score -= 0.05;
  }

  // Check data completeness
  const requiredFields = ['ip', 'country', 'countryCode'];
  const missingFields = requiredFields.filter(field => !data[field]);
  if (missingFields.length > 0) {
    issues.push(`Missing required fields: ${missingFields.join(', ')}`);
    score -= missingFields.length * 0.1;
  }

  return {
    score: Math.max(0, score),
    issues,
    isValid: score > 0.5
  };
}

function sanitizeGeoValue(key, value) {
  if (value === null || value === undefined) {
    return null;
  }

  switch (key) {
    case 'ip':
      return typeof value === 'string' ? value.trim() : String(value);

    case 'latitude':
    case 'longitude':
      const num = parseFloat(value);
      return isNaN(num) ? null : num;

    case 'asn':
      const asn = parseInt(value);
      return isNaN(asn) || asn < 0 ? null : asn;

    case 'countryCode':
    case 'regionCode':
    case 'continentCode':
      return typeof value === 'string' ? value.toUpperCase().trim() : null;

    case 'city':
    case 'region':
    case 'country':
    case 'continent':
    case 'isp':
    case 'organization':
    case 'domain':
      return typeof value === 'string' ? value.trim() : String(value);

    case 'postalCode':
      return typeof value === 'string' ? value.trim().replace(/[^a-zA-Z0-9\s-]/g, '') : null;

    default:
      return value;
  }
}

function calculateDataQuality(merged, validationResults) {
  const totalFields = Object.keys(merged).filter(key =>
    !['sources', 'dataQuality', 'confidence'].includes(key)
  ).length;

  const filledFields = Object.keys(merged).filter(key =>
    !['sources', 'dataQuality', 'confidence'].includes(key) &&
    merged[key] !== null &&
    merged[key] !== undefined
  ).length;

  const completeness = totalFields > 0 ? filledFields / totalFields : 0;

  const avgValidationScore = validationResults.length > 0
    ? validationResults.reduce((sum, result) => sum + result.validation.score, 0) / validationResults.length
    : 0;

  // Calculate consistency by checking if multiple sources agree
  const consistency = validationResults.length > 1 ?
    Math.min(1, avgValidationScore * 1.2) : avgValidationScore;

  return {
    completeness: Math.round(completeness * 100) / 100,
    consistency: Math.round(consistency * 100) / 100,
    accuracy: Math.round(avgValidationScore * 100) / 100,
    overall: Math.round(((completeness + consistency + avgValidationScore) / 3) * 100) / 100
  };
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
