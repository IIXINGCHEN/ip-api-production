/**
 * 🔬 测试环境设置
 * 提供全局测试工具和模拟环境
 */

import { vi } from 'vitest';

// 模拟console方法进行测试
global.console = {
  log: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn()
};

// 模拟环境变量，不替换 Node.js 的 process 对象，避免丢失 uptime/memoryUsage 等运行时 API。
if (typeof process !== 'undefined') {
  process.env.NODE_ENV = 'test';
  process.env.ENVIRONMENT = 'test';
  process.env.API_KEY_USER = 'sk-test-1234567890abcdef';
  process.env.API_KEY_ADMIN = 'test-admin-key-12345';
}

globalThis.API_KEY_USER = 'sk-test-1234567890abcdef';
globalThis.API_KEY_ADMIN = 'test-admin-key-12345';

// 测试工具函数
export const createMockRequest = (url = '/', options = {}) => {
  const requestUrl = url.startsWith('http')
    ? url
    : `https://example.test${url.startsWith('/') ? url : `/${url}`}`;
  const request = new Request(requestUrl, options);
  request.path = new URL(requestUrl).pathname;
  request.header = (name) => request.headers.get(name);
  return request;
};

export const createMockResponse = (body = {}, status = 200) => {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
};

// 测试数据生成器
export const generateTestIP = () => {
  const random = () => Math.floor(Math.random() * 256);
  return `${random()}.${random()}.${random()}.${random()}`;
};

export const generateTestIPv6 = () => {
  const segments = Array(8).fill(0).map(() =>
    Math.floor(Math.random() * 65536).toString(16)
  );
  return segments.join(':');
};

// 安全相关测试数据
export const testIPs = {
  // 合法ISP
  legitimateISP: '1.2.3.4', // 中国联通
  legitimateISP2: '118.112.10.1', // 中国电信

  // 合法服务
  cloudflare: '104.16.100.1',
  aws: '52.94.1.1',
  google: '8.8.8.8',

  // 可疑IP（用于测试）
  suspicious: '185.220.101.1', // 已知代理/VPN范围
  tor: '185.220.100.1', // Tor出口节点

  // 内网IP
  private: '192.168.1.1',
  loopback: '127.0.0.1',

  // 无效IP
  invalid: '999.999.999.999',
  malformed: 'not-an-ip'
};

// 威胁检测测试用例
export const threatTestCases = {
  legitimateBot: {
    userAgent: 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
    expectedRisk: 0
  },
  suspiciousBot: {
    userAgent: 'Python-requests/2.28.1',
    expectedRisk: 20
  },
  maliciousBot: {
    userAgent: 'bot-scan-malicious/1.0',
    expectedRisk: 25
  },
  proxyUser: {
    headers: {
      'x-forwarded-for': '192.168.1.1, 10.0.0.1, 203.0.113.1',
      'via': 'proxy-server'
    },
    expectedRisk: 30
  },
  cdnUser: {
    headers: {
      'cf-connecting-ip': '203.0.113.1',
      'cf-ray': '7a1b2c3d4e5f',
      'x-amz-cf-id': 'abcd1234'
    },
    expectedRisk: 0 // CDN使用不应增加风险
  }
};

// 清理函数
export const cleanup = () => {
  vi.clearAllMocks();
};

// 全局设置
beforeEach(() => {
  // 每个测试前清理模拟
  vi.clearAllMocks();
});

afterEach(() => {
  // 每个测试后清理
  cleanup();
});
