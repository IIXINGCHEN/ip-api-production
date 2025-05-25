import { Hono } from "hono";
import { cors } from "hono/cors";
// import { logger as honoLogger } from 'hono/logger' // Replaced with custom logger
import { prettyJSON } from "hono/pretty-json";

// Import environment configuration
import {
  ENVIRONMENT,
  getCurrentConfig,
  isFeatureEnabled,
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
if (!ENVIRONMENT.isProduction() || isFeatureEnabled("debug")) {
  app.use("*", logger());
}

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
