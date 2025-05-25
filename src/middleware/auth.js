import { SECURITY_CONFIG } from "../config/security.js";
import { validateApiKey as validateApiKeyUtil } from "../utils/security.js";

// Rate limiting for API key attempts
const apiKeyAttempts = new Map();

export const authMiddleware = async (c, next) => {
  const path = c.req.path;
  const isAdminPath = path.startsWith("/admin");
  const clientIP = c.get("clientIP") || "127.0.0.1";

  // Check if API key is required
  const requiresAuth =
    SECURITY_CONFIG.apiKey.required ||
    (isAdminPath && SECURITY_CONFIG.apiKey.adminRequired);

  if (requiresAuth) {
    // Check rate limiting for API key attempts
    const attemptKey = `${clientIP}:auth`;
    const attempts = apiKeyAttempts.get(attemptKey) || {
      count: 0,
      lastAttempt: 0,
    };
    const now = Date.now();

    // Reset attempts after 15 minutes
    if (now - attempts.lastAttempt > 15 * 60 * 1000) {
      attempts.count = 0;
    }

    // Block if too many failed attempts
    if (attempts.count >= 5) {
      return c.json(
        {
          error: "Too Many Requests",
          message: "Too many authentication attempts. Please try again later.",
          timestamp: new Date().toISOString(),
          retryAfter: 900, // 15 minutes
        },
        429,
      );
    }

    const apiKey = c.req.header(SECURITY_CONFIG.apiKey.header);

    if (!apiKey) {
      // Record failed attempt
      attempts.count++;
      attempts.lastAttempt = now;
      apiKeyAttempts.set(attemptKey, attempts);

      return c.json(
        {
          error: "Unauthorized",
          message: "API key required",
          timestamp: new Date().toISOString(),
        },
        401,
      );
    }

    // Validate API key format first
    const keyValidation = validateApiKeyUtil(apiKey);
    if (!keyValidation.valid) {
      // Record failed attempt
      attempts.count++;
      attempts.lastAttempt = now;
      apiKeyAttempts.set(attemptKey, attempts);

      return c.json(
        {
          error: "Unauthorized",
          message: "Invalid API key format",
          timestamp: new Date().toISOString(),
        },
        401,
      );
    }

    // Validate API key against stored keys
    const keyInfo = await validateApiKey(keyValidation.sanitized, clientIP);
    if (!keyInfo.valid) {
      // Record failed attempt
      attempts.count++;
      attempts.lastAttempt = now;
      apiKeyAttempts.set(attemptKey, attempts);

      return c.json(
        {
          error: "Unauthorized",
          message: keyInfo.error || "Invalid API key",
          timestamp: new Date().toISOString(),
        },
        401,
      );
    }

    // Reset attempts on successful authentication
    apiKeyAttempts.delete(attemptKey);

    // Store API key info in context
    c.set("apiKey", keyValidation.sanitized);
    c.set("apiKeyInfo", keyInfo);
    c.set("authenticated", true);
  }

  await next();
};

async function validateApiKey(apiKey, clientIP) {
  try {
    // Get valid keys from environment
    const validKeys = {
      admin: globalThis.API_KEY_ADMIN,
      user: globalThis.API_KEY_USER,
    };

    // Check if key exists and is valid
    let keyType = null;
    let isValid = false;

    if (validKeys.admin && apiKey === validKeys.admin) {
      keyType = "admin";
      isValid = true;
    } else if (validKeys.user && apiKey === validKeys.user) {
      keyType = "user";
      isValid = true;
    }

    if (!isValid) {
      return {
        valid: false,
        error: "Invalid API key",
      };
    }

    // Additional security checks could be added here:
    // - Key expiration
    // - IP restrictions
    // - Usage quotas
    // - Time-based restrictions

    return {
      valid: true,
      keyType,
      permissions: getKeyPermissions(keyType),
      lastUsed: new Date().toISOString(),
      clientIP,
    };
  } catch (_error) {
    return {
      valid: false,
      error: "API key validation failed",
    };
  }
}

function getKeyPermissions(keyType) {
  const permissions = {
    admin: ["read", "write", "admin", "batch"],
    user: ["read", "batch"],
  };

  return permissions[keyType] || [];
}

export const requireAuth = async (c, next) => {
  if (!c.get("authenticated")) {
    return c.json(
      {
        error: "Unauthorized",
        message: "Authentication required",
        timestamp: new Date().toISOString(),
      },
      401,
    );
  }
  await next();
};
