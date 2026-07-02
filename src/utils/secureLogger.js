/**
 * 🔒 安全日志工具
 * 防止敏感信息泄露到日志中
 */

import { ENVIRONMENT } from '../config/environment.js';
import { config } from '../config/configManager.js';

class SecureLogger {
  constructor(transport = null) {
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

    // 🆕 候选 2（最小切片）：transport 注入 seam。
    // transport 形状：{ level?: string, sink?: (entry) => void }
    //   - level：覆盖默认 level 来源（getCurrentConfig）。null/undefined 时仍走默认。
    //   - sink：每个 logEntry 写入回调；null/undefined 时 console 路径不变（行为完全不变）。
    // 顶层 default export `new SecureLogger()` 不传 transport → 0 行为变化。
    this.transport = transport;
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

      // 候选 2：注入 transport.sink 时，写入 sink（测试断言用）；console 路径仍照常走。
      // m3 契约：sink 是 additive（附加），不替代 console。注入 sink 时 console 仍输出（双写）。
      // 不传 transport（默认 export）→ sink 为 undefined → 完全不影响行为。
      if (this.transport?.sink) {
        this.transport.sink(logEntry);
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
    // 候选 2：transport.level 优先（测试可注入精修 level）；否则回落到默认来源。
    const config = getCurrentConfig();
    const logLevels = ['error', 'warn', 'info', 'debug'];
    const effectiveLevel = this.transport?.level ?? config.logging.level;
    const currentLevelIndex = logLevels.indexOf(effectiveLevel);
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
    // ponytail: 读 configManager 而非已删的 ENV_CONFIG。
    // config.get 在 configManager 未初始化时 throw（非返回 default），此处兜底为默认启用，
    // 避免预初始化调用方（监控启动/引导日志）未捕获抛错。
    let enabled = true;
    try {
      enabled = config.get('monitoring.enableMetrics', true);
    } catch {
      enabled = true;
    }
    if (!enabled) {
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

// 候选 2：named export class，让测试可 new 出带 transport 的独立实例。
export { SecureLogger };

export default secureLogger;
