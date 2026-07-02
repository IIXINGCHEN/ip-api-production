/**
 * 🔌 RequestAdapter — toCtx 单元测试
 * 锁定 Hono/Workerd/bare Request 三种 shape 的 { cf, headers } 提取契约。
 */

import { describe, it, expect } from 'vitest';
import { toCtx } from '../../src/utils/requestAdapter.js';

describe('requestAdapter.toCtx', () => {
  it('workerd 裸 Request：直接读 .cf / .headers', () => {
    const headers = new Headers({ 'x-test': '1' });
    const cf = { colo: 'SFO', country: 'US' };
    const req = { cf, headers };

    const ctx = toCtx(req);

    expect(ctx.cf).toBe(cf);
    expect(ctx.headers).toBe(headers);
  });

  it('Hono 形状：c.req.raw.cf / c.req.raw.headers（外层无 .cf/.headers）', () => {
    const rawCf = { colo: 'LHR' };
    const rawHeaders = new Headers({ via: 'hono' });
    const req = { raw: { cf: rawCf, headers: rawHeaders } };

    const ctx = toCtx(req);

    expect(ctx.cf).toBe(rawCf);
    expect(ctx.headers).toBe(rawHeaders);
  });

  it('Mock / 缺字段：cf 为 undefined，headers 回落到 new Headers()', () => {
    const ctx = toCtx({});

    expect(ctx.cf).toBeUndefined();
    expect(ctx.headers).toBeInstanceOf(Headers);
  });

  it('undefined 入参：cf 为 undefined，headers 回落', () => {
    const ctx = toCtx(undefined);

    expect(ctx.cf).toBeUndefined();
    expect(ctx.headers).toBeInstanceOf(Headers);
  });
});
