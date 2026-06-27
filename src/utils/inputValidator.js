/**
 * 🔒 统一输入验证系统
 * 提供全面的数据验证、清理和安全检查功能
 */

import { z } from 'zod';
import { ERROR_TYPES, ErrorFactory } from './errorHandler.js';

/**
 * 🎯 验证器基础配置
 */
export const VALIDATOR_CONFIG = {
  // 字符串验证配置
  STRING: {
    MIN_LENGTH: 1,
    MAX_LENGTH: 10000,
    TRIM_WHITESPACE: true,
    NORMALIZE_UNICODE: true
  },

  // IP地址验证配置
  IP: {
    ALLOW_PRIVATE: false,
    ALLOW_RESERVED: false,
    ALLOW_MULTICAST: false,
    STRICT_MODE: true
  },

  // 数值验证配置
  NUMBER: {
    MIN_VALUE: Number.MIN_SAFE_INTEGER,
    MAX_VALUE: Number.MAX_SAFE_INTEGER,
    ALLOW_FLOAT: true,
    ALLOW_NEGATIVE: true
  },

  // 数组验证配置
  ARRAY: {
    MIN_SIZE: 0,
    MAX_SIZE: 1000,
    ALLOW_EMPTY: true
  },

  // 对象验证配置
  OBJECT: {
    MAX_DEPTH: 10,
    MAX_KEYS: 100,
    ALLOW_EMPTY: true
  }
};

/**
 * 🏗️ 验证错误类
 */
export class ValidationError extends Error {
  constructor(field, message, value, constraint) {
    super(message);
    this.name = 'ValidationError';
    this.field = field;
    this.message = message;
    this.value = value;
    this.constraint = constraint;
    this.timestamp = new Date().toISOString();
  }

  toJSON() {
    return {
      name: this.name,
      field: this.field,
      message: this.message,
      constraint: this.constraint,
      timestamp: this.timestamp
    };
  }
}

/**
 * 🎯 Zod Schema扩展
 */

// IP地址验证Schema
export const ipSchema = z.string()
  .min(1, 'IP地址不能为空')
  .max(45, 'IP地址长度无效')
  .ip({ message: 'IP地址格式无效' })
  .refine((ip) => {
    if (!VALIDATOR_CONFIG.IP.ALLOW_PRIVATE) {
      // 检查私有IP地址
      const privateRanges = [
        /^10\./,
        /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
        /^192\.168\./,
        /^127\./,
        /^169\.254\./,
        /^100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\./, // CGNAT 100.64.0.0/10
        /^::1$/,
        /^fc00:/,
        /^fe80:/
      ];
      return !privateRanges.some(range => range.test(ip));
    }
    return true;
  }, '不允许查询私有IP地址')
  .refine((ip) => {
    if (!VALIDATOR_CONFIG.IP.ALLOW_RESERVED) {
      // 检查保留IP地址
      const reservedRanges = [
        /^0\./,
        /^255\.255\.255\.255$/,
        /^224\./,
        /^240\./,
        /^192\.0\.2\./,   // TEST-NET-1
        /^198\.51\.100\./, // TEST-NET-2
        /^203\.0\.113\./, // TEST-NET-3
        /^2001:db8::/,
        /^ff00:/
      ];
      return !reservedRanges.some(range => range.test(ip));
    }
    return true;
  }, '不允许查询保留IP地址');

// 批量IP验证Schema
export const batchIpSchema = z.object({
  ips: z.array(ipSchema)
    .min(1, 'IP列表不能为空')
    .max(100, '单次最多查询100个IP地址')
}).strict();

// 查询参数验证Schema
export const querySchema = z.object({
  ip: ipSchema.optional(),
  format: z.enum(['json', 'xml', 'csv'], {
    errorMap: () => ({ message: '格式只支持json、xml或csv' })
  }).optional(),
  include_threat: z.coerce.boolean().optional(),
  include_provider: z.coerce.boolean().optional(),
  fields: z.string()
    .max(500, '字段列表过长')
    .optional()
    .refine((fields) => {
      if (!fields) return true;
      const allowedFields = [
        'ip', 'country', 'countryCode', 'region', 'regionCode', 'city',
        'latitude', 'longitude', 'timezone', 'isp', 'org', 'as', 'proxy',
        'hosting', 'mobile', 'threat', 'provider'
      ];
      return fields.split(',').every(field => allowedFields.includes(field.trim()));
    }, '包含无效字段名称')
    .optional(),
  language: z.string()
    .min(2, '语言代码至少2个字符')
    .max(10, '语言代码最多10个字符')
    .optional(),
  callback: z.string()
    .max(100, '回调函数��过长')
    .refine((callback) => {
      if (!callback) return true;
      return /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(callback);
    }, '回调函数名格式无效')
    .optional(),
  timeout: z.coerce.number()
    .min(100, '超时时间不能少于100ms')
    .max(10000, '超时时间不能超过10秒')
    .optional()
}).strict();

// 安全头验证Schema
export const securityHeadersSchema = z.object({
  'x-api-key': z.string()
    .min(10, 'API密钥长度不足')
    .max(500, 'API密钥过长')
    .optional(),
  'x-request-id': z.string()
    .uuid()
    .optional(),
  'user-agent': z.string()
    .max(1000, 'User-Agent过长')
    .optional(),
  'x-forwarded-for': z.string()
    .max(100, 'X-Forwarded-For头过长')
    .optional(),
  'x-real-ip': z.string()
    .max(45, 'X-Real-IP头过长')
    .optional()
});

/**
 * 🔧 输入清理器
 */
export class InputSanitizer {
  /**
   * 清理字符串
   */
  static sanitizeString(input, options = {}) {
    if (typeof input !== 'string') return input;

    const config = { ...VALIDATOR_CONFIG.STRING, ...options };
    let result = input;

    // 移除控制字符
    result = result.replace(/[\x00-\x1F\x7F]/g, '');

    // HTML转义
    result = result.replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');

    // Unicode标准化
    if (config.NORMALIZE_UNICODE) {
      result = result.normalize('NFC');
    }

    // 去除首尾空格
    if (config.TRIM_WHITESPACE) {
      result = result.trim();
    }

    // 长度限制
    if (result.length > config.MAX_LENGTH) {
      result = result.substring(0, config.MAX_LENGTH);
    }

    return result;
  }

  /**
   * 清理数值
   */
  static sanitizeNumber(input, options = {}) {
    const config = { ...VALIDATOR_CONFIG.NUMBER, ...options };

    if (typeof input === 'string') {
      // 移除非数字字符（保留负号和小数点）
      const cleanValue = input.replace(/[^0-9.-]/g, '');
      const parsed = parseFloat(cleanValue);

      if (isNaN(parsed)) return null;
      input = parsed;
    }

    if (typeof input !== 'number' || !isFinite(input)) {
      return null;
    }

    // 检查范围
    if (input < config.MIN_VALUE || input > config.MAX_VALUE) {
      return null;
    }

    // 检查是否允许小数
    if (!config.ALLOW_FLOAT && !Number.isInteger(input)) {
      return Math.trunc(input);
    }

    // 检查是否允许负数
    if (!config.ALLOW_NEGATIVE && input < 0) {
      return Math.abs(input);
    }

    return input;
  }

  /**
   * 清理数组
   */
  static sanitizeArray(input, options = {}) {
    if (!Array.isArray(input)) {
      if (typeof input === 'string') {
        // 尝试解析JSON数组
        try {
          input = JSON.parse(input);
        } catch {
          // 按逗号分割
          input = input.split(',').map(item => item.trim()).filter(Boolean);
        }
      } else {
        return [];
      }
    }

    const config = { ...VALIDATOR_CONFIG.ARRAY, ...options };

    // 去重
    const uniqueItems = [...new Set(input)];

    // 过滤空值
    const filteredItems = uniqueItems.filter(item => item !== null && item !== undefined && item !== '');

    // 长度限制
    if (filteredItems.length > config.MAX_SIZE) {
      return filteredItems.slice(0, config.MAX_SIZE);
    }

    return filteredItems;
  }

  /**
   * 清理对象
   */
  static sanitizeObject(input, options = {}) {
    if (typeof input !== 'object' || input === null) {
      return {};
    }

    const config = { ...VALIDATOR_CONFIG.OBJECT, ...options };

    // 原型污染防护：这些键若被赋值会污染 Object.prototype
    const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

    const result = {};
    const keys = Object.keys(input);

    // 键数量限制
    if (keys.length > config.MAX_KEYS) {
      return result;
    }

    // 递归清理对象
    for (const key of keys.slice(0, config.MAX_KEYS)) {
      if (FORBIDDEN_KEYS.has(key)) {
        continue;
      }
      const cleanKey = this.sanitizeString(key);

      if (cleanKey && !FORBIDDEN_KEYS.has(cleanKey) && typeof input[cleanKey] !== 'function') {
        if (typeof input[cleanKey] === 'object' && config.MAX_DEPTH > 1) {
          result[cleanKey] = this.sanitizeObject(input[cleanKey], {
            ...config,
            MAX_DEPTH: config.MAX_DEPTH - 1
          });
        } else {
          result[cleanKey] = input[cleanKey];
        }
      }
    }

    return result;
  }
}

/**
 * 🎯 验证器类
 */
export class Validator {
  constructor(schema, options = {}) {
    this.schema = schema;
    this.options = {
      sanitize: true,
      strict: true,
      ...options
    };
  }

  /**
   * 验证输入数据
   */
  validate(input) {
    try {
      let data = input;

      // 数据清理
      if (this.options.sanitize) {
        data = this.sanitize(input);
      }

      // Schema验证
      const result = this.schema.parse(data);

      return {
        success: true,
        data: result,
        errors: []
      };
    } catch (error) {
      if (error instanceof z.ZodError) {
        const errors = error.errors.map(err => new ValidationError(
          err.path.join('.'),
          err.message,
          err.received,
          err.code
        ));

        return {
          success: false,
          data: null,
          errors: errors
        };
      }

      // 处理其他验证错误
      const validationError = new ValidationError(
        'general',
        error.message,
        input,
        'VALIDATION_ERROR'
      );

      return {
        success: false,
        data: null,
        errors: [validationError]
      };
    }
  }

  /**
   * 清理输入数据
   */
  sanitize(input) {
    // 对于对象验证，不进行清理以保持结构
    if (this.schema && this.schema._def.typeName === 'ZodObject') {
      return input;
    }

    if (typeof input === 'string') {
      return InputSanitizer.sanitizeString(input);
    }

    if (typeof input === 'number') {
      return InputSanitizer.sanitizeNumber(input);
    }

    if (Array.isArray(input)) {
      return InputSanitizer.sanitizeArray(input);
    }

    if (typeof input === 'object' && input !== null) {
      return InputSanitizer.sanitizeObject(input);
    }

    return input;
  }

  /**
   * 验证并抛出错误
   */
  validateOrThrow(input) {
    const result = this.validate(input);

    if (!result.success) {
      const errorDetails = result.errors.map(err => ({
        field: err.field,
        message: err.message,
        constraint: err.constraint
      }));

      throw ErrorFactory.create(
        ERROR_TYPES.BAD_REQUEST,
        '输入验证失败',
        errorDetails,
        new Error('Validation failed')
      );
    }

    return result.data;
  }
}

/**
 * 🎯 预定义验证器
 */
export const validators = {
  // IP地址验证器
  ip: new Validator(ipSchema),

  // 批量IP验证器
  batchIp: new Validator(batchIpSchema),

  // 查询参数验证器
  query: new Validator(querySchema),

  // 安全头验证器
  securityHeaders: new Validator(securityHeadersSchema),

  // 字符串验证器
  string: (options = {}) => new Validator(
    z.string().min(options.minLength || 1).max(options.maxLength || 1000),
    options
  ),

  // 数值验证器
  number: (options = {}) => new Validator(
    z.number().min(options.min || Number.MIN_SAFE_INTEGER).max(options.max || Number.MAX_SAFE_INTEGER),
    options
  ),

  // 数组验证器
  array: (options = {}) => new Validator(
    z.array(z.any()).min(options.minSize || 0).max(options.maxSize || 100),
    options
  ),

  // 对象验证器
  object: (schema = {}) => new Validator(z.object(schema), { strict: true })
};

/**
 * 🛡️ 安全检查器
 */
export class SecurityChecker {
  /**
   * 检查SQL注入模式
   */
  static checkSQLInjection(input) {
    if (typeof input !== 'string') return false;

    const sqlPatterns = [
      /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|EXEC|UNION)\b)/i,
      /(--|\*\/|\/\*)/,
      /(\bOR\b.*=.*\bOR\b)/i,
      /(\bAND\b.*=.*\bAND\b)/i,
      /(\bxp_cmdshell\b)/i,
      /(\bsp_executesql\b)/i
    ];

    return sqlPatterns.some(pattern => pattern.test(input));
  }

  /**
   * 检查XSS模式
   */
  static checkXSS(input) {
    if (typeof input !== 'string') return false;

    const xssPatterns = [
      /<script[^>]*>.*?<\/script>/gi,
      /javascript:/gi,
      /on\w+\s*=/gi,
      /<iframe[^>]*>/gi,
      /<object[^>]*>/gi,
      /<embed[^>]*>/gi,
      /<link[^>]*>/gi,
      /<meta[^>]*>/gi
    ];

    return xssPatterns.some(pattern => pattern.test(input));
  }

  /**
   * 检查路径遍历
   */
  static checkPathTraversal(input) {
    if (typeof input !== 'string') return false;

    const pathPatterns = [
      /\.\.[\/\\]/,
      /[\/\\]\.\./,
      /[\/\\]\.[\/\\]/,
      /\.\.\/\.\.\//
    ];

    return pathPatterns.some(pattern => pattern.test(input));
  }

  /**
   * 检查命令注入
   */
  static checkCommandInjection(input) {
    if (typeof input !== 'string') return false;

    // 先检查是否为IP地址格式，如果是则跳过命令注入检查
    if (this.isIPAddress(input)) {
      return false;
    }

    const commandPatterns = [
      /[;&|`$(){}[\]]/,
      /\b(curl|wget|nc|netcat|ssh|ftp|telnet)\b/i,
      />\s*\/dev\/(null|zero|random)/,
      /\|\s*tee/,
      /&&\s*\|\|/
    ];

    return commandPatterns.some(pattern => pattern.test(input));
  }

  /**
   * 检查是否为IP地址格式
   */
  static isIPAddress(input) {
    if (typeof input !== 'string') return false;

    // IPv4正则表达式
    const ipv4Regex = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;

    // IPv6正则表达式（简化版）
    const ipv6Regex = /^(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$|^::1$|^::$/;

    return ipv4Regex.test(input) || ipv6Regex.test(input);
  }

  /**
   * 综合安全检查
   */
  static performSecurityCheck(input) {
    const issues = [];

    // 如果是IP地址格式，只进行最基本的检查
    if (this.isIPAddress(input)) {
      // IP地址通常不会有安全问题，除非是特殊格式的攻击
      return [];
    }

    if (this.checkSQLInjection(input)) {
      issues.push({ type: 'SQL_INJECTION', severity: 'high' });
    }

    if (this.checkXSS(input)) {
      issues.push({ type: 'XSS', severity: 'high' });
    }

    if (this.checkPathTraversal(input)) {
      issues.push({ type: 'PATH_TRAVERSAL', severity: 'medium' });
    }

    if (this.checkCommandInjection(input)) {
      issues.push({ type: 'COMMAND_INJECTION', severity: 'high' });
    }

    return issues;
  }
}

/**
 * 🔧 安全验证装饰器
 */
export function withSecurityValidation(target, propertyName, descriptor) {
  const originalMethod = descriptor.value;

  if (typeof originalMethod !== 'function') {
    console.warn(`withSecurityValidation: ${propertyName} is not a function`);
    return descriptor;
  }

  descriptor.value = function(...args) {
    try {
      for (const arg of args) {
        if (typeof arg === 'string') {
          const securityIssues = SecurityChecker.performSecurityCheck(arg);

          if (securityIssues.length > 0) {
            const highSeverityIssues = securityIssues.filter(issue => issue.severity === 'high');

            if (highSeverityIssues.length > 0) {
              throw ErrorFactory.security(
                'MALICIOUS_REQUEST',
                '检测到恶意输入模式',
                {
                  issues: highSeverityIssues,
                  input: arg.substring(0, 100)
                }
              );
            }
          }
        }
      }

      return originalMethod.apply(this, args);
    } catch (error) {
      // 如果不是我们抛出的安全错误，重新抛出
      if (error.name !== 'AppError') {
        throw error;
      }
      throw error;
    }
  };

  return descriptor;
}

export default {
  Validator,
  ValidationError,
  InputSanitizer,
  SecurityChecker,
  validators,
  schemas: {
    ipSchema,
    batchIpSchema,
    querySchema,
    securityHeadersSchema
  },
  withSecurityValidation,
  VALIDATOR_CONFIG
};
