import { SECURITY_CONFIG } from "../config/security.js";
import { isFeatureEnabled } from "../config/environment.js";

export const securityMiddleware = async (c, next) => {
  // Add security headers only if enabled in current environment
  if (isFeatureEnabled("securityHeaders")) {
    Object.entries(SECURITY_CONFIG.headers).forEach(([key, value]) => {
      c.header(key, value);
    });
  }

  // Get client IP - try multiple methods for Cloudflare Workers
  let clientIP = getClientIP(c.req);

  // Alternative method: check if we can get IP from the request directly
  if (clientIP === "127.0.0.1" && c.req.cf) {
    // In some cases, the IP might be available in the cf object
    clientIP = c.req.cf.ip || clientIP;
  }

  c.set("clientIP", clientIP);

  // IP whitelist check
  if (SECURITY_CONFIG.ipWhitelist.length > 0) {
    if (!SECURITY_CONFIG.ipWhitelist.includes(clientIP)) {
      return c.json(
        {
          error: "Forbidden",
          message: "IP address not allowed",
          timestamp: new Date().toISOString(),
        },
        403,
      );
    }
  }

  // Check blocked IP patterns
  for (const pattern of SECURITY_CONFIG.blockedPatterns) {
    if (clientIP.match(pattern)) {
      return c.json(
        {
          error: "Forbidden",
          message: "IP address blocked",
          timestamp: new Date().toISOString(),
        },
        403,
      );
    }
  }

  // Threat detection is handled by the dedicated ThreatService
  // Set empty threat info for now - will be populated by services if needed
  c.set("threatInfo", null);

  await next();
};

function getClientIP(req) {
  // In Cloudflare Workers, the real client IP is in cf-connecting-ip header
  return (
    req.header("cf-connecting-ip") ||
    req.header("cf-connecting-ipv6") ||
    req.header("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.header("x-real-ip") ||
    req.header("x-client-ip") ||
    "127.0.0.1"
  );
}
