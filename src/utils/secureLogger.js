/**
 * 🔒 安全日志工具
 * 防止敏感信息泄露到日志中
 */

import { ENVIRONMENT, isFeatureEnabled } from '../config/environment.js';

class SecureLogger {
  constructor() {
    this.sensitivePatterns = [
      // IP地址模式（部分隐藏）
      /\b(\d{1,3}\.\d{1,3}\.\d{1,3}\.)\d{1,3}\b/g,
      // API密钥模式
      /[a-zA-Z0-9]{20,}/g,
      // 邮箱地址
      /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
      // 密码相关
      /password|secret|token|key|auth/gi
    ];

    this.ipMaskPattern = /\b(\d{1,3}\.\d{1,3}\.\d{1,3}\.)\d{1,3}\b/g;
    this.keyMaskPattern = /[a-zA-Z0-9]{20,}/g;
  }

  /**
   * 屏蔽IP地址（保留前3段）
   */
  maskIP(ip) {
    if (!ip || typeof ip !== 'string') return '[REDACTED]';
    return ip.replace(this.ipMaskPattern, '$1***');
  }

  /**
   * 屏蔽敏感密钥
   */
  maskKey(key) {
    if (!key || typeof key !== 'string') return '[REDACTED]';
    if (key.length < 10) return '[REDACTED]';
    return key.substring(0, 6) + '***' + key.substring(key.length - 4);
  }

  /**
   * 净化日志消息
   */
  sanitizeMessage(message) {
    if (!message || typeof message !== 'string') return '[REDACTED]';

    let sanitized = message;

    // 屏蔽IP地址
    sanitized = sanitized.replace(this.ipMaskPattern, (match, prefix) => `${prefix}***`);

    // 屏蔽长字符串（可能是密钥）
    sanitized = sanitized.replace(this.keyMaskPattern, (match) => {
      if (match.length > 20) {
        return this.maskKey(match);
      }
      return match;
    });

    return sanitized;
  }

  /**
   * 净化对象数据
   */
  sanitizeObject(obj, depth = 0, maxDepth = 3) {
    if (depth > maxDepth) return '[MAX_DEPTH_REACHED]';

    if (obj === null || obj === undefined) return null;

    if (typeof obj === 'string') {
      return this.sanitizeMessage(obj);
    }

    if (typeof obj !== 'object') {
      return obj;
    }

    if (Array.isArray(obj)) {
      return obj.map(item => this.sanitizeObject(item, depth + 1, maxDepth));
    }

    const sanitized = {};
    const sensitiveKeys = [
      'password', 'secret', 'token', 'key', 'auth', 'credential',
      'apikey', 'api_key', 'authorization', 'x-api-key', 'ip',
      'clientip', 'x-forwarded-for', 'x-real-ip'
    ];

    for (const [key, value] of Object.entries(obj)) {
      const keyLower = key.toLowerCase();

      // 检查是否为敏感键
      const isSensitive = sensitiveKeys.some(sensitive =>
        keyLower.includes(sensitive)
      );

      if (isSensitive) {
        if (keyLower.includes('ip')) {
          sanitized[key] = this.maskIP(String(value));
        } else if (typeof value === 'string' && value.length > 10) {
          sanitized[key] = this.maskKey(value);
        } else {
          sanitized[key] = '[REDACTED]';
        }
      } else {
        sanitized[key] = this.sanitizeObject(value, depth + 1, maxDepth);
      }
    }

    return sanitized;
  }

  /**
   * 安全日志记录
   */
  log(level, message, data = null) {
    // 检查是否应该记录此级别的日志
    if (!this.shouldLog(level)) {
      return;
    }

    try {
      const sanitizedMessage = this.sanitizeMessage(message);
      const timestamp = new Date().toISOString();
      const logEntry = {
        timestamp,
        level: level.toUpperCase(),
        message: sanitizedMessage,
        environment: ENVIRONMENT.current
      };

      if (data) {
        logEntry.data = this.sanitizeObject(data);
      }

      // 根据环境选择输出方式
      if (ENVIRONMENT.isProduction()) {
        // 生产环境：只输出结构化日志到stderr
        if (level === 'error' || level === 'warn') {
          console.error(JSON.stringify(logEntry));
        }
      } else {
        // 开发环境：友好的格式化输出
        const prefix = `[${timestamp}] [${level.toUpperCase()}]`;

        if (data) {
          console.log(prefix, sanitizedMessage, this.sanitizeObject(data));
        } else {
          console.log(prefix, sanitizedMessage);
        }
      }
    } catch (error) {
      // 日志记录失败时的降级处理
      if (!ENVIRONMENT.isProduction()) {
        console.error('Logger error:', error.message);
      }
    }
  }

  /**
   * 检查是否应该记录日志
   */
  shouldLog(level) {
    const config = getCurrentConfig();
    const logLevels = ['error', 'warn', 'info', 'debug'];
    const currentLevelIndex = logLevels.indexOf(config.logging.level);
    const messageLevelIndex = logLevels.indexOf(level);

    return messageLevelIndex <= currentLevelIndex;
  }

  // 便捷方法
  error(message, data) {
    this.log('error', message, data);
  }

  warn(message, data) {
    this.log('warn', message, data);
  }

  info(message, data) {
    this.log('info', message, data);
  }

  debug(message, data) {
    this.log('debug', message, data);
  }

  // 性能监控
  performance(operation, duration, metadata = {}) {
    if (!isFeatureEnabled('monitoring')) {
      return;
    }

    this.info(`Performance: ${operation}`, {
      duration: `${duration}ms`,
      ...metadata
    });
  }

  // 安全事件
  security(event, details = {}) {
    const securityData = {
      event,
      timestamp: new Date().toISOString(),
      severity: this.getSecuritySeverity(event),
      ...details
    };

    // 安全事件总是记录
    if (ENVIRONMENT.isProduction()) {
      console.error(JSON.stringify({
        type: 'SECURITY_EVENT',
        ...securityData
      }));
    } else {
      this.error(`SECURITY: ${event}`, securityData);
    }
  }

  getSecuritySeverity(event) {
    const highSeverityEvents = [
      'auth_failure', 'rate_limit_exceeded', 'blocked_ip',
      'suspicious_request', 'invalid_token', 'privilege_escalation'
    ];

    return highSeverityEvents.includes(event) ? 'HIGH' : 'MEDIUM';
  }
}

// 获取当前配置的辅助函数
function getCurrentConfig() {
  // 这里需要导入环境配置，避免循环依赖
  const levels = {
    production: 'error',
    staging: 'warn',
    development: 'debug'
  };

  return {
    logging: {
      level: levels[ENVIRONMENT.current] || 'info'
    }
  };
}

// 创建全局实例
const secureLogger = new SecureLogger();

export default secureLogger;
