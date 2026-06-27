/**
 * 🔎 服务发现路由
 *
 * 公开端点（无需认证）：
 *   GET /                     服务根，HATEOAS 发现
 *   GET /health               轻量存活探针（k8s/LB 友好）
 *   GET /api/v1               API 版本发现
 *   GET /docs                 人类可读 API 文档
 *   GET /api/v1/openapi.json  OpenAPI 3.0 规范
 *
 * 详细健康检查（含组件状态）在 system.js 的 /api/v1/system/health。
 */

import { Hono } from 'hono';
import { generateRequestId } from '../utils/response.js';
import {
  buildSuccess,
  buildLinks,
  getBaseUrl,
  API_VERSION
} from '../utils/responseBuilder.js';
import { getMemoryUsage } from '../utils/runtime.js';
import { config } from '../config/configManager.js';

const app = new Hono();

/**
 * GET / — 服务根，HATEOAS 发现入口
 */
app.get('/', (c) => {
  const startTime = Date.now();
  const requestId = c.get('requestId') || generateRequestId();
  const ctx = { requestId };
  const base = getBaseUrl(c);

  const resource = {
    name: config.get('api.name', 'IP Geolocation API'),
    version: config.get('api.version', '2.0.0'),
    description: config.get('api.description', 'RESTful API for IP geolocation and threat detection'),
    specification: 'OpenAPI 3.0.3',
    environment: config.getStats().environment
  };

  const links = buildLinks(base, {
    self: { href: `${base}/`, method: 'GET' },
    api: { href: `${base}/api/v1`, method: 'GET' },
    openapi: { href: `${base}/api/v1/openapi.json`, method: 'GET' },
    docs: { href: `${base}/docs`, method: 'GET' },
    health: { href: `${base}/health`, method: 'GET' }
  });

  return c.json(buildSuccess(resource, { ctx, startTime, links }));
});

/**
 * GET /health — 轻量存活探针（不触发完整组件检查，适合高频探针）
 */
app.get('/health', (c) => {
  const startTime = Date.now();
  const requestId = c.get('requestId') || generateRequestId();
  const ctx = { requestId };

  const uptime = typeof process !== 'undefined' && typeof process.uptime === 'function'
    ? process.uptime()
    : 0;
  const memoryUsage = getMemoryUsage() || { heapUsed: 0, heapTotal: 1 };

  const resource = {
    status: 'healthy',
    uptimeSeconds: Math.floor(uptime),
    memoryUsagePercent: Math.round((memoryUsage.heapUsed / memoryUsage.heapTotal) * 100)
  };

  const base = getBaseUrl(c);
  const links = buildLinks(base, {
    self: { href: `${base}/health`, method: 'GET' },
    detailed: { href: `${base}/api/v1/system/health`, method: 'GET' },
    api: { href: `${base}/api/v1`, method: 'GET' }
  });

  return c.json(buildSuccess(resource, { ctx, startTime, links }));
});

/**
 * GET /api/v1 — API 版本发现（HATEOAS）
 */
app.get('/api/v1', (c) => {
  const startTime = Date.now();
  const requestId = c.get('requestId') || generateRequestId();
  const ctx = { requestId };
  const base = getBaseUrl(c);

  const resource = {
    apiVersion: API_VERSION,
    name: 'IP Geolocation API',
    releasedAt: '2026-06-14'
  };

  const links = buildLinks(base, {
    self: { href: `${base}/api/v1`, method: 'GET' },
    parent: { href: `${base}/`, method: 'GET' },
    openapi: { href: `${base}/api/v1/openapi.json`, method: 'GET' },
    ipsCollection: { href: `${base}/api/v1/ips`, method: 'GET' },
    ipsSelf: { href: `${base}/api/v1/ips/self`, method: 'GET' },
    ipsBatch: { href: `${base}/api/v1/ips:batch`, method: 'POST' },
    systemHealth: { href: `${base}/api/v1/system/health`, method: 'GET' }
  });

  return c.json(buildSuccess(resource, { ctx, startTime, links }));
});

/**
 * GET /docs — 人类可读 API 文档（端点清单）
 */
app.get('/docs', (c) => {
  const startTime = Date.now();
  const requestId = c.get('requestId') || generateRequestId();
  const ctx = { requestId };
  const base = getBaseUrl(c);

  const resource = {
    authentication: {
      header: 'X-API-Key',
      description: '所有 /api/v1/ips 与 /api/v1/system 端点需 API 密钥；运维端点需管理员密钥。'
    },
    publicEndpoints: [
      'GET /',
      'GET /health',
      'GET /docs',
      'GET /api/v1',
      'GET /api/v1/openapi.json'
    ],
    dataEndpoints: [
      'GET /api/v1/ips         查询集合（默认返回调用方自身 IP 的地理位置）',
      'GET /api/v1/ips/self    显式查询调用方自身 IP',
      'GET /api/v1/ips/:ip     查询指定 IP（公网 IP）',
      'POST /api/v1/ips:batch  批量查询（body: {"ips":["8.8.8.8","1.1.1.1"]}）'
    ],
    systemEndpoints: [
      'GET  /api/v1/system/health         详细健康检查',
      'GET  /api/v1/system/metrics        Prometheus / JSON 指标',
      'GET  /api/v1/system/status         监控状态报告',
      'GET  /api/v1/system/config         运行时配置（管理员）',
      'GET  /api/v1/system/alerts         告警（管理员）',
      'GET  /api/v1/system/memory         内存统计',
      'POST /api/v1/system/memory:cleanup 触发内存清理',
      'POST /api/v1/system/memory:optimize 触发内存优化',
      'GET  /api/v1/system/performance    性能统计'
    ],
    queryParameters: {
      format: 'json | xml | csv（默认 json）',
      lang: 'ISO 语言代码，如 en、zh',
      fields: '逗号分隔的字段投影，支持点路径（如 location.coordinates.latitude）',
      includeThreat: 'true | false，是否附带威胁/安全评估',
      pretty: 'true | false，JSON 美化输出',
      callback: 'JSONP 回调函数名（仅 format=json）',
      timeout: '请求超时毫秒数（100-10000）'
    },
    responseFormats: ['application/json', 'application/xml', 'text/csv', 'application/javascript (JSONP)']
  };

  const links = buildLinks(base, {
    self: { href: `${base}/docs`, method: 'GET' },
    openapi: { href: `${base}/api/v1/openapi.json`, method: 'GET' },
    api: { href: `${base}/api/v1`, method: 'GET' }
  });

  return c.json(buildSuccess(resource, { ctx, startTime, links }));
});

/**
 * GET /api/v1/openapi.json — OpenAPI 3.0 规范
 */
app.get('/api/v1/openapi.json', (c) => {
  const base = getBaseUrl(c);
  const serverUrl = base || 'https://localhost';

  c.header('Content-Type', 'application/json; charset=utf-8');
  c.header('Cache-Control', 'public, max-age=300');

  return c.body(JSON.stringify(buildOpenApiSpec(serverUrl), null, 2));
});

/**
 * 构造 OpenAPI 3.0.3 规范文档
 */
function buildOpenApiSpec(serverUrl) {
  const securityScheme = {
    ApiKeyAuth: {
      type: 'apiKey',
      in: 'header',
      name: 'X-API-Key',
      description: 'API 密钥认证。/api/v1/system/* 端点需管理员密钥。'
    }
  };

  return {
    openapi: '3.0.3',
    info: {
      title: 'IP Geolocation API',
      version: '2.0.0',
      description: 'RESTful API for IP geolocation and threat detection. Edge-optimized (Cloudflare Workers).',
      license: { name: 'MIT' }
    },
    servers: [{ url: serverUrl, description: 'current' }],
    components: {
      securitySchemes: securityScheme,
      schemas: {
        Error: {
          type: 'object',
          required: ['error', 'meta'],
          properties: {
            error: {
              type: 'object',
              required: ['code', 'message'],
              properties: {
                code: { type: 'string', example: 'INVALID_IP' },
                message: { type: 'string' },
                details: { type: 'object' }
              }
            },
            meta: { $ref: '#/components/schemas/Meta' }
          }
        },
        Meta: {
          type: 'object',
          properties: {
            requestId: { type: 'string' },
            timestamp: { type: 'string', format: 'date-time' },
            apiVersion: { type: 'string', example: 'v1' },
            processingTimeMs: { type: 'integer' }
          }
        },
        GeoLocation: {
          type: 'object',
          properties: {
            ip: { type: 'string', example: '8.8.8.8' },
            type: { type: 'string', enum: ['ipv4', 'ipv6'] },
            version: { type: 'integer' },
            flag: { type: 'string', nullable: true },
            country: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                code: { type: 'string' },
                region: { type: 'string' },
                city: { type: 'string' },
                continent: { type: 'string' },
                continentCode: { type: 'string' }
              }
            },
            location: {
              type: 'object',
              properties: {
                coordinates: {
                  type: 'object',
                  properties: {
                    latitude: { type: 'number' },
                    longitude: { type: 'number' },
                    accuracy: { type: 'number' }
                  }
                },
                timezone: { type: 'string' },
                postalCode: { type: 'string' }
              }
            },
            network: {
              type: 'object',
              properties: {
                asn: { type: 'integer', nullable: true },
                organization: { type: 'string' },
                isp: { type: 'string' },
                domain: { type: 'string' }
              }
            },
            provider: { type: 'string' }
          }
        },
        BatchRequest: {
          type: 'object',
          required: ['ips'],
          properties: {
            ips: {
              type: 'array',
              items: { type: 'string' },
              minItems: 1,
              maxItems: 100,
              description: '公网 IP 列表（私有/保留地址会被拒绝）'
            }
          }
        },
        BatchResult: {
          type: 'object',
          description: '单条批量结果：成功含 data+cached，失败含 error（二者互斥，无 success 布尔）',
          properties: {
            ip: { type: 'string' },
            data: { $ref: '#/components/schemas/GeoLocation' },
            error: {
              type: 'object',
              properties: {
                code: { type: 'string' },
                message: { type: 'string' }
              }
            },
            cached: { type: 'boolean' }
          }
        }
      },
      parameters: {
        FormatParam: {
          name: 'format', in: 'query', required: false,
          schema: { type: 'string', enum: ['json', 'xml', 'csv'], default: 'json' }
        },
        IncludeThreatParam: {
          name: 'includeThreat', in: 'query', required: false,
          schema: { type: 'boolean', default: false }
        },
        FieldsParam: {
          name: 'fields', in: 'query', required: false,
          schema: { type: 'string' },
          description: '逗号分隔字段投影，支持点路径'
        },
        LangParam: {
          name: 'lang', in: 'query', required: false,
          schema: { type: 'string', default: 'en' }
        }
      }
    },
    paths: {
      '/': {
        get: {
          tags: ['discovery'],
          summary: '服务根（HATEOAS 发现）',
          security: [],
          responses: okRef('服务根信息')
        }
      },
      '/health': {
        get: {
          tags: ['discovery'],
          summary: '轻量存活探针',
          security: [],
          responses: okRef('存活状态')
        }
      },
      '/api/v1': {
        get: {
          tags: ['discovery'],
          summary: 'API 版本发现',
          security: [],
          responses: okRef('版本信息与端点链接')
        }
      },
      '/api/v1/openapi.json': {
        get: {
          tags: ['discovery'],
          summary: 'OpenAPI 3.0 规范',
          security: [],
          responses: { '200': { description: 'OpenAPI 文档' } }
        }
      },
      '/api/v1/ips': {
        get: {
          tags: ['ips'],
          summary: 'IP 集合（默认返回调用方自身 IP 的地理位置）',
          security: [{ ApiKeyAuth: [] }],
          parameters: [
            { $ref: '#/components/parameters/FormatParam' },
            { $ref: '#/components/parameters/IncludeThreatParam' },
            { $ref: '#/components/parameters/FieldsParam' },
            { $ref: '#/components/parameters/LangParam' }
          ],
          responses: {
            ...okRef('调用方自身 IP 的地理位置资源'),
            '401': errorRef(),
            '429': errorRef()
          }
        }
      },
      '/api/v1/ips/self': {
        get: {
          tags: ['ips'],
          summary: '调用方自身 IP（显式）',
          security: [{ ApiKeyAuth: [] }],
          parameters: [
            { $ref: '#/components/parameters/FormatParam' },
            { $ref: '#/components/parameters/IncludeThreatParam' }
          ],
          responses: { ...okRef('调用方自身 IP 资源'), '401': errorRef() }
        }
      },
      '/api/v1/ips/{ip}': {
        get: {
          tags: ['ips'],
          summary: '指定 IP 的地理位置资源',
          security: [{ ApiKeyAuth: [] }],
          parameters: [
            { name: 'ip', in: 'path', required: true, schema: { type: 'string' }, description: '公网 IPv4/IPv6' },
            { $ref: '#/components/parameters/FormatParam' },
            { $ref: '#/components/parameters/IncludeThreatParam' },
            { $ref: '#/components/parameters/FieldsParam' }
          ],
          responses: {
            ...okRef('指定 IP 的地理位置资源'),
            '400': errorRef(),
            '401': errorRef(),
            '404': errorRef()
          }
        }
      },
      '/api/v1/ips:batch': {
        post: {
          tags: ['ips'],
          summary: '批量 IP 查询（自定义方法）',
          security: [{ ApiKeyAuth: [] }],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/BatchRequest' } } }
          },
          parameters: [
            { $ref: '#/components/parameters/FormatParam' },
            { $ref: '#/components/parameters/IncludeThreatParam' }
          ],
          responses: {
            '200': {
              description: '批量查询结果',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      data: {
                        type: 'object',
                        properties: {
                          results: { type: 'array', items: { $ref: '#/components/schemas/BatchResult' } },
                          summary: {
                            type: 'object',
                            properties: {
                              total: { type: 'integer' },
                              successful: { type: 'integer' },
                              failed: { type: 'integer' },
                              cached: { type: 'integer' }
                            }
                          }
                        }
                      },
                      meta: { $ref: '#/components/schemas/Meta' }
                    }
                  }
                }
              }
            },
            '400': errorRef(),
            '401': errorRef()
          }
        }
      },
      '/api/v1/system/health': {
        get: {
          tags: ['system'],
          summary: '详细健康检查（组件级）',
          security: [{ ApiKeyAuth: [] }],
          responses: { ...okRef('详细健康状态'), '403': errorRef() }
        }
      },
      '/api/v1/system/metrics': {
        get: {
          tags: ['system'],
          summary: 'Prometheus / JSON 指标',
          security: [{ ApiKeyAuth: [] }],
          parameters: [{ name: 'format', in: 'query', schema: { type: 'string', enum: ['prometheus', 'json'] } }],
          responses: { '200': { description: '指标数据' }, '403': errorRef() }
        }
      },
      '/api/v1/system/status': sysGet('监控状态报告', '监控状态'),
      '/api/v1/system/config': sysGet('运行时配置（脱敏）', '配置'),
      '/api/v1/system/alerts': sysGet('活跃/历史告警', '告警'),
      '/api/v1/system/memory': sysGet('内存统计', '内存统计'),
      '/api/v1/system/memory:cleanup': sysGet('触发内存清理', '清理结果', 'post'),
      '/api/v1/system/memory:optimize': sysGet('触发内存优化', '优化结果', 'post'),
      '/api/v1/system/performance': sysGet('性能统计', '性能统计')
    }
  };
}

function okRef(description) {
  return {
    '200': {
      description,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              data: { $ref: '#/components/schemas/GeoLocation' },
              meta: { $ref: '#/components/schemas/Meta' },
              links: { type: 'object' }
            }
          }
        }
      }
    }
  };
}

function errorRef() {
  return {
    description: '错误',
    content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } }
  };
}

/**
 * 构造 system 端点的标准 OpenAPI 条目（统一 tags/security/responses）
 */
function sysGet(summary, okDesc, method = 'get') {
  return {
    [method]: {
      tags: ['system'],
      summary,
      security: [{ ApiKeyAuth: [] }],
      responses: { ...okRef(okDesc), '403': errorRef() }
    }
  };
}

export { app, buildOpenApiSpec };
export default app;
