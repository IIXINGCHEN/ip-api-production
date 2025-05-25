export const SECURITY_CONFIG = {
  // Rate limiting configuration
  rateLimit: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // limit each IP to 100 requests per windowMs
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      error: "Too Many Requests",
      message: "Rate limit exceeded. Please try again later.",
      retryAfter: 900, // 15 minutes in seconds
    },
  },

  // API key configuration
  apiKey: {
    required: false, // Set to true to require API keys for all requests
    header: "X-API-Key",
    adminRequired: true, // Admin endpoints always require API key
  },

  // CORS configuration - moved to environment.js for centralized management
  // This section is deprecated - use environment-specific CORS configuration

  // Security headers
  headers: {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "X-XSS-Protection": "1; mode=block",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Content-Security-Policy": "default-src 'self'",
    "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  },

  // IP whitelist (empty means all IPs allowed)
  ipWhitelist: [],

  // Blocked IP patterns
  blockedPatterns: [
    // Add patterns for known malicious IPs or ranges
  ],

  // Threat detection
  threatDetection: {
    enabled: true,
    checkVPN: true,
    checkProxy: true,
    checkTor: true,
    blockSuspicious: false, // Set to true to block suspicious IPs
  },
};

export const CACHE_CONFIG = {
  // Cache TTL in seconds
  ttl: {
    ip: 300, // 5 minutes
    geo: 3600, // 1 hour
    threat: 1800, // 30 minutes
  },

  // Cache keys
  keys: {
    ip: (ip) => `ip:${ip}`,
    geo: (ip) => `geo:${ip}`,
    threat: (ip) => `threat:${ip}`,
  },
};

export const PROVIDERS_CONFIG = {
  // Data provider priorities (higher number = higher priority)
  priorities: {
    cloudflare: 100,
    maxmind: 80,
    ipinfo: 60,
    fallback: 10,
  },

  // Provider endpoints and configurations
  endpoints: {
    ipinfo: {
      url: "https://ipinfo.io",
      token: globalThis.IPINFO_TOKEN || null,
      timeout: 5000,
    },
    maxmind: {
      url: "https://geoip.maxmind.com",
      userId: globalThis.MAXMIND_USER_ID || null,
      licenseKey: globalThis.MAXMIND_LICENSE_KEY || null,
      timeout: 5000,
    },
  },
};
