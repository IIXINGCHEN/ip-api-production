import { generateSecureRequestId } from "./security.js";

export function formatIPResponse(ipInfo, options = {}) {
  const {
    format = "text",
    includeThreatInfo = false,
    threatInfo = null,
  } = options;

  if (format === "json") {
    // Determine IP version
    const ipVersion = ipInfo.ip && ipInfo.ip.includes(":") ? "ipv6" : "ipv4";

    const response = {
      ip: ipInfo.ip,
      [ipVersion]: ipInfo.ip,
      type: ipInfo.type,
      version: ipInfo.version,
      isPrivate: ipInfo.isPrivate,
      isLoopback: ipInfo.isLoopback,
      timestamp: new Date().toISOString(),
      requestId: generateRequestId(),
    };

    if (includeThreatInfo && threatInfo) {
      // Format threat info for simplified response
      response.threat = {
        suspicious: threatInfo.riskScore > 20,
        isVPN: threatInfo.isVPN || false,
        isProxy: threatInfo.isProxy || false,
        isTor: threatInfo.isTor || false,
        riskScore: threatInfo.riskScore || 0,
      };
    }

    return response;
  }

  // Default text format - just return the IP
  return ipInfo.ip || ipInfo;
}

export function formatGeoResponse(geoInfo, options = {}) {
  const {
    format = "json",
    fields = null,
    includeThreatInfo = false,
    threatInfo = null,
  } = options;

  // Determine IP version
  const ipVersion = geoInfo.ip && geoInfo.ip.includes(":") ? "ipv6" : "ipv4";

  // Extract and clean data with proper fallbacks
  const countryName = geoInfo.country || getCountryNameFromCode(geoInfo.countryCode);
  const regionName = geoInfo.region || geoInfo.countryRegion;
  const cityName = geoInfo.city;
  const asnNumber = extractASNNumber(geoInfo.asOrganization || geoInfo.asn);
  const ispName = extractISPName(geoInfo.asOrganization || geoInfo.isp || geoInfo.organization);

  // Create clean response with clear field naming and backward compatibility
  let response = {
    // IP Information
    ip: geoInfo.ip,
    [ipVersion]: geoInfo.ip,

    // Geographic Information
    flag: geoInfo.flag,
    country: geoInfo.countryCode,                    // Backward compatibility
    countryName: countryName,                        // Clear country name
    countryRegion: countryName,                      // Backward compatibility
    region: regionName || "Unknown",                 // Fixed: actual geographic region
    regionName: regionName,                          // Clear region name
    city: cityName,                                  // Backward compatibility
    cityName: cityName,                              // Clear city name

    // Coordinate Information
    latitude: geoInfo.latitude ? geoInfo.latitude.toString() : null,
    longitude: geoInfo.longitude ? geoInfo.longitude.toString() : null,
    timezone: geoInfo.timezone,

    // Network Information
    asOrganization: geoInfo.asOrganization || geoInfo.isp,  // Backward compatibility
    asn: asnNumber,                                  // Clear ASN number
    isp: ispName,                                    // Clear ISP name

    // Infrastructure Information
    datacenter: geoInfo.colo || geoInfo.datacenter, // Data center code
    colo: geoInfo.colo,                             // Cloudflare data center

    // Metadata
    timestamp: new Date().toISOString(),
    requestId: generateRequestId(),
  };

  // Remove null values for cleaner output
  Object.keys(response).forEach((key) => {
    if (response[key] === null || response[key] === undefined) {
      delete response[key];
    }
  });

  // Filter fields if specified
  if (fields && Array.isArray(fields)) {
    const filtered = { ip: geoInfo.ip };
    fields.forEach((field) => {
      if (response[field] !== undefined) {
        filtered[field] = response[field];
      }
    });
    response = filtered;
  }

  // Add threat information if requested
  if (includeThreatInfo && threatInfo) {
    response.threat = threatInfo;
  }

  switch (format) {
    case "xml":
      return formatAsXML(response);
    case "csv":
      return formatAsCSV(response);
    case "json":
    default:
      return response;
  }
}

function formatAsXML(data) {
  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<response>\n';

  function addElement(key, value, indent = "  ") {
    if (value === null || value === undefined) {
      return "";
    }

    if (typeof value === "object" && !Array.isArray(value)) {
      xml += `${indent}<${key}>\n`;
      Object.entries(value).forEach(([k, v]) => {
        addElement(k, v, indent + "  ");
      });
      xml += `${indent}</${key}>\n`;
    } else if (Array.isArray(value)) {
      xml += `${indent}<${key}>\n`;
      value.forEach((item, index) => {
        addElement(`item_${index}`, item, indent + "  ");
      });
      xml += `${indent}</${key}>\n`;
    } else {
      const escapedValue = String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;");
      xml += `${indent}<${key}>${escapedValue}</${key}>\n`;
    }
  }

  Object.entries(data).forEach(([key, value]) => {
    addElement(key, value);
  });

  xml += "</response>";
  return xml;
}

function formatAsCSV(data) {
  const flatData = flattenObject(data);
  const headers = Object.keys(flatData);
  const values = Object.values(flatData);

  // Escape CSV values
  const escapedValues = values.map((value) => {
    if (value === null || value === undefined) {
      return "";
    }
    const str = String(value);
    if (str.includes(",") || str.includes('"') || str.includes("\n")) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  });

  return `${headers.join(",")}\n${escapedValues.join(",")}`;
}

function flattenObject(obj, prefix = "") {
  const flattened = {};

  Object.keys(obj).forEach((key) => {
    const value = obj[key];
    const newKey = prefix ? `${prefix}_${key}` : key;

    if (value === null || value === undefined) {
      flattened[newKey] = "";
    } else if (typeof value === "object" && !Array.isArray(value)) {
      Object.assign(flattened, flattenObject(value, newKey));
    } else if (Array.isArray(value)) {
      flattened[newKey] = value.join(";");
    } else {
      flattened[newKey] = value;
    }
  });

  return flattened;
}

export function formatErrorResponse(error, statusCode = 500) {
  return {
    error: getErrorName(statusCode),
    message: error.message || "An unexpected error occurred",
    statusCode,
    timestamp: new Date().toISOString(),
  };
}

function getErrorName(statusCode) {
  const errorNames = {
    400: "Bad Request",
    401: "Unauthorized",
    403: "Forbidden",
    404: "Not Found",
    429: "Too Many Requests",
    500: "Internal Server Error",
    502: "Bad Gateway",
    503: "Service Unavailable",
    504: "Gateway Timeout",
  };

  return errorNames[statusCode] || "Unknown Error";
}

export function validateIPAddress(ip) {
  if (!ip || typeof ip !== "string") {
    return { valid: false, error: "IP address is required" };
  }

  // IPv4 regex
  const ipv4Regex =
    /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;

  // IPv6 regex (simplified)
  const ipv6Regex = /^(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$|^::1$|^::$/;

  if (ipv4Regex.test(ip)) {
    return { valid: true, version: 4 };
  }

  if (ipv6Regex.test(ip)) {
    return { valid: true, version: 6 };
  }

  return { valid: false, error: "Invalid IP address format" };
}

export function sanitizeInput(input) {
  if (typeof input !== "string") {
    return input;
  }

  // Remove potentially dangerous characters
  return input
    .replace(/[<>]/g, "") // Remove angle brackets
    .replace(/javascript:/gi, "") // Remove javascript: protocol
    .replace(/on\w+=/gi, "") // Remove event handlers
    .trim();
}

export function generateRequestId() {
  // Use the secure request ID generator from security utils
  return generateSecureRequestId();
}

export function calculateResponseTime(startTime) {
  return Date.now() - startTime;
}

export function addResponseMetadata(response, metadata = {}) {
  return {
    ...response,
    metadata: {
      requestId: metadata.requestId || generateRequestId(),
      responseTime: metadata.responseTime || 0,
      timestamp: new Date().toISOString(),
      version: "2.0.0",
      ...metadata,
    },
  };
}

// Helper functions for data extraction and cleaning

function getCountryNameFromCode(countryCode) {
  // Basic country code to name mapping
  const countryNames = {
    'US': 'United States',
    'CN': 'China',
    'TW': 'Taiwan',
    'JP': 'Japan',
    'KR': 'South Korea',
    'GB': 'United Kingdom',
    'DE': 'Germany',
    'FR': 'France',
    'CA': 'Canada',
    'AU': 'Australia',
    'IN': 'India',
    'BR': 'Brazil',
    'RU': 'Russia',
    'SG': 'Singapore',
    'HK': 'Hong Kong',
    'NL': 'Netherlands',
    'SE': 'Sweden',
    'NO': 'Norway',
    'DK': 'Denmark',
    'FI': 'Finland',
    // Add more as needed
  };

  return countryNames[countryCode] || countryCode;
}

function extractASNNumber(asnString) {
  if (!asnString) return null;

  // Extract ASN number from strings like "AS15169" or "AS15169 Google LLC"
  const match = asnString.toString().match(/AS(\d+)/i);
  return match ? `AS${match[1]}` : null;
}

function extractISPName(orgString) {
  if (!orgString) return null;

  // Remove ASN prefix if present
  const cleaned = orgString.toString().replace(/^AS\d+\s*/i, '');
  return cleaned || null;
}
