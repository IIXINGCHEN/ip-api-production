/**
 * 🚨 统一错误处理系统（瘦身版）
 *
 * 仅保留活跃使用的：ERROR_TYPES / ERROR_SEVERITY / AppError / ErrorFactory。
 * 已移除死代码：ErrorLogger、ErrorRecovery、errorLogger、logError、createErrorResponse、
 * formatErrorResponse、wrapWithErrorHandling、handleAsyncError、withErrorHandlingDecorator、
 * createErrorHandler（共 ~360 行，0 外部引用）。
 *
 * AppError.toResponse() 已对齐 RESTful 统一信封 {error, meta:{apiVersion, processingTimeMs}}。
 */

import { ENVIRONMENT } from '../config/environment.js';

// 🔧 错误类型定义
export const ERROR_TYPES = {
  // 客户端错误 (4xx)
  BAD_REQUEST: {
    code: 'BAD_REQUEST', status: 400, message: 'Invalid request', category: 'client'
  },
  UNAUTHORIZED: {
    code: 'UNAUTHORIZED', status: 401, message: 'Authentication required', category: 'client'
  },
  FORBIDDEN: {
    code: 'FORBIDDEN', status: 403, message: 'Access forbidden', category: 'client'
  },
  NOT_FOUND: {
    code: 'RESOURCE_NOT_FOUND', status: 404,
    message: 'The requested resource was not found', category: 'client'
  },
  METHOD_NOT_ALLOWED: {
    code: 'METHOD_NOT_ALLOWED', status: 405, message: 'Method not allowed', category: 'client'
  },
  CONFLICT: {
    code: 'CONFLICT', status: 409, message: 'Resource conflict', category: 'client'
  },
  PAYLOAD_TOO_LARGE: {
    code: 'PAYLOAD_TOO_LARGE', status: 413, message: 'Request payload too large', category: 'client'
  },
  UNSUPPORTED_MEDIA_TYPE: {
    code: 'UNSUPPORTED_MEDIA_TYPE', status: 415, message: 'Unsupported media type', category: 'client'
  },
  TOO_MANY_REQUESTS: {
    code: 'RATE_LIMIT_EXCEEDED', status: 429, message: 'Too many requests', category: 'client'
  },
  REQUEST_TIMEOUT: {
    code: 'REQUEST_TIMEOUT', status: 408, message: 'Request timeout', category: 'client'
  },

  // 服务器错误 (5xx)
  INTERNAL_ERROR: {
    code: 'INTERNAL_ERROR', status: 500, message: 'Internal server error', category: 'server'
  },
  NOT_IMPLEMENTED: {
    code: 'NOT_IMPLEMENTED', status: 501, message: 'Feature not implemented', category: 'server'
  },
  BAD_GATEWAY: {
    code: 'BAD_GATEWAY', status: 502, message: 'Bad gateway', category: 'server'
  },
  SERVICE_UNAVAILABLE: {
    code: 'SERVICE_UNAVAILABLE', status: 503,
    message: 'Service temporarily unavailable', category: 'server'
  },
  GATEWAY_TIMEOUT: {
    code: 'GATEWAY_TIMEOUT', status: 504, message: 'Gateway timeout', category: 'server'
  },

  // 业务逻辑错误
  INVALID_IP: {
    code: 'INVALID_IP', status: 400, message: 'Invalid IP address format', category: 'business'
  },
  GEOLOCATION_ERROR: {
    code: 'GEOLOCATION_ERROR', status: 500,
    message: 'Failed to retrieve geolocation information', category: 'business'
  },
  THREAT_DETECTION_ERROR: {
    code: 'THREAT_DETECTION_ERROR', status: 500,
    message: 'Threat detection service unavailable', category: 'business'
  },
  CACHE_ERROR: {
    code: 'CACHE_ERROR', status: 500, message: 'Cache service error', category: 'infrastructure'
  },
  CONFIGURATION_ERROR: {
    code: 'CONFIGURATION_ERROR', status: 500, message: 'Configuration error', category: 'infrastructure'
  },
  EXTERNAL_SERVICE_ERROR: {
    code: 'EXTERNAL_SERVICE_ERROR', status: 502,
    message: 'External service error', category: 'infrastructure'
  },

  // 安全相关错误
  SECURITY_VIOLATION: {
    code: 'SECURITY_VIOLATION', status: 403,
    message: 'Security policy violation', category: 'security'
  },
  MALICIOUS_REQUEST: {
    code: 'MALICIOUS_REQUEST', status: 400,
    message: 'Malicious request detected', category: 'security'
  }
};

export const ERROR_SEVERITY = {
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
  CRITICAL: 'critical'
};

/**
 * 🏗️ 统一错误类
 */
export class AppError extends Error {
  constructor(type, message = null, details = null, cause = null, requestId = null) {
    super(message || type.message);

    this.name = 'AppError';
    this.type = type;
    this.code = type.code;
    this.status = type.status;
    this.category = type.category;
    this.message = message || type.message;
    this.details = details;
    this.cause = cause;
    this.requestId = requestId;
    this.timestamp = new Date().toISOString();
    this.severity = this.determineSeverity(type);
  }

  determineSeverity(type) {
    if (!type || typeof type.status === 'undefined') {
      return ERROR_SEVERITY.MEDIUM;
    }
    const severityMap = {
      [ERROR_TYPES.INTERNAL_ERROR.status]: ERROR_SEVERITY.HIGH,
      [ERROR_TYPES.SERVICE_UNAVAILABLE.status]: ERROR_SEVERITY.HIGH,
      [ERROR_TYPES.BAD_GATEWAY.status]: ERROR_SEVERITY.MEDIUM,
      [ERROR_TYPES.GATEWAY_TIMEOUT.status]: ERROR_SEVERITY.MEDIUM,
      [ERROR_TYPES.TOO_MANY_REQUESTS.status]: ERROR_SEVERITY.MEDIUM,
      [ERROR_TYPES.SECURITY_VIOLATION.status]: ERROR_SEVERITY.HIGH,
      [ERROR_TYPES.MALICIOUS_REQUEST.status]: ERROR_SEVERITY.HIGH,
      [ERROR_TYPES.REQUEST_TIMEOUT.status]: ERROR_SEVERITY.MEDIUM,
      [ERROR_TYPES.CONFIGURATION_ERROR.status]: ERROR_SEVERITY.HIGH
    };
    return severityMap[type.status] || ERROR_SEVERITY.LOW;
  }

  getSanitizedDetails() {
    if (!this.details) return null;
    if (ENVIRONMENT.isProduction()) {
      return this.sanitizeForProduction(this.details);
    }
    return this.details;
  }

  sanitizeForProduction(details) {
    if (typeof details !== 'object' || details === null) {
      return details;
    }
    const sanitized = {};
    for (const [key, value] of Object.entries(details)) {
      if (this.isSensitiveField(key)) continue;
      sanitized[key] = typeof value === 'string' ? this.sanitizeString(value) : value;
    }
    return sanitized;
  }

  isSensitiveField(key) {
    const sensitiveFields = [
      'password', 'token', 'key', 'secret', 'credential',
      'authorization', 'auth', 'session', 'cookie',
      'ip', 'userAgent', 'email', 'phone', 'address'
    ];
    return sensitiveFields.includes(key.toLowerCase());
  }

  sanitizeString(str) {
    if (typeof str !== 'string') return str;
    return str
      .replace(/[<>\"'&]/g, '')
      .replace(/[\x00-\x1F\x7F]/g, '')
      .trim()
      .substring(0, 1000);
  }

  /**
   * 创建 HTTP 响应体（统一 RESTful 信封 {error, meta}）
   */
  toResponse() {
    return {
      error: {
        code: this.code,
        message: this.message,
        details: this.getSanitizedDetails()
      },
      meta: {
        requestId: this.requestId,
        timestamp: this.timestamp,
        apiVersion: 'v1',
        processingTimeMs: 0
      }
    };
  }
}

/**
 * 🎯 错误工厂类
 */
export class ErrorFactory {
  static create(type, message = null, details = null, cause = null, requestId = null) {
    return new AppError(type, message, details, cause, requestId);
  }

  static client(type, message = null, details = null, cause = null, requestId = null) {
    const errorType = ERROR_TYPES[type] || ERROR_TYPES.BAD_REQUEST;
    return new AppError(errorType, message, details, cause, requestId);
  }

  static server(type, message = null, details = null, cause = null, requestId = null) {
    const errorType = ERROR_TYPES[type] || ERROR_TYPES.INTERNAL_ERROR;
    return new AppError(errorType, message, details, cause, requestId);
  }

  static business(type, message = null, details = null, cause = null, requestId = null) {
    const errorType = ERROR_TYPES[type] || ERROR_TYPES.INVALID_IP;
    return new AppError(errorType, message, details, cause, requestId);
  }

  static infrastructure(type, message = null, details = null, cause = null, requestId = null) {
    const errorType = ERROR_TYPES[type] || ERROR_TYPES.CONFIGURATION_ERROR;
    return new AppError(errorType, message, details, cause, requestId);
  }

  static security(type, message = null, details = null, cause = null, requestId = null) {
    const errorType = ERROR_TYPES[type] || ERROR_TYPES.SECURITY_VIOLATION;
    return new AppError(errorType, message, details, cause, requestId);
  }

  static fromError(error, requestId = null) {
    if (error instanceof AppError) {
      return error;
    }
    let errorType = ERROR_TYPES.INTERNAL_ERROR;
    if (error.name === 'ValidationError') {
      errorType = ERROR_TYPES.BAD_REQUEST;
    } else if (error.name === 'TimeoutError') {
      errorType = ERROR_TYPES.REQUEST_TIMEOUT;
    } else if (error.code) {
      errorType = this.findErrorTypeByCode(error.code) || ERROR_TYPES.INTERNAL_ERROR;
    }
    if (!errorType) {
      errorType = ERROR_TYPES.INTERNAL_ERROR;
    }
    return new AppError(errorType, error.message, null, error, requestId);
  }

  static findErrorTypeByCode(code) {
    for (const type of Object.values(ERROR_TYPES)) {
      if (type.code === code) {
        return type;
      }
    }
    return null;
  }
}

export default {
  AppError,
  ErrorFactory,
  ERROR_TYPES,
  ERROR_SEVERITY
};
