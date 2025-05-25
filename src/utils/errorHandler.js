/**
 * Unified Error Handling System
 * Centralized error handling with security-aware error responses
 */

import { ENVIRONMENT } from "../config/environment.js";
import { generateSecureRequestId } from "./security.js";

// Error types and their corresponding HTTP status codes
export const ERROR_TYPES = {
  VALIDATION_ERROR: { code: 400, type: "ValidationError" },
  AUTHENTICATION_ERROR: { code: 401, type: "AuthenticationError" },
  AUTHORIZATION_ERROR: { code: 403, type: "AuthorizationError" },
  NOT_FOUND_ERROR: { code: 404, type: "NotFoundError" },
  RATE_LIMIT_ERROR: { code: 429, type: "RateLimitError" },
  INTERNAL_ERROR: { code: 500, type: "InternalError" },
  SERVICE_UNAVAILABLE: { code: 503, type: "ServiceUnavailableError" },
  TIMEOUT_ERROR: { code: 504, type: "TimeoutError" },
};

// Custom error classes
export class APIError extends Error {
  constructor(message, type = ERROR_TYPES.INTERNAL_ERROR, details = {}) {
    super(message);
    this.name = "APIError";
    this.type = type.type;
    this.statusCode = type.code;
    this.details = details;
    this.timestamp = new Date().toISOString();
    this.requestId = generateSecureRequestId();
  }
}

export class ValidationError extends APIError {
  constructor(message, field = null, value = null) {
    super(message, ERROR_TYPES.VALIDATION_ERROR, { field, value });
    this.name = "ValidationError";
  }
}

export class AuthenticationError extends APIError {
  constructor(message = "Authentication required") {
    super(message, ERROR_TYPES.AUTHENTICATION_ERROR);
    this.name = "AuthenticationError";
  }
}

export class AuthorizationError extends APIError {
  constructor(message = "Insufficient permissions") {
    super(message, ERROR_TYPES.AUTHORIZATION_ERROR);
    this.name = "AuthorizationError";
  }
}

export class RateLimitError extends APIError {
  constructor(message = "Rate limit exceeded", retryAfter = 900) {
    super(message, ERROR_TYPES.RATE_LIMIT_ERROR, { retryAfter });
    this.name = "RateLimitError";
  }
}

export class ServiceUnavailableError extends APIError {
  constructor(message = "Service temporarily unavailable", service = null) {
    super(message, ERROR_TYPES.SERVICE_UNAVAILABLE, { service });
    this.name = "ServiceUnavailableError";
  }
}

// Unified error handler middleware
export const errorHandlerMiddleware = async (error, c) => {
  // Log error for monitoring (with sensitive data filtering)
  logError(error, c);

  // Handle different error types
  if (error instanceof APIError) {
    return handleAPIError(error, c);
  }

  // Handle validation errors from Zod or other validators
  if (error.name === "ZodError") {
    return handleValidationError(error, c);
  }

  // Handle timeout errors
  if (error.name === "TimeoutError" || error.code === "TIMEOUT") {
    return handleTimeoutError(error, c);
  }

  // Handle network/fetch errors
  if (error.name === "TypeError" && error.message.includes("fetch")) {
    return handleNetworkError(error, c);
  }

  // Handle unknown errors
  return handleUnknownError(error, c);
};

// Handle API errors
function handleAPIError(error, c) {
  const response = {
    error: error.type,
    message: error.message,
    timestamp: error.timestamp,
    requestId: error.requestId,
  };

  // Add details in non-production environments
  if (!ENVIRONMENT.isProduction() && error.details) {
    response.details = error.details;
  }

  // Add retry-after header for rate limit errors
  if (error instanceof RateLimitError) {
    c.header("Retry-After", error.details.retryAfter.toString());
  }

  return c.json(response, error.statusCode);
}

// Handle validation errors
function handleValidationError(error, c) {
  const validationError = new ValidationError(
    "Validation failed",
    error.issues?.[0]?.path?.join("."),
    error.issues?.[0]?.received,
  );

  const response = {
    error: validationError.type,
    message: validationError.message,
    timestamp: validationError.timestamp,
    requestId: validationError.requestId,
  };

  // Add validation details in non-production
  if (!ENVIRONMENT.isProduction() && error.issues) {
    response.details = {
      issues: error.issues.map((issue) => ({
        field: issue.path?.join("."),
        message: issue.message,
        received: issue.received,
      })),
    };
  }

  return c.json(response, validationError.statusCode);
}

// Handle timeout errors
function handleTimeoutError(error, c) {
  const timeoutError = new APIError(
    "Request timeout",
    ERROR_TYPES.TIMEOUT_ERROR,
    { originalError: error.message },
  );

  return handleAPIError(timeoutError, c);
}

// Handle network errors
function handleNetworkError(error, c) {
  const networkError = new ServiceUnavailableError(
    "External service unavailable",
    "network",
  );

  return handleAPIError(networkError, c);
}

// Handle unknown errors
function handleUnknownError(error, c) {
  const unknownError = new APIError(
    ENVIRONMENT.isProduction() ? "Internal server error" : error.message,
    ERROR_TYPES.INTERNAL_ERROR,
    ENVIRONMENT.isProduction() ? {} : { originalError: error.message },
  );

  return handleAPIError(unknownError, c);
}

// Secure error logging
function logError(error, c) {
  const logData = {
    error: {
      name: error.name,
      message: error.message,
      type: error.type || "Unknown",
    },
    request: {
      method: c.req.method,
      path: c.req.path,
      userAgent: c.req.header("user-agent"),
      clientIP: c.get("clientIP"),
      timestamp: new Date().toISOString(),
    },
  };

  // Add stack trace in non-production
  if (!ENVIRONMENT.isProduction() && error.stack) {
    logData.error.stack = error.stack;
  }

  // Filter sensitive data before logging
  const filteredData = filterSensitiveLogData(logData);

  // Use structured logging instead of console.error
  if (typeof globalThis.logger !== "undefined") {
    globalThis.logger.error("Application error occurred", filteredData);
  } else {
    // Fallback to console if logger not available (development only)
    if (!ENVIRONMENT.isProduction()) {
      // eslint-disable-next-line no-console
      console.error("[ERROR]", JSON.stringify(filteredData, null, 2));
    }
  }
}

// Filter sensitive data from logs
function filterSensitiveLogData(data) {
  const sensitiveHeaders = ["authorization", "x-api-key", "cookie"];
  const filtered = JSON.parse(JSON.stringify(data));

  // Remove sensitive headers
  if (filtered.request && filtered.request.headers) {
    for (const header of sensitiveHeaders) {
      if (filtered.request.headers[header]) {
        filtered.request.headers[header] = "[REDACTED]";
      }
    }
  }

  return filtered;
}

// Helper function to create standardized error responses
export function createErrorResponse(type, message, details = {}) {
  return new APIError(message, type, details);
}

// Helper function for async error handling
export function asyncErrorHandler(fn) {
  return async (c, next) => {
    try {
      await fn(c, next);
    } catch (_error) {
      return errorHandlerMiddleware(error, c);
    }
  };
}

// Validation helper
export function validateRequired(value, fieldName) {
  if (value === undefined || value === null || value === "") {
    throw new ValidationError(`${fieldName} is required`, fieldName, value);
  }
}

// IP validation helper
export function validateIPAddress(ip, fieldName = "ip") {
  if (!ip || typeof ip !== "string") {
    throw new ValidationError(
      `${fieldName} must be a valid string`,
      fieldName,
      ip,
    );
  }

  // Basic IP format validation
  const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/;
  const ipv6Regex = /^([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$/;

  if (!ipv4Regex.test(ip) && !ipv6Regex.test(ip)) {
    throw new ValidationError(
      `${fieldName} must be a valid IP address`,
      fieldName,
      ip,
    );
  }
}
