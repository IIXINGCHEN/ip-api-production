/**
 * 🔧 配置管理系统
 * 提供动态配置管理、环境感知、配置验证等功能
 */

import { z } from 'zod';
import { ENVIRONMENT } from './environment.js';

/**
 * 🎯 配置Schema定义
 */
export const configSchema = z.object({
  // 应用标识（User-Agent / 信封 name 等，避免硬编码）
  app: z.object({
    name: z.string().default('ip-api-production'),
    version: z.string().default('2.0.0')
  }).default({}),

  // API配置
  api: z.object({
    name: z.string().default('IP Geolocation API'),
    version: z.string().default('2.0.0'),
    description: z.string().default('Enterprise-grade IP geolocation service'),
    baseUrl: z.string().url().default('https://ip.hoolhub.top'),
    timeout: z.number().min(100).max(30000).default(10000),
    maxConcurrentRequests: z.number().min(1).max(1000).default(100),
    enableCors: z.boolean().default(true),
    enableCompression: z.boolean().default(true),
    corsOrigins: z.array(z.string()).default([])
  }),

  // 安全配置
  security: z.object({
    enableRateLimiting: z.boolean().default(true),
    rateLimitWindow: z.number().min(1000).default(60000), // 1分钟
    rateLimitMaxRequests: z.number().min(1).default(100),
    enableInputValidation: z.boolean().default(true),
    enableSecurityHeaders: z.boolean().default(true),
    enableIpBlocking: z.boolean().default(true),
    enableRequestSigning: z.boolean().default(false),
    allowedOrigins: z.array(z.string()).default(['*']),
    blockedIpRanges: z.array(z.string()).default([]),
    trustedProxies: z.array(z.string()).default([]),
    enableAuditLog: z.boolean().default(true),
    authMaxEntries: z.number().min(100).default(10000), // 失败尝试 Map 容量上限
    rateLimitMaxEntries: z.number().min(100).default(10000) // 限流存储 Map 容量上限
  }),

  // 缓存配置
  cache: z.object({
    enable: z.boolean().default(true),
    ttl: z.number().min(60000).default(300000), // 5分钟
    maxSize: z.number().min(100).default(10000),
    salt: z.string().default('ip-api-cache-salt'), // 缓存键哈希 salt（外部化，避免硬编码）
    strategy: z.enum(['lru', 'fifo', 'random']).default('lru'),
    enableEncryption: z.boolean().default(true),
    compressionEnabled: z.boolean().default(true),
    enableMetrics: z.boolean().default(true)
  }),

  // 性能配置
  performance: z.object({
    enableMonitoring: z.boolean().default(true),
    enableProfiling: z.boolean().default(ENVIRONMENT.isDevelopment()),
    enableMemoryOptimization: z.boolean().default(true),
    enableBatchProcessing: z.boolean().default(true),
    maxBatchSize: z.number().min(1).max(100).default(50),
    batchTimeout: z.number().min(10).max(5000).default(100),
    gcInterval: z.number().min(30000).default(300000) // 5分钟
  }),

  // 日志配置
  logging: z.object({
    level: z.enum(['debug', 'info', 'warn', 'error', 'fatal']).default('info'),
    enableConsole: z.boolean().default(true),
    enableFile: z.boolean().default(false),
    enableRemote: z.boolean().default(false),
    format: z.enum(['json', 'text']).default('json'),
    maxFileSize: z.number().min(1024).default(10485760), // 10MB
    maxFiles: z.number().min(1).default(5),
    enableSensitiveDataFiltering: z.boolean().default(true)
  }),

  // Provider配置
  providers: z.object({
    cloudflare: z.object({
      enabled: z.boolean().default(true),
      priority: z.number().min(1).max(10).default(1),
      timeout: z.number().min(1000).max(30000).default(5000),
      retryAttempts: z.number().min(0).max(5).default(2)
    }),
    maxmind: z.object({
      enabled: z.boolean().default(false),
      priority: z.number().min(1).max(10).default(2),
      timeout: z.number().min(1000).max(30000).default(3000),
      retryAttempts: z.number().min(0).max(5).default(1),
      databasePath: z.string().optional(),
      licenseKey: z.string().optional()
    }),
    ipinfo: z.object({
      enabled: z.boolean().default(false),
      priority: z.number().min(1).max(10).default(3),
      timeout: z.number().min(1000).max(30000).default(4000),
      retryAttempts: z.number().min(0).max(5).default(1),
      apiToken: z.string().optional()
    })
  }),

  // 威胁检测配置
  threat: z.object({
    enabled: z.boolean().default(true),
    enableWhitelist: z.boolean().default(true),
    riskThreshold: z.number().min(0).max(100).default(20),
    enableRealTime: z.boolean().default(true),
    cacheResults: z.boolean().default(true),
    providers: z.array(z.string()).default(['default'])
  }),

  // 监控配置
  monitoring: z.object({
    enableMetrics: z.boolean().default(true),
    enableHealthChecks: z.boolean().default(true),
    enableAlerts: z.boolean().default(false),
    metricsInterval: z.number().min(1000).default(30000), // 30秒
    healthCheckInterval: z.number().min(5000).default(60000), // 1分钟
    enablePerformanceTracking: z.boolean().default(true),
    enableErrorTracking: z.boolean().default(true),
    enableUserAnalytics: z.boolean().default(false)
  }),

  // 数据库配置（如果需要）
  database: z.object({
    enabled: z.boolean().default(false),
    type: z.enum(['none', 'sqlite', 'postgresql', 'mysql']).default('none'),
    connectionString: z.string().optional(),
    poolSize: z.number().min(1).max(100).default(10),
    enableMigrations: z.boolean().default(false)
  }).optional()
});

/**
 * 🏗️ 配置管理器类
 */
export class ConfigManager {
  constructor() {
    this.config = null;
    this.lastUpdated = null;
    this.isInitialized = false;
  }

  /**
   * 初始化配置
   */
  async initialize() {
    try {
      // 加载基础配置
      const baseConfig = this.loadBaseConfig();

      // 加载环境特定配置
      const envConfig = this.loadEnvironmentConfig();

      // 加载用户自定义配置
      const userConfig = await this.loadUserConfig();

      // 合并配置
      const mergedConfig = this.mergeConfigs(baseConfig, envConfig, userConfig);

      // 验证配置
      const validatedConfig = configSchema.parse(mergedConfig);

      // 设置配置
      this.config = validatedConfig;
      this.lastUpdated = new Date().toISOString();
      this.isInitialized = true;

      // 应用配置
      this.applyConfiguration();

      console.log('🔧 Configuration initialized successfully');

    } catch (error) {
      console.error('❌ Configuration initialization failed:', error);
      throw new Error(`Configuration initialization failed: ${error.message}`);
    }
  }

  /**
   * 加载基础配置
   */
  loadBaseConfig() {
    return {
      api: {
        name: 'IP Geolocation API',
        version: '2.0.0',
        description: 'Enterprise-grade IP geolocation service'
      },
      security: {
        enableRateLimiting: true,
        enableInputValidation: true,
        enableSecurityHeaders: true
      },
      cache: {
        enable: true,
        ttl: 300000,
        maxSize: 10000
      },
      performance: {
        enableMonitoring: true,
        enableMemoryOptimization: true
      },
      logging: {
        level: ENVIRONMENT.isDevelopment() ? 'debug' : 'info',
        enableConsole: true,
        enableSensitiveDataFiltering: true
      },
      providers: {
        cloudflare: {
          enabled: true,
          priority: 1,
          timeout: 5000,
          retryAttempts: 2
        },
        maxmind: {
          enabled: false,
          priority: 2,
          timeout: 3000,
          retryAttempts: 1
        },
        ipinfo: {
          enabled: false,
          priority: 3,
          timeout: 4000,
          retryAttempts: 1
        }
      },
      threat: {
        enabled: true,
        enableWhitelist: true,
        riskThreshold: 20,
        enableRealTime: true,
        cacheResults: true,
        providers: ['default']
      },
      monitoring: {
        enableMetrics: true,
        enableHealthChecks: true,
        enableAlerts: false,
        metricsInterval: 30000,
        healthCheckInterval: 60000,
        enablePerformanceTracking: true,
        enableErrorTracking: true,
        enableUserAnalytics: false
      }
    };
  }

  /**
   * 加载环境特定配置
   */
  loadEnvironmentConfig() {
    const env = ENVIRONMENT.current;

    const configs = {
      development: {
        api: {
          timeout: 15000,
          enableCors: true,
          corsOrigins: [
            'http://localhost:3000',
            'http://localhost:5173',
            'http://localhost:8080',
            'http://127.0.0.1:3000',
            'http://127.0.0.1:5173',
            'http://127.0.0.1:8080',
            'http://127.0.0.1:8787'
          ]
        },
        security: {
          rateLimitMaxRequests: 1000,
          enableIpBlocking: false
        },
        performance: {
          enableProfiling: true,
          gcInterval: 60000
        },
        logging: {
          level: 'debug',
          enableFile: false,
          enableRemote: false
        },
        monitoring: {
          enableAlerts: false,
          metricsInterval: 10000
        }
      },

      staging: {
        api: {
          timeout: 8000,
          corsOrigins: [
            'https://ip.ixingchen.top',
            'https://ixingchen.top',
            'https://staging.ixingchen.top',
            'http://localhost:3000',
            'http://localhost:8080'
          ]
        },
        security: {
          rateLimitMaxRequests: 500
        },
        logging: {
          level: 'info',
          enableFile: true,
          enableRemote: false
        },
        monitoring: {
          enableAlerts: true,
          metricsInterval: 30000
        }
      },

      production: {
        api: {
          timeout: 5000,
          enableCors: true,
          corsOrigins: [
            'https://ip.hoolhub.top'
          ]
        },
        security: {
          rateLimitMaxRequests: 100,
          enableIpBlocking: true,
          enableRequestSigning: true
        },
        performance: {
          enableProfiling: false,
          gcInterval: 300000
        },
        logging: {
          level: 'warn',
          enableFile: true,
          enableRemote: true,
          maxFileSize: 52428800, // 50MB
          maxFiles: 10
        },
        monitoring: {
          enableAlerts: true,
          enablePerformanceTracking: true,
          metricsInterval: 60000
        }
      }
    };

    return configs[env] || {};
  }

  /**
   * 加载用户自定义配置
   */
  async loadUserConfig() {
    try {
      // 尝试从环境变量加载配置
      const envConfig = this.loadFromEnvironment();

      // 尝试从配置文件加载
      const fileConfig = await this.loadFromFile();

      return { ...envConfig, ...fileConfig };
    } catch (error) {
      console.warn('⚠️ Failed to load user configuration:', error.message);
      return {};
    }
  }

  /**
   * 从环境变量加载配置
   */
  loadFromEnvironment() {
    const config = {};
    // Workers 运行时 process 未定义——必须守卫，否则 ReferenceError 被 loadUserConfig
    // 的 try/catch 吞掉，导致这些环境覆盖在生产静默失效。
    const env = (typeof process !== 'undefined' && process.env) || {};

    // API配置
    if (env.API_TIMEOUT) {
      config.api = { ...(config.api || {}), timeout: parseInt(env.API_TIMEOUT) };
    }

    if (env.API_BASE_URL) {
      config.api = { ...(config.api || {}), baseUrl: env.API_BASE_URL };
    }

    if (env.API_RATE_LIMIT) {
      config.security = { rateLimitMaxRequests: parseInt(env.API_RATE_LIMIT) };
    }

    if (env.CACHE_TTL) {
      config.cache = { ttl: parseInt(env.CACHE_TTL) };
    }

    if (env.LOG_LEVEL) {
      config.logging = { level: env.LOG_LEVEL };
    }

    // 应用标识（User-Agent 等）+ 缓存 salt：从 env 外部化，避免硬编码
    if (env.APP_NAME || env.APP_VERSION) {
      config.app = {
        ...(config.app || {}),
        ...(env.APP_NAME && { name: env.APP_NAME }),
        ...(env.APP_VERSION && { version: env.APP_VERSION })
      };
    }
    if (env.CACHE_SALT) {
      config.cache = { ...(config.cache || {}), salt: env.CACHE_SALT };
    }
    if (env.AUTH_MAX_ENTRIES || env.RATE_LIMIT_MAX_ENTRIES) {
      config.security = {
        ...(config.security || {}),
        ...(env.AUTH_MAX_ENTRIES && { authMaxEntries: parseInt(env.AUTH_MAX_ENTRIES) }),
        ...(env.RATE_LIMIT_MAX_ENTRIES && { rateLimitMaxEntries: parseInt(env.RATE_LIMIT_MAX_ENTRIES) })
      };
    }

    // Provider 凭证（IPINFO_TOKEN / MAXMIND_*）由 security.js PROVIDERS_CONFIG
    // 从 globalThis 读取并直接注入 provider，不经过此配置树（曾在此重复读取，已删除）。

    return config;
  }

  /**
   * 从配置文件加载
   */
  async loadFromFile() {
    // 这里可以实现从JSON/YAML文件加载配置
    // 为了简化，暂时返回空对象
    return {};
  }

  /**
   * 合并配置
   */
  mergeConfigs(baseConfig, envConfig, userConfig) {
    return this.deepMerge(baseConfig, envConfig, userConfig);
  }

  /**
   * 深度合并对象
   */
  deepMerge(...objects) {
    const result = {};

    for (const obj of objects) {
      if (!obj || typeof obj !== 'object') continue;

      for (const key in obj) {
        if (obj.hasOwnProperty(key)) {
          if (typeof obj[key] === 'object' && obj[key] !== null && !Array.isArray(obj[key])) {
            result[key] = this.deepMerge(result[key] || {}, obj[key]);
          } else {
            result[key] = obj[key];
          }
        }
      }
    }

    return result;
  }

  /**
   * 应用配置
   */
  applyConfiguration() {
    if (!this.config) return;

    // 应用全局设置
    if (this.config.logging.enableConsole) {
      // 设置日志级别
      console.log(`📝 Logging level set to: ${this.config.logging.level}`);
    }

    // 配置性能优化
    if (this.config.performance.enableMemoryOptimization) {
      console.log('⚡ Memory optimization enabled');
    }

    // 配置缓存
    if (this.config.cache.enable) {
      console.log(`💾 Cache enabled with TTL: ${this.config.cache.ttl}ms`);
    }
  }

  /**
   * 获取配置值
   */
  get(path, defaultValue = null) {
    if (!this.isInitialized) {
      throw new Error('Configuration not initialized. Call initialize() first.');
    }

    return this.getNestedValue(this.config, path, defaultValue);
  }

  /**
   * 设置配置值
   */
  set(path, value) {
    if (!this.isInitialized) {
      throw new Error('Configuration not initialized. Call initialize() first.');
    }

    this.setNestedValue(this.config, path, value);
    this.lastUpdated = new Date().toISOString();
  }

  /**
   * 获取嵌套值
   */
  getNestedValue(obj, path, defaultValue = null) {
    const keys = path.split('.');
    let current = obj;

    for (const key of keys) {
      if (current === null || current === undefined || !(key in current)) {
        return defaultValue;
      }
      current = current[key];
    }

    return current;
  }

  /**
   * 设置嵌套值
   */
  setNestedValue(obj, path, value) {
    const keys = path.split('.');
    const lastKey = keys.pop();
    let current = obj;

    for (const key of keys) {
      if (!(key in current) || typeof current[key] !== 'object' || current[key] === null) {
        current[key] = {};
      }
      current = current[key];
    }

    current[lastKey] = value;
  }

  /**
   * 获取完整配置
   */
  getAll() {
    if (!this.isInitialized) {
      throw new Error('Configuration not initialized. Call initialize() first.');
    }

    return { ...this.config };
  }

  /**
   * 验证配置
   */
  validate() {
    if (!this.isInitialized) {
      throw new Error('Configuration not initialized. Call initialize() first.');
    }

    try {
      configSchema.parse(this.config);
      return { valid: true, errors: [] };
    } catch (error) {
      if (error instanceof z.ZodError) {
        return {
          valid: false,
          errors: error.errors.map(err => ({
            path: err.path.join('.'),
            message: err.message,
            code: err.code
          }))
        };
      }
      return {
        valid: false,
        errors: [{ message: error.message, path: 'unknown', code: 'unknown' }]
      };
    }
  }

  /**
   * 重新加载配置
   */
  async reload() {
    console.log('🔄 Reloading configuration...');
    await this.initialize();
  }

  /**
   * 获取配置统计信息
   */
  getStats() {
    return {
      initialized: this.isInitialized,
      lastUpdated: this.lastUpdated,
      configSize: JSON.stringify(this.config || {}).length,
      environment: ENVIRONMENT.current
    };
  }
}

// 🌍 全局配置管理器实例
export const configManager = new ConfigManager();

// 🎯 配置助手函数
export const config = {
  get: (path, defaultValue) => configManager.get(path, defaultValue),
  set: (path, value) => configManager.set(path, value),
  getAll: () => configManager.getAll(),
  validate: () => configManager.validate(),
  reload: () => configManager.reload(),
  getStats: () => configManager.getStats()
};

export default configManager;
