/**
 * 📍 IP 地理位置资源路由 (/api/v1/ips)
 *
 * RESTful 资源结构：
 *   GET  /api/v1/ips         集合（默认返回调用方自身 IP 的地理位置）
 *   GET  /api/v1/ips/self    调用方自身 IP（显式）
 *   GET  /api/v1/ips/:ip     指定公网 IP 资源
 *   POST /api/v1/ips:batch   批量查询（Google AIP 自定义方法风格）
 *
 * 查询参数全部 camelCase：format / lang / fields / includeThreat / pretty / callback / timeout
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { getGeoInfo } from '../services/geoService.js';
import { generateRequestId } from '../utils/response.js';
import { ENVIRONMENT } from '../config/environment.js';
import secureLogger from '../utils/secureLogger.js';
import { getGeoCache, getRateLimitCache } from '../utils/secureCache.js';
import { SecurityChecker } from '../utils/inputValidator.js';
import { ErrorFactory, ERROR_TYPES } from '../utils/errorHandler.js';
import { config } from '../config/configManager.js';
import { monitoringService } from '../monitoring/monitoringService.js';
import {
  buildSuccess,
  buildError,
  buildLinks,
  getBaseUrl
} from '../utils/responseBuilder.js';
import { buildGeoResource, serializeByFormat } from '../utils/geoFormatter.js';

const app = new Hono();

const MAX_FIELD_DEPTH = 5;
const MAX_FIELDS_COUNT = 50;

// 私有/环回/链路本地/保留地址前缀（拒绝查询）
const BLOCKED_IP_PATTERNS = [
  /^10\./,
  /^172\.(1[6-9]|2[0-9]|3[01])\./,
  /^192\.168\./,
  /^127\./,
  /^169\.254\./,
  /^100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\./, // CGNAT 100.64.0.0/10
  /^192\.0\.2\./,   // TEST-NET-1
  /^198\.51\.100\./, // TEST-NET-2
  /^203\.0\.113\./, // TEST-NET-3
  /^::1$/,
  /^fc00:/,
  /^fe80:/
];
const isBlockedIp = (ip) => BLOCKED_IP_PATTERNS.some((re) => re.test(ip));

const productionConfig = () => ({
  CACHE_TTL: config.get('cache.ttl', 300000),
  REQUEST_TIMEOUT: config.get('api.timeout', 10000),
  MAX_CONCURRENT_REQUESTS: config.get('api.maxConcurrentRequests', 100)
});

const getCache = () => getGeoCache();
const getRateLimitMap = () => getRateLimitCache();

/**
 * 查询参数 Schema（camelCase 规范）
 */
const geoQuerySchema = z.object({
  format: z.enum(['json', 'xml', 'csv'], {
    errorMap: () => ({ message: 'format 必须是 json | xml | csv 之一' })
  }).optional().default('json'),

  lang: z.string()
    .min(2, 'lang 至少 2 个字符')
    .max(5, 'lang 不超过 5 个字符')
    .regex(/^[a-z]{2}(-[A-Z]{2})?$/, 'lang 格式无效（如 en、en-US）')
    .optional()
    .default('en'),

  fields: z.string()
    .max(500, 'fields 参数过长')
    .refine((val) => {
      if (!val) return true;
      return val.split(',').length <= MAX_FIELDS_COUNT;
    }, `最多 ${MAX_FIELDS_COUNT} 个字段`)
    .refine((val) => {
      if (!val) return true;
      return val.split(',').every((f) => /^[A-Za-z0-9_.]+$/.test(f.trim()));
    }, 'fields 含非法字符')
    .refine((val) => {
      if (!val) return true;
      return val.split(',').every((f) => f.split('.').length <= MAX_FIELD_DEPTH);
    }, `字段嵌套深度上限 ${MAX_FIELD_DEPTH}`)
    .optional(),

  includeThreat: z.union([
    z.string().transform((v) => v.toLowerCase() === 'true'),
    z.boolean()
  ]).optional().default(false),

  // 兼容旧 snake_case（仅做读取映射，不写入响应）
  include_threat: z.union([
    z.string().transform((v) => v.toLowerCase() === 'true'),
    z.boolean()
  ]).optional(),

  callback: z.string()
    .max(100, 'callback 参数过长')
    .regex(/^[a-zA-Z_$][a-zA-Z0-9_$]*$/, 'callback 函数名非法')
    .optional(),

  pretty: z.union([
    z.string().transform((v) => v.toLowerCase() === 'true'),
    z.boolean()
  ]).optional().default(false),

  timeout: z.coerce.number()
    .min(100, 'timeout 至少 100ms')
    .max(10000, 'timeout 不超过 10000ms')
    .optional()
}).transform((data) => {
  // include_threat 作为 includeThreat 的回退来源
  if (data.include_threat !== undefined && data.includeThreat === false) {
    data.includeThreat = data.include_threat;
  }
  delete data.include_threat;
  return data;
});

/**
 * 路径参数 Schema：合法 IP + 拒绝私有/保留地址
 */
const ipParamSchema = z.object({
  ip: z.string()
    .ip('IP 地址格式无效')
    .refine((ip) => !isBlockedIp(ip), '不允许查询私有/环回 IP 地址')
});

/**
 * 批量请求体 Schema
 */
const batchBodySchema = z.object({
  ips: z.array(z.string().ip('包含无效 IP 地址'))
    .min(1, '至少提供 1 个 IP')
    .max(100, '单次最多 100 个 IP')
    .refine((ips) => ips.every((ip) => !isBlockedIp(ip)), '批量查询不允许包含私有/环回 IP')
});

// 标准校验失败钩子
const validationHook = (result, c) => {
  if (result.success) return;
  const startTime = c.get('startTime') || Date.now();
  const requestId = c.get('requestId') || generateRequestId();
  const ctx = { requestId };
  const body = buildError(
    'BAD_REQUEST',
    '输入校验失败',
    ENVIRONMENT.isDevelopment() ? { issues: result.error?.issues || [] } : undefined,
    { ctx, startTime }
  );
  return c.json(body, { status: 400 });
};

const validate = (target, schema) => zValidator(target, schema, validationHook);

/**
 * 安全包装：对 options 字符串值执行安全检查后委托给 geoService
 */
async function secureGeoLookup(ip, request, options) {
  if (options && typeof options === 'object') {
    for (const [, value] of Object.entries(options)) {
      if (typeof value === 'string' && value.length > 0) {
        const issues = SecurityChecker.performSecurityCheck(value);
        const high = issues.filter((i) => i.severity === 'high');
        if (high.length > 0) {
          throw ErrorFactory.security(ERROR_TYPES.MALICIOUS_REQUEST, '检测到恶意输入模式', { issues: high });
        }
      }
    }
  }
  return getGeoInfo(ip, request, options);
}

function getCacheKey(ip, query) {
  const qs = Object.keys(query)
    .filter((k) => !['pretty', 'callback'].includes(k))
    .sort()
    .map((k) => `${k}=${query[k]}`)
    .join('&');
  return `geo:${ip}:${qs}`;
}

const getFromCache = (key) => getCache().get(key);
const setCache = (key, data) => getCache().set(key, data, productionConfig().CACHE_TTL);

/**
 * 单次 geo 查询 + 缓存 + 监控，返回标准化的响应信封
 */
async function resolveGeo(c, ip, query, requestId) {
  const startTime = Date.now();
  const ctx = { requestId };
  const cacheKey = getCacheKey(ip, query);

  const cached = getFromCache(cacheKey);
  if (cached) {
    monitoringService.metricsCollector.incrementCounter('cache_hits', 1, { endpoint: 'ips', cached: true });
    const body = buildSuccess(cached.data, {
      ctx,
      startTime,
      links: cached.links,
      meta: { cached: true, provider: cached.data?.provider || 'unknown' }
    });
    return body;
  }

  const cfg = productionConfig();
  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => reject(new Error('Request timeout')), cfg.REQUEST_TIMEOUT);
  });
  const geoInfo = await Promise.race([
    secureGeoLookup(ip, c.req, { language: query.lang, includeThreat: query.includeThreat }),
    timeoutPromise
  ]);

  const resource = buildGeoResource(geoInfo, ip, query);
  const base = getBaseUrl(c);
  const links = buildLinks(base, {
    self: { href: `${base}/api/v1/ips/${encodeURIComponent(ip)}`, method: 'GET' },
    collection: { href: `${base}/api/v1/ips`, method: 'GET' },
    batch: { href: `${base}/api/v1/ips:batch`, method: 'POST' }
  });

  const body = buildSuccess(resource, {
    ctx,
    startTime,
    links,
    meta: { cached: false, provider: resource.provider || 'unknown' }
  });

  // 缓存 data + links（不含 meta，meta 每次重算 requestId/processingTimeMs）
  setCache(cacheKey, { data: resource, links });

  const processingTime = Date.now() - startTime;
  monitoringService.metricsCollector.recordHistogram('request_duration', processingTime, {
    endpoint: 'ips', cached: false, provider: resource.provider || 'unknown'
  });
  monitoringService.metricsCollector.incrementCounter('cache_misses', 1, {
    endpoint: 'ips', provider: resource.provider || 'unknown'
  });
  secureLogger.performance('geo_lookup', processingTime, { requestId, cached: false, provider: resource.provider });

  return body;
}

/**
 * 统一错误映射为标准信封
 */
function handleError(c, error, ip, requestId, startTime) {
  const ctx = { requestId, startTime };
  const processingTime = Date.now() - startTime;

  secureLogger.error('IP geo lookup failed', {
    requestId,
    targetIP: ip,
    error: error.message,
    processingTime,
    ...(ENVIRONMENT.isDevelopment() && { stack: error.stack })
  });

  const isTimeout = error.name === 'TimeoutError' || error.message === 'Request timeout';
  const isInvalidIP = error.message.includes('Invalid IP address');

  let status = 500;
  let code = 'GEOLOCATION_ERROR';
  let message = 'Failed to retrieve geolocation information';

  if (isTimeout) {
    status = 408; code = 'REQUEST_TIMEOUT'; message = '请求超时，请稍后重试';
  } else if (isInvalidIP) {
    status = 400; code = 'INVALID_IP'; message = 'IP 地址格式无效';
  } else if (error.name === 'SecurityError' || error.code === 'MALICIOUS_REQUEST') {
    status = 400; code = 'MALICIOUS_REQUEST'; message = '检测到恶意输入';
  }

  monitoringService.metricsCollector.incrementCounter('api_errors', 1, {
    endpoint: 'ips',
    error_type: isTimeout ? 'timeout' : code.toLowerCase()
  });

  return c.json(
    buildError(code, message, ENVIRONMENT.isDevelopment() ? { error: error.message } : undefined, ctx),
    { status }
  );
}

/**
 * 按格式序列化响应信封并输出
 */
function sendFormatted(c, body, query) {
  const { content, contentType, disposition } = serializeByFormat(body, query);
  const headers = {
    'Content-Type': contentType,
    'Cache-Control': 'public, max-age=300',
    'Vary': 'Accept-Encoding'
  };
  if (disposition) headers['Content-Disposition'] = disposition;
  return new Response(content, { headers });
}

// ============================================================
// GET /api/v1/ips — 集合（默认调用方自身 IP）
// ============================================================
app.get('/api/v1/ips', validate('query', geoQuerySchema), async(c) => {
  const startTime = Date.now();
  const requestId = c.get('requestId') || generateRequestId();
  const clientIP = c.get('clientIP') || c.req.header('CF-Connecting-IP') || '127.0.0.1';

  try {
    const query = c.req.valid('query');
    secureLogger.info('IP collection lookup', { requestId, clientIP, query });

    const body = await resolveGeo(c, clientIP, query, requestId);
    return sendFormatted(c, body, query);
  } catch (error) {
    return handleError(c, error, c.get('clientIP'), requestId, startTime);
  }
});

// ============================================================
// GET /api/v1/ips/self — 调用方自身 IP（显式，必须在 :ip 之前注册）
// ============================================================
app.get('/api/v1/ips/self', validate('query', geoQuerySchema), async(c) => {
  const startTime = Date.now();
  const requestId = c.get('requestId') || generateRequestId();
  const clientIP = c.get('clientIP') || c.req.header('CF-Connecting-IP') || '127.0.0.1';

  try {
    const query = c.req.valid('query');
    secureLogger.info('IP self lookup', { requestId, clientIP });

    const body = await resolveGeo(c, clientIP, query, requestId);
    // self 的 self 链接指向 /self
    body.links = buildLinks(getBaseUrl(c), {
      self: { href: `${getBaseUrl(c)}/api/v1/ips/self`, method: 'GET' },
      collection: { href: `${getBaseUrl(c)}/api/v1/ips`, method: 'GET' }
    });
    return sendFormatted(c, body, query);
  } catch (error) {
    return handleError(c, error, clientIP, requestId, startTime);
  }
});

// ============================================================
// GET /api/v1/ips/:ip — 指定 IP 资源
// ============================================================
app.get('/api/v1/ips/:ip',
  validate('param', ipParamSchema),
  validate('query', geoQuerySchema),
  async(c) => {
    const startTime = Date.now();
    const requestId = c.get('requestId') || generateRequestId();
    const { ip } = c.req.valid('param');

    try {
      const query = c.req.valid('query');
      secureLogger.info('IP resource lookup', { requestId, targetIP: ip, query });

      const body = await resolveGeo(c, ip, query, requestId);
      return sendFormatted(c, body, query);
    } catch (error) {
      return handleError(c, error, ip, requestId, startTime);
    }
  }
);

// ============================================================
// POST /api/v1/ips:batch — 批量查询（自定义方法）
// ============================================================
app.post('/api/v1/ips:batch', validate('query', geoQuerySchema), async(c) => {
  const startTime = Date.now();
  const requestId = c.get('requestId') || generateRequestId();
  const ctx = { requestId, startTime };

  let parsed;
  try {
    const raw = await c.req.json().catch(() => ({}));
    parsed = batchBodySchema.safeParse(raw);
  } catch (error) {
    return c.json(
      buildError('BAD_REQUEST', '请求体解析失败', ENVIRONMENT.isDevelopment() ? { error: error.message } : undefined, { ctx }),
      { status: 400 }
    );
  }

  if (!parsed.success) {
    const details = ENVIRONMENT.isDevelopment() ? { issues: parsed.error.issues } : undefined;
    return c.json(
      buildError('BAD_REQUEST', '批量请求体校验失败', details, { ctx }),
      { status: 400 }
    );
  }

  const { ips } = parsed.data;
  const query = c.req.valid('query');

  try {
    secureLogger.info('IP batch lookup', { requestId, ipCount: ips.length, format: query.format });

    const cfg = productionConfig();
    const concurrency = Math.min(ips.length, cfg.MAX_CONCURRENT_REQUESTS);
    const results = [];

    for (let i = 0; i < ips.length; i += concurrency) {
      const slice = ips.slice(i, i + concurrency);
      const batchResults = await Promise.all(slice.map(async(ip) => {
        try {
          const cacheKey = getCacheKey(ip, query);
          const cached = getFromCache(cacheKey);
          if (cached) {
            return { ip, data: cached.data, cached: true };
          }
          const geoInfo = await secureGeoLookup(ip, c.req, {
            language: query.lang, includeThreat: query.includeThreat
          });
          const resource = buildGeoResource(geoInfo, ip, query);
          setCache(cacheKey, { data: resource, links: null });
          return { ip, data: resource, cached: false };
        } catch (error) {
          secureLogger.warn('Batch lookup failed for IP', { requestId, ip, error: error.message });
          const isTimeout = error.name === 'TimeoutError' || error.message === 'Request timeout';
          return {
            ip,
            error: {
              code: isTimeout ? 'REQUEST_TIMEOUT' : 'GEOLOCATION_ERROR',
              message: isTimeout ? '请求超时' : '获取地理位置信息失败'
            }
          };
        }
      }));
      results.push(...batchResults);
    }

    const successful = results.filter((r) => !r.error);
    const failed = results.filter((r) => r.error);

    const base = getBaseUrl(c);
    const body = buildSuccess({
      results,
      summary: {
        total: ips.length,
        successful: successful.length,
        failed: failed.length,
        cached: successful.filter((r) => r.cached).length
      }
    }, {
      ctx,
      links: buildLinks(base, {
        self: { href: `${base}/api/v1/ips:batch`, method: 'POST' },
        collection: { href: `${base}/api/v1/ips`, method: 'GET' }
      }),
      meta: {
        query: {
          ipCount: ips.length,
          format: query.format,
          language: query.lang,
          includeThreat: query.includeThreat
        }
      }
    });

    secureLogger.performance('batch_geo_lookup', Date.now() - startTime, {
      requestId,
      ipCount: ips.length,
      successRate: ips.length ? `${(successful.length / ips.length * 100).toFixed(2)}%` : '0%'
    });

    return sendFormatted(c, body, query);
  } catch (error) {
    return handleError(c, error, 'batch', requestId, startTime);
  }
});

// 导出缓存/限流统计访问器（system 路由复用）
export { getCache, getRateLimitMap, productionConfig as getIpsProductionConfig };
export { app };
export default app;
