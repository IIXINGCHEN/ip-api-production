/**
 * 🌐 客户端 IP 平台信任链测试（B1 回归）
 */

import { describe, it, expect, afterEach } from 'vitest';
import { getTrustedClientIP, getBestEffortClientIP } from '../../src/utils/clientIp.js';

const mkReq = (headers = {}) => ({ headers: new Headers(headers) });

describe('clientIp 平台信任链', () => {
  const origEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...origEnv };
  });

  it('CF-Connecting-IP 存在时始终可信（Cloudflare 边缘注入，客户端无法伪造）', () => {
    expect(getTrustedClientIP(mkReq({ 'cf-connecting-ip': '203.0.113.10' }))).toBe('203.0.113.10');
  });

  it('伪造/非法的 CF-Connecting-IP 被拒绝', () => {
    expect(getTrustedClientIP(mkReq({ 'cf-connecting-ip': 'not-an-ip' }))).toBeNull();
  });

  it('非 CF、非 Vercel/Netlify 入口：XFF 不可信 → null（限流回退 unknown 紧限流桶）', () => {
    expect(getTrustedClientIP(mkReq({ 'x-forwarded-for': '1.2.3.4' }))).toBeNull();
  });

  it('Vercel 上 X-Forwarded-For 左值可信（平台边缘覆写）', () => {
    process.env.VERCEL = '1';
    expect(getTrustedClientIP(mkReq({ 'x-forwarded-for': '1.2.3.4, 5.6.7.8' }))).toBe('1.2.3.4');
  });

  it('Netlify（CONTEXT env）上 XFF 左值可信', () => {
    process.env.NETLIFY = 'true';
    process.env.CONTEXT = 'production';
    expect(getTrustedClientIP(mkReq({ 'x-forwarded-for': '8.8.8.8' }))).toBe('8.8.8.8');
  });

  it('getBestEffortClientIP 回退链：CF → XFF → X-Real-IP → 127.0.0.1', () => {
    expect(getBestEffortClientIP(mkReq({}))).toBe('127.0.0.1');
    expect(getBestEffortClientIP(mkReq({ 'x-real-ip': '9.9.9.9' }))).toBe('9.9.9.9');
    expect(getBestEffortClientIP(mkReq({ 'x-forwarded-for': '4.4.4.4, 1.1.1.1' }))).toBe('4.4.4.4');
  });
});
