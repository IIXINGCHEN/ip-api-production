/**
 * 🔬 速率限制 skipEndpoints 白名单测试
 *
 * 覆盖修复 #2：/health、/docs、/v1、/metrics、/ 不应被全局限流计数。
 * 否则健康检查和监控抓取会在 100 req/15min 之后开始 429，破坏 LB。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// mock cleanupAuthData 之类的副作用
vi.mock('../../src/utils/errorHandler.js', () => ({
  ErrorFactory: {
    create: (_type, message, details) => ({
      toResponse: () => ({
        success: false,
        error: { code: 'TOO_MANY_REQUESTS', message, details }
      })
    })
  },
  ERROR_TYPES: { TOO_MANY_REQUESTS: 'TOO_MANY_REQUESTS' }
}));

import { createRateLimitMiddleware, resetRateLimit, resetAllRateLimits } from '../../src/middleware/rateLimitFixed.js';

const makeContext = (path, clientIP) => {
  const headers = {};
  const ctx = {
    req: { path },
    res: { status: 200 },
    clientIP,
    // 限流键现为 trustedClientIP（B1 平台信任链）；同时暴露 clientIP 供其他读取
    get: (k) => ((k === 'clientIP' || k === 'trustedClientIP') ? clientIP : null),
    header: (k, v) => { headers[k] = v; },
    json: (body, init) => ({ body, init, status: init?.status || 200 })
  };
  ctx._headers = headers;
  return ctx;
};

// 每个 test 用一个唯一的 clientIP，避免共享 rateLimitStore 内的条目互相污染
let testCounter = 0;
const uniqueIP = () => `10.${++testCounter}.${++testCounter}.${++testCounter}`;

describe('rateLimitFixed skipEndpoints', () => {
  beforeEach(() => {
    // 清空 store 实现测试隔离（替代之前的 uniqueIP workaround）
    resetAllRateLimits();
  });

  it('public endpoints bypass the limiter (never set X-RateLimit headers)', async() => {
    const mw = createRateLimitMiddleware({
      max: 2,
      skipEndpoints: ['/health', '/', '/docs', '/v1', '/metrics']
    });
    const next = vi.fn(async() => {});
    const ip = uniqueIP();

    // Hit /health 200 times
    for (let i = 0; i < 200; i++) {
      const c = makeContext('/health', ip);
      await mw(c, next);
    }
    expect(next).toHaveBeenCalledTimes(200);

    // 限流头不应出现在跳过的端点上
    const c = makeContext('/health', ip);
    await mw(c, next);
    expect(c._headers['X-RateLimit-Limit']).toBeUndefined();
  });

  it('non-public endpoints count against the limit', async() => {
    const mw = createRateLimitMiddleware({
      max: 3,
      skipEndpoints: ['/health']
    });
    const next = vi.fn(async() => {});
    const ip = uniqueIP();

    const responses = [];
    for (let i = 0; i < 5; i++) {
      const c = makeContext('/geo', ip);
      const result = await mw(c, next);
      responses.push(result);
    }

    expect(next).toHaveBeenCalledTimes(3);
    // 第 4、5 次被 429
    expect(responses[3].status).toBe(429);
    expect(responses[4].status).toBe(429);
  });

  it('exact-match only: /healthadmin is NOT treated as /health', async() => {
    const mw = createRateLimitMiddleware({
      max: 2,
      skipEndpoints: ['/health']
    });
    const next = vi.fn(async() => {});
    const ip = uniqueIP();

    const responses = [];
    for (let i = 0; i < 4; i++) {
      const c = makeContext('/healthadmin', ip);
      responses.push(await mw(c, next));
    }

    expect(next).toHaveBeenCalledTimes(2);
    expect(responses[2].status).toBe(429);
  });

  it('prefix-match via trailing-slash: /api/ matches /api/v1/geo', async() => {
    const mw = createRateLimitMiddleware({
      max: 1,
      skipEndpoints: ['/api/']
    });
    const next = vi.fn(async() => {});
    const ip = uniqueIP();

    for (let i = 0; i < 5; i++) {
      await mw(makeContext('/api/v1/geo', ip), next);
    }
    expect(next).toHaveBeenCalledTimes(5);
  });

  it('empty skip list means no bypass', async() => {
    const mw = createRateLimitMiddleware({ max: 1 });
    const next = vi.fn(async() => {});
    const ip = uniqueIP();

    const responses = [];
    for (let i = 0; i < 3; i++) {
      responses.push(await mw(makeContext('/health', ip), next));
    }
    expect(next).toHaveBeenCalledTimes(1);
    expect(responses[1].status).toBe(429);
  });

  it('REGRESSION: bare "/" prefix must NOT match every path (e.g. /geo)', async() => {
    // 之前实现把 "/" 当作前缀，会让所有 path 都被跳过。修复后只精确匹配 "/" 本身。
    const mw = createRateLimitMiddleware({
      max: 1,
      skipEndpoints: ['/health', '/', '/docs', '/v1', '/metrics']
    });
    const next = vi.fn(async() => {});
    const ip = uniqueIP();

    // /geo 不在 skip 列表，必须被计数
    const r1 = await mw(makeContext('/geo', ip), next);
    const r2 = await mw(makeContext('/geo', ip), next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(r2.status).toBe(429);

    // 但根路径 "/" 仍应被跳过
    const next2 = vi.fn(async() => {});
    await mw(makeContext('/', uniqueIP()), next2);
    await mw(makeContext('/', uniqueIP()), next2);
    expect(next2).toHaveBeenCalledTimes(2); // 两次都应通过
  });
});
