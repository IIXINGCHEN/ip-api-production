/**
 * 🚀 IP 地理位置 API 应用入口（RESTful 规范）
 *
 * 端点结构：
 *   公开：GET /  GET /health  GET /docs  GET /api/v1  GET /api/v1/openapi.json
 *   数据：GET /api/v1/ips  GET /api/v1/ips/self  GET /api/v1/ips/:ip  POST /api/v1/ips:batch
 *   运维：/api/v1/system/*（管理员）
 *
 * 全局中间件链顺序：初始化 → 监控维护 → 日志 → CORS → 安全头 → 客户端IP → 限流 → 认证 → 路由
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';

import { ENVIRONMENT } from './config/environment.js';
import { generateRequestId } from './utils/response.js';
import { isNodeRuntime, getMemoryUsage } from './utils/runtime.js';
import { getBestEffortClientIP, getTrustedClientIP } from './utils/clientIp.js';
import { configManager, config } from './config/configManager.js';
import { monitoringService } from './monitoring/monitoringService.js';
import { createAuthMiddleware } from './middleware/auth.js';
import { createRateLimitMiddleware } from './middleware/rateLimitFixed.js';
import { performanceOptimizer, startMemoryCleanup, stopMemoryCleanup } from './services/performanceOptimizer.js';
import memoryOptimizer from './services/memoryOptimizer.js';
import { buildError } from './utils/responseBuilder.js';

// 路由模块
import discoveryRoutes from './routes/discovery.js';
import ipsRoutes from './routes/ips.js';
import systemRoutes from './routes/system.js';

const app = new Hono();

// 公开端点（精确匹配）：无需 API 密钥、不计入限流计数
const PUBLIC_ENDPOINTS = ['/', '/health', '/docs', '/api/v1', '/api/v1/openapi.json'];

/**
 * CORS origin 匹配：支持精确与 glob 通配（'*' 匹配任意，含多级子域）。
 * 例：'https://*.ixingchen.top' 匹配 'https://api.ixingchen.top'。
 */
function originMatchesAllowed(origin, allowed) {
  return allowed.some((pattern) => {
    if (!pattern || typeof pattern !== 'string') {
      return false;
    }
    if (pattern === origin) {
      return true;
    }
    if (!pattern.includes('*')) {
      return false;
    }
    const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
    return new RegExp(`^${escaped}$`).test(origin);
  });
}

// ============================================================
// 应用初始化（首次请求时执行，兼容 Cloudflare Workers）
// ============================================================
let isInitialized = false;
let initializationPromise = null;

async function initializeApplication() {
  try {
    console.log('🔧 Initializing configuration management system...');
    await configManager.initialize();
    console.log('✅ Configuration management system initialized');

    if (typeof setTimeout !== 'undefined') {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    console.log('📊 Starting monitoring service...');
    await monitoringService.start();
    console.log('✅ Monitoring service started');

    monitoringService.metricsCollector.incrementCounter('application_startup', 1, {
      environment: ENVIRONMENT.current,
      version: '2.0.0'
    });
    monitoringService.metricsCollector.setGauge('application_start_time', Date.now());

    monitoringService.healthChecker.register('api_routes', async() => {
      try {
        const routesCount = app.routes.length;
        return {
          healthy: routesCount > 0,
          message: `API routes loaded: ${routesCount}`,
          details: { routesCount }
        };
      } catch (error) {
        return { healthy: false, message: 'API routes check failed', details: { error: error.message } };
      }
    }, { critical: true });

    monitoringService.healthChecker.register('memory_optimizer', async() => {
      try {
        const memStats = memoryOptimizer.getMemoryStats();
        return {
          healthy: Boolean(memStats),
          message: memStats.monitoring
            ? 'Memory optimizer active (background monitoring)'
            : 'Memory optimizer passive (no background timers in this runtime)',
          details: memStats
        };
      } catch (error) {
        return { healthy: false, message: 'Memory optimizer check failed', details: { error: error.message } };
      }
    });

    monitoringService.alertManager.addRule('high_memory_usage', {
      level: 'warning',
      condition: () => {
        const m = getMemoryUsage();
        if (!m) return false;
        return (m.heapUsed / m.heapTotal) * 100 > 80;
      },
      message: 'Memory usage is above 80%',
      critical: false
    });

    monitoringService.alertManager.addRule('critical_memory_usage', {
      level: 'critical',
      condition: () => {
        const m = getMemoryUsage();
        if (!m) return false;
        return (m.heapUsed / m.heapTotal) * 100 > 95;
      },
      message: 'Memory usage is critically high (>95%)',
      critical: true
    });

    // 仅真实 Node 进程启动后台清理；workerd 中后台定时器不可靠
    if (isNodeRuntime() && process.env.NODE_ENV !== 'test') {
      startMemoryCleanup();
      console.log('✅ Memory cleanup started');
    }

    if (ENVIRONMENT.isProduction()) {
      performanceOptimizer.setEnabled(true);
      console.log('✅ Performance optimizer enabled for production');
    }

    console.log('🎯 Application initialization completed successfully');
  } catch (error) {
    console.error('❌ Application initialization failed:', error);
    throw error;
  }
}

const initializationMiddleware = async(c, next) => {
  if (!isInitialized) {
    if (!initializationPromise) {
      initializationPromise = initializeApplication().then(() => {
        isInitialized = true;
        console.log('🚀 Application ready to serve requests');
      }).catch((error) => {
        console.error('❌ Failed to initialize application:', error);
        isInitialized = false;
        initializationPromise = null;
        throw error;
      });
    }
    try {
      await initializationPromise;
    } catch (error) {
      return c.json(
        buildError('INITIALIZATION_ERROR', '应用初始化失败', { message: error.message }, {}),
        { status: 500 }
      );
    }
  }
  // 记录请求进入业务处理的起点，供响应信封计算 processingTimeMs（单一真相源）。
  // 设在初始化之后、其余中间件/路由之前，使错误响应（校验失败/未找到）也能反映真实耗时。
  c.set('startTime', Date.now());
  await next();
};

// ============================================================
// 全局中间件链
// ============================================================

// 0. 初始化（最优先）
app.use('*', initializationMiddleware);

// 0.5 惰性监控维护：workerd 中后台定时器不可靠，由请求驱动到期才执行
app.use('*', async(c, next) => {
  await next();
  const maintenance = monitoringService.runMaintenanceIfDue();
  if (maintenance) {
    try {
      c.executionCtx.waitUntil(maintenance);
    } catch {
      // 非 Workers 环境无 executionCtx
    }
  }
});

// 1. 日志
app.use('*', logger());

// 2. CORS
app.use('*', cors({
  origin: (origin) => {
    const allowedOrigins = config.get('api.corsOrigins', []);
    // 无 Origin 头（同源/非浏览器请求）：非生产放行，生产拒绝
    if (!origin) {
      return ENVIRONMENT.isProduction() ? null : '*';
    }
    if (originMatchesAllowed(origin, allowedOrigins)) {
      return origin;
    }
    console.warn(`🚨 CORS blocked origin: ${origin}`);
    return null;
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type', 'Authorization', 'X-Request-ID', 'X-API-Key', 'Accept', 'Accept-Language'
  ],
  exposedHeaders: [
    'X-Request-ID', 'X-Response-Time', 'X-API-Version',
    'X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset', 'Allow'
  ],
  credentials: true,
  maxAge: 86400
}));

// 3. 安全头
app.use('*', async(c, next) => {
  c.header('Content-Type', 'application/json; charset=utf-8');
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('X-Frame-Options', 'DENY');
  c.header('X-XSS-Protection', '1; mode=block');
  c.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  c.header('Content-Security-Policy', 'default-src \'self\'');
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  c.header('X-API-Version', 'v1');
  // requestId：优先沿用客户端 X-Request-ID，否则生成；存入 context 供下游中间件/路由统一使用
  const requestId = c.req.header('X-Request-ID') || generateRequestId();
  c.header('X-Request-ID', requestId);
  c.set('requestId', requestId);
  await next();
});

// 4. 客户端 IP 提取（按部署平台信任链）
app.use('*', async(c, next) => {
  // clientIP：尽力而为，用作 /self 地理自查询的提示
  // trustedClientIP：平台边缘可信源，用作限流/认证锁定键（null = 无可信源 → 回退 'unknown' 紧限流桶）
  c.set('clientIP', getBestEffortClientIP(c.req));
  c.set('trustedClientIP', getTrustedClientIP(c.req));
  await next();
});

// 5. 速率限制（公开端点跳过计数）
app.use('*', createRateLimitMiddleware({
  windowMs: 15 * 60 * 1000,
  max: 100,
  skipEndpoints: PUBLIC_ENDPOINTS
}));

// 6. 认证（公开端点放行，其余需 API 密钥）
app.use('*', createAuthMiddleware({
  requireAuth: true,
  publicEndpoints: PUBLIC_ENDPOINTS
}));

// ============================================================
// 路由挂载
// ============================================================
app.route('/', discoveryRoutes);
app.route('/', ipsRoutes);
app.route('/', systemRoutes);

// ============================================================
// 404 处理器（RESTful 错误信封）
// ============================================================
app.notFound((c) => {
  const startTime = c.get('startTime') || Date.now();
  const requestId = generateRequestId();
  const clientIP = c.get('clientIP') || 'unknown';
  console.warn(`🔍 404 Not Found: ${c.req.method} ${c.req.path} from ${clientIP}`);

  // NOTE: 不设置 Allow 头——Allow 属于 405 Method Not Allowed，404 时该资源根本不存在，
  // 通告固定的 Allow 值会误导客户端重试。availableEndpoints 已提供正确的可用端点指引。
  return c.json(
    buildError(
      'RESOURCE_NOT_FOUND',
      '请求的资源不存在',
      {
        path: c.req.path,
        method: c.req.method,
        availableEndpoints: [
          'GET /',
          'GET /health',
          'GET /docs',
          'GET /api/v1',
          'GET /api/v1/openapi.json',
          'GET /api/v1/ips',
          'GET /api/v1/ips/self',
          'GET /api/v1/ips/:ip',
          'POST /api/v1/ips:batch',
          'GET /api/v1/system/*'
        ]
      },
      { requestId, startTime }
    ),
    { status: 404 }
  );
});

// ============================================================
// 全局错误处理器
// ============================================================
app.onError((error, c) => {
  console.error('Unhandled error:', error);
  const startTime = c.get('startTime') || Date.now();
  const requestId = c.get('requestId') || generateRequestId();
  return c.json(
    buildError(
      'INTERNAL_ERROR',
      '服务器内部错误',
      ENVIRONMENT.isDevelopment() ? { message: error.message, stack: error.stack } : undefined,
      { ctx: { requestId }, startTime }
    ),
    { status: 500 }
  );
});

// ============================================================
// 优雅关闭
// ============================================================
if (typeof process !== 'undefined') {
  const gracefulShutdown = async(signal) => {
    console.log(`\n🛑 Received ${signal}, shutting down gracefully...`);
    try {
      monitoringService.metricsCollector.incrementCounter('application_shutdown', 1, {
        signal, environment: ENVIRONMENT.current
      });
      console.log('📊 Stopping monitoring service...');
      monitoringService.stop();
      console.log('🧹 Stopping memory cleanup...');
      stopMemoryCleanup();
      console.log('⚡ Cleaning up performance optimizer...');
      performanceOptimizer.cleanup();
      console.log('🧠 Destroying memory optimizer...');
      memoryOptimizer.destroy();
      console.log('🎯 Graceful shutdown completed');
      process.exit(0);
    } catch (err) {
      console.error('❌ Error during graceful shutdown:', err);
      process.exit(1);
    }
  };

  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught Exception:', error);
    if (monitoringService?.metricsCollector) {
      monitoringService.metricsCollector.incrementCounter('uncaught_exception', 1, {
        error_type: error.name || 'Error'
      });
    }
    gracefulShutdown('uncaughtException');
  });
  process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
    if (monitoringService?.metricsCollector) {
      monitoringService.metricsCollector.incrementCounter('unhandled_rejection', 1, {
        reason_type: reason instanceof Error ? (reason.name || 'Error') : typeof reason
      });
    }
    gracefulShutdown('unhandledRejection');
  });
}

export { app };
export default app;
