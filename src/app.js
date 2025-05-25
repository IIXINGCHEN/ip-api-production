import { Hono } from "hono";
import { cors } from "hono/cors";
// import { logger as honoLogger } from 'hono/logger' // Replaced with custom logger
import { prettyJSON } from "hono/pretty-json";

// Import environment configuration
import {
  ENVIRONMENT,
  getCurrentConfig,
  validateEnvironment,
  checkSensitiveDataLogging,
} from "./config/environment.js";
import { errorHandlerMiddleware } from "./utils/errorHandler.js";
import { runSecurityScan } from "./utils/securityScanner.js";
import { logger } from "./utils/logger.js";

// Import routes
import ipRoutes from "./routes/ip.js";
import geoRoutes from "./routes/geo.js";
import adminRoutes from "./routes/admin.js";

// Import middleware
import { rateLimitMiddleware } from "./middleware/rateLimit.js";
import { cacheMiddleware } from "./middleware/cache.js";
import { securityMiddleware } from "./middleware/security.js";
import {
  monitoringMiddleware,
  getHealthStatus,
} from "./middleware/monitoring.js";

const app = new Hono();

// Validate environment configuration on startup
const envValidation = validateEnvironment();
if (!envValidation.valid) {
  logger.error("Environment validation failed", {
    errors: envValidation.errors,
  });
  if (ENVIRONMENT.isProduction()) {
    throw new Error(
      "Production environment validation failed: " +
      envValidation.errors.join(", "),
    );
  }
}

if (envValidation.warnings && envValidation.warnings.length > 0) {
  logger.warn("Environment warnings detected", {
    warnings: envValidation.warnings,
  });
}

// Runtime security check
checkSensitiveDataLogging();

// Run comprehensive security scan
const securityScanResult = runSecurityScan();

// Get environment-specific configuration
const envConfig = getCurrentConfig();

// Global middleware - conditionally applied based on environment
// Note: Hono logger removed for production security - using custom logger instead

app.use("*", prettyJSON());

// CORS configuration from environment - secure production setup
app.use(
  "*",
  cors({
    origin: envConfig.api.corsOrigins, // Use environment-specific origins only
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization", "X-API-Key"],
    exposeHeaders: ["X-Client-IP", "X-Rate-Limit-Remaining", "X-Cache-Status"],
    credentials: false, // Disable credentials for security
  }),
);

// Monitoring middleware (should be early in the chain)
app.use("*", monitoringMiddleware);

// Security middleware
app.use("*", securityMiddleware);

// Rate limiting
app.use("*", rateLimitMiddleware);

// Caching
app.use("*", cacheMiddleware);

// Root endpoint - API overview
app.get("/", (c) => {
  const host = c.req.header("host") || "localhost";
  const protocol = c.req.header("x-forwarded-proto") || "https";
  const baseUrl = `${protocol}://${host}`;

  return c.json({
    name: "IP Geolocation API",
    version: "2.0.0",
    description: "Enhanced IP geolocation API with comprehensive threat detection",
    environment: ENVIRONMENT.current,
    endpoints: {
      root: {
        path: "/",
        method: "GET",
        description: "API overview and documentation"
      },
      health: {
        path: "/health",
        method: "GET",
        description: "Health check and system status"
      },
      ipLookup: {
        path: "/lookup/{ip}",
        method: "GET",
        description: "Get geolocation data for specific IP address",
        example: `${baseUrl}/lookup/8.8.8.8`
      },
      currentIP: {
        path: "/geo",
        method: "GET",
        description: "Get geolocation data for current IP address",
        example: `${baseUrl}/geo`
      },
      batchLookup: {
        path: "/batch",
        method: "POST",
        description: "Batch IP lookup (up to 100 IPs)",
        example: `${baseUrl}/batch`
      }
    },
    documentation: `${baseUrl}/docs`,
    repository: "https://github.com/",
    timestamp: new Date().toISOString()
  });
});

// Health check endpoint with monitoring data
app.get("/health", (c) => {
  const healthData = getHealthStatus();
  return c.json({
    ...healthData,
    version: "2.0.0",
    environment: ENVIRONMENT.current,
    security: {
      scanStatus: securityScanResult.getOverallStatus(),
      score: securityScanResult.getScorePercentage(),
      lastScan:
        securityScanResult.passed[0]?.timestamp || new Date().toISOString(),
    },
  });
});

// API documentation endpoint
app.get("/docs", (c) => {
  const host = c.req.header("host") || "localhost";
  const protocol = c.req.header("x-forwarded-proto") || "https";
  const baseUrl = `${protocol}://${host}`;

  return c.json({
    name: "IP Geolocation API Documentation",
    version: "2.0.0",
    description: "Comprehensive API documentation for IP geolocation and threat detection services",
    baseUrl: baseUrl,
    endpoints: {
      overview: {
        path: "/",
        method: "GET",
        description: "API overview and basic information",
        response: "JSON object with API details and available endpoints"
      },
      health: {
        path: "/health",
        method: "GET",
        description: "Health check and system status",
        response: "JSON object with system health metrics and security status"
      },
      currentIP: {
        path: "/geo",
        method: "GET",
        description: "Get geolocation data for the current client IP address",
        parameters: {
          query: {
            format: "Response format (json, xml, csv) - default: json",
            lang: "Language code (en, zh, es, etc.) - default: en",
            fields: "Comma-separated list of fields to include",
            include_threat: "Include threat detection data (true/false) - default: false"
          }
        },
        example: `${baseUrl}/geo?format=json&include_threat=true`,
        response: "JSON object with IP geolocation and optional threat data"
      },
      ipLookup: {
        path: "/lookup/{ip}",
        method: "GET",
        description: "Get geolocation data for a specific IP address",
        parameters: {
          path: {
            ip: "IP address to lookup (IPv4 or IPv6)"
          }
        },
        example: `${baseUrl}/lookup/8.8.8.8`,
        response: "JSON object with IP geolocation data"
      },
      batchLookup: {
        path: "/batch",
        method: "POST",
        description: "Batch IP lookup for multiple addresses",
        parameters: {
          body: {
            ips: "Array of IP addresses (max 10 per request)"
          }
        },
        example: {
          url: `${baseUrl}/batch`,
          body: {
            ips: ["8.8.8.8", "1.1.1.1", "208.67.222.222"]
          }
        },
        response: "JSON object with results array containing data for each IP"
      },
      legacyJSON: {
        path: "/json",
        method: "GET",
        description: "Legacy endpoint - same as /geo but with JSON format only",
        response: "JSON object with current IP geolocation data"
      }
    },
    responseFields: {
      ip: "IP address",
      country: "Country name",
      countryCode: "ISO 3166-1 alpha-2 country code",
      region: "Region/state name",
      regionName: "Region/state full name",
      city: "City name",
      zip: "ZIP/postal code",
      lat: "Latitude coordinate",
      lon: "Longitude coordinate",
      timezone: "Timezone identifier",
      isp: "Internet Service Provider",
      org: "Organization name",
      as: "Autonomous System information",
      query: "Queried IP address",
      status: "Request status",
      requestId: "Unique request identifier",
      timestamp: "Response timestamp"
    },
    threatDetection: {
      description: "Advanced threat detection capabilities",
      fields: {
        isVPN: "VPN detection status",
        isProxy: "Proxy detection status",
        isTor: "Tor network detection",
        isDatacenter: "Datacenter hosting detection",
        riskScore: "Risk score (0-100)",
        confidence: "Detection confidence level",
        threatTypes: "Array of detected threat types"
      },
      note: "Threat detection is available on /geo endpoint with include_threat=true parameter"
    },
    authentication: {
      description: "API key authentication for admin endpoints",
      header: "X-API-Key",
      adminEndpoints: ["/admin/*"]
    },
    rateLimit: {
      description: "Rate limiting information",
      limits: "Varies by endpoint and client IP",
      headers: {
        "X-Rate-Limit-Remaining": "Remaining requests in current window"
      }
    },
    examples: {
      basicUsage: {
        description: "Get your current IP information",
        curl: `curl "${baseUrl}/geo"`,
        javascript: `fetch('${baseUrl}/geo').then(r => r.json()).then(console.log)`
      },
      specificIP: {
        description: "Lookup a specific IP address",
        curl: `curl "${baseUrl}/lookup/8.8.8.8"`,
        javascript: `fetch('${baseUrl}/lookup/8.8.8.8').then(r => r.json()).then(console.log)`
      },
      withThreatDetection: {
        description: "Include threat detection data",
        curl: `curl "${baseUrl}/geo?include_threat=true"`,
        javascript: `fetch('${baseUrl}/geo?include_threat=true').then(r => r.json()).then(console.log)`
      },
      batchLookup: {
        description: "Lookup multiple IPs at once",
        curl: `curl -X POST "${baseUrl}/batch" -H "Content-Type: application/json" -d '{"ips":["8.8.8.8","1.1.1.1"]}'`,
        javascript: `fetch('${baseUrl}/batch', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ips: ['8.8.8.8', '1.1.1.1']})}).then(r => r.json()).then(console.log)`
      }
    },
    links: {
      repository: "https://github.com/",
      issues: "https://github.com/issues",
      readme: "https://github.com/#readme"
    },
    timestamp: new Date().toISOString()
  });
});

// API routes
app.route("/", ipRoutes);
app.route("/", geoRoutes);
app.route("/admin", adminRoutes);

// 404 handler - secure version with minimal information exposure
app.notFound((c) => {
  const isProduction = ENVIRONMENT.isProduction();

  const response = {
    error: "Not Found",
    message: "The requested resource was not found",
    timestamp: new Date().toISOString(),
  };

  // Only provide additional information in non-production environments
  if (!isProduction) {
    const host = c.req.header("host") || "localhost";
    response.docs = `https://${host}/docs`;
    response.hint = "Check the API documentation for available endpoints";
  }

  return c.json(response, 404);
});

// Error handler with unified error handling system
app.onError(errorHandlerMiddleware);

export default app;
