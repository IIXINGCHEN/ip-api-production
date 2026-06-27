/**
 * 🔒 威胁检测服务安全测试
 * 重点测试白名单功能和误报减少
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ThreatService } from '../../src/services/threatService.js';
import {
  createMockRequest,
  testIPs,
  threatTestCases
} from '../setup.js';

describe('ThreatService - Security Tests', () => {
  let threatService;

  beforeEach(() => {
    threatService = new ThreatService();
  });

  describe('VPN检测 - 误报减少测试', () => {
    it('应该正确排除合法ISP的VPN检测', async() => {
      const legitimateISPRequest = createMockRequest('/', {
        headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
      });

      // 测试中国联通IP
      const result1 = await threatService.checkVPN(testIPs.legitimateISP, legitimateISPRequest);
      expect(result1.detected).toBe(false);
      expect(result1.riskScore).toBe(0);
      // IP 名誉白名单已移除：干净请求无 VPN 信号 → detected=false/score=0，不再注入 legitimate_isp

      // 测试��国电信IP
      const result2 = await threatService.checkVPN(testIPs.legitimateISP2, legitimateISPRequest);
      expect(result2.detected).toBe(false);
      expect(result2.riskScore).toBe(0);
    });

    it('应该正确排除合法数据中心的VPN检测', async() => {
      const datacenterRequest = createMockRequest('/', {
        headers: {
          'x-forwarded-for': '203.0.113.1',
          'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });

      const result = await threatService.checkVPN(testIPs.aws, datacenterRequest);
      expect(result.detected).toBe(false);
      expect(result.riskScore).toBe(0);
      // IP 名誉白名单已移除：不再注入 legitimate_* 指示；干净请求无 VPN 信号 → detected=false/score=0
      expect(result.detected).toBe(false);
      expect(result.riskScore).toBe(0);
    });

    it('应该正确排除合法服务提供商的VPN检测', async() => {
      const cdnRequest = createMockRequest('/', {
        headers: {
          'cf-connecting-ip': '203.0.113.1',
          'cf-ray': '7a1b2c3d4e5f',
          'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });

      const result = await threatService.checkVPN(testIPs.cloudflare, cdnRequest);
      expect(result.detected).toBe(false);
      expect(result.riskScore).toBe(0);
      // IP 名誉白名单已移除：不再注入 legitimate_* 指示；干净请求无 VPN 信号即可
      expect(result.detected).toBe(false);
      expect(result.riskScore).toBe(0);
    });

    it('应该正确检测可疑VPN使用', async() => {
      const suspiciousRequest = createMockRequest('/', {
        headers: {
          'x-forwarded-for': '203.0.113.1, 198.51.100.1',
          'x-vpn-client': 'OpenVPN',
          'user-agent': 'OpenVPN Client'
        }
      });

      const result = await threatService.checkVPN(testIPs.suspicious, suspiciousRequest);
      expect(result.detected).toBe(true);
      expect(result.riskScore).toBeGreaterThan(50);
    });

    // 回归保护：x-forwarded-proto / x-original-forwarded-for 是标准反向代理/CDN 头，
    // 任何 HTTPS 反代都会设置，并非 VPN 特征，不应据此判为 VPN。
    it('应该正确排除标准代理头部被标记为VPN', async() => {
      const proxyRequests = [
        createMockRequest('/', { headers: { 'x-forwarded-proto': 'https' } }),
        createMockRequest('/', { headers: { 'x-original-forwarded-for': '203.0.113.1' } }),
        createMockRequest('/', { headers: { 'cf-connecting-ip': '203.0.113.1', 'x-forwarded-proto': 'https' } })
      ];

      for (const request of proxyRequests) {
        const result = await threatService.checkVPN(testIPs.cloudflare, request);
        expect(result.detected).toBe(false);
      }
    });
  });

  describe('代理检测 - CDN误报减少测试', () => {
    it('应该正确排除CDN使用被标记为代理', async() => {
      const cdnRequests = [
        // Cloudflare CDN
        createMockRequest('/', {
          headers: {
            'cf-connecting-ip': '203.0.113.1',
            'cf-ipcountry': 'US',
            'cf-ray': '7a1b2c3d4e5f',
            'x-forwarded-for': '203.0.113.1'
          }
        }),
        // AWS CloudFront
        createMockRequest('/', {
          headers: {
            'x-amz-cf-id': 'abcd1234efgh5678',
            'x-forwarded-for': '203.0.113.1'
          }
        }),
        // Akamai CDN
        createMockRequest('/', {
          headers: {
            'x-served-by': 'akamaighost',
            'x-cache': 'HIT',
            'x-forwarded-for': '203.0.113.1'
          }
        }),
        // Fastly CDN
        createMockRequest('/', {
          headers: {
            'x-cache': 'MISS',
            'x-served-by': 'cache-lhr7345-LHR',
            'x-forwarded-for': '203.0.113.1'
          }
        })
      ];

      for (const request of cdnRequests) {
        const result = await threatService.checkProxy(testIPs.cloudflare, request);
        process.stdout.write(`DEBUG detected=${result.detected} score=${result.riskScore} indicators=${JSON.stringify(result.indicators)}\n`);
        expect(result.detected).toBe(false);
        expect(result.riskScore).toBe(0);
      }
    });

    it('应该正确检测真正的代理使用', async() => {
      const proxyRequest = createMockRequest('/', {
        headers: {
          'x-forwarded-for': '192.168.1.1, 10.0.0.1, 203.0.113.1',
          'via': 'proxy-server, another-proxy',
          'x-proxy-id': 'proxy-123',
          'x-forwarded-host': 'example.com'
        }
      });

      const result = await threatService.checkProxy(testIPs.suspicious, proxyRequest);
      expect(result.detected).toBe(true);
      expect(result.riskScore).toBeGreaterThan(30);
      expect(result.indicators).toContain('strong_proxy_detected');
    });

    it('应该使用analyzeProxyHeaders减少误报', async() => {
      const cdnRequest = createMockRequest('/', {
        headers: {
          'cf-connecting-ip': '203.0.113.1',
          'cf-ray': '7a1b2c3d4e5f',
          'x-forwarded-for': '203.0.113.1' // 单个X-Forwarded-For不应可疑
        }
      });

      const result = threatService.analyzeProxyHeaders(cdnRequest);
      expect(result.detected).toBe(false);
      expect(result.score).toBe(0);
      expect(result.indicators).toContain('cdn_usage');
    });
  });

  describe('机器人检测 - 合法机器人识别测试', () => {
    it('应该正确识别合法搜索引擎机器人', async() => {
      const legitimateBots = [
        {
          userAgent: 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
          expectedIndicators: ['legitimate_bot']
        },
        {
          userAgent: 'Mozilla/5.0 (compatible; Bingbot/2.0; +http://www.bing.com/bingbot.htm)',
          expectedIndicators: ['legitimate_bot']
        },
        {
          userAgent: 'Mozilla/5.0 (compatible; YandexBot/3.0; +http://yandex.com/bots)',
          expectedIndicators: ['legitimate_bot']
        },
        {
          userAgent: 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
          expectedIndicators: ['legitimate_bot']
        }
      ];

      for (const bot of legitimateBots) {
        const request = createMockRequest('/', {
          headers: { 'user-agent': bot.userAgent }
        });

        const result = await threatService.checkBot(testIPs.cloudflare, request);
        expect(result.detected).toBe(false);
        expect(result.riskScore).toBe(0);
        expect(result.indicators).toContain('legitimate_bot');
      }
    });

    it('应该正确检测可疑机器人', async() => {
      const suspiciousBots = [
        {
          userAgent: 'Python-requests/2.28.1',
          expectedRisk: 20
        },
        {
          userAgent: 'bot-scan-malicious/1.0',
          expectedRisk: 25
        },
        {
          userAgent: 'scraper-aggressive/2.0',
          expectedRisk: 25
        }
      ];

      for (const bot of suspiciousBots) {
        const request = createMockRequest('/', {
          headers: { 'user-agent': bot.userAgent }
        });

        const result = await threatService.checkBot(testIPs.suspicious, request);
        expect(result.riskScore).toBeGreaterThanOrEqual(bot.expectedRisk);
      }
    });

    it('应该降低开发工具的风险分数', async() => {
      const devTools = [
        'curl/7.68.0',
        'Wget/1.21.1',
        'PostmanRuntime/7.29.0'
      ];

      for (const tool of devTools) {
        const request = createMockRequest('/', {
          headers: { 'user-agent': tool }
        });

        const result = await threatService.checkBot(testIPs.suspicious, request);
        expect(result.riskScore).toBeLessThan(15); // 应该有较低的风险分数
        expect(result.indicators).toContain('development_tool');
      }
    });

    // 回归保护：CDN/边缘健康检查常缺失 UA/accept-* 头，不应因此被判为 bot。
    // 与 checkProxy 的 CDN 短路修复同类（analyzeProxyHeaders 识别为 cdn_usage）。
    it('应该正确排除CDN无UA请求被标记为机器人', async() => {
      const cdnRequests = [
        createMockRequest('/', { headers: { 'cf-connecting-ip': '203.0.113.1', 'cf-ray': '7a1b2c3d4e5f' } }),
        createMockRequest('/', { headers: { 'x-amz-cf-id': 'abcd1234', 'x-forwarded-for': '203.0.113.1' } }),
        createMockRequest('/', { headers: { 'x-served-by': 'akamaighost', 'x-cache': 'HIT' } })
      ];

      for (const request of cdnRequests) {
        const result = await threatService.checkBot(testIPs.cloudflare, request);
        expect(result.detected).toBe(false);
      }
    });

    // 回归保护：CDN 短路只应保护真正的无头健康检查，不能放过携带恶意 UA 的请求。
    // 攻击者可随意伪造 cf-ray/x-cache 等未签名头，若据此无条件跳过 bot 检测，
    // 则 bot-scan-malicious/scraper-aggressive 等将完全绕过检测。
    it('应该仍检测携带CDN头但带恶意UA的请求（防伪造头规避）', async() => {
      const maliciousWithCdnHeaders = [
        createMockRequest('/', { headers: { 'cf-ray': 'fake', 'user-agent': 'bot-scan-malicious/1.0' } }),
        createMockRequest('/', { headers: { 'x-cache': 'HIT', 'user-agent': 'scraper-aggressive/2.0' } }),
        createMockRequest('/', { headers: { 'cf-connecting-ip': '203.0.113.1', 'user-agent': 'crawler-aggressive-scan/3.0' } })
      ];

      for (const request of maliciousWithCdnHeaders) {
        const result = await threatService.checkBot(testIPs.suspicious, request);
        expect(result.detected).toBe(true);
      }
    });
  });

  // 2026-06-25 设计审查：已移除基于 IP 前缀的「合法 ISP/服务/数据中心」名誉白名单
  // （整段 /8 放行会制造���胁检测盲区，且声称的所有者并不拥有该 /8）。
  // 威胁检测改为信号驱动。干净 IP 无恶意信号时：reputation='unknown'、riskScore=0、
  // 不注入 legitimate_* 指示。这些用例验证新行为，而非旧白名单提升。
  describe('声誉检查 - 信号驱动行为测试', () => {
    it('应该为合法ISP网段返回中性声誉（无白名单提升）', async() => {
      const request = createMockRequest('/');

      const result = await threatService.checkReputation(testIPs.legitimateISP, request);
      expect(result.reputation).toBe('unknown');
      expect(result.riskScore).toBe(0);
      expect(result.indicators).not.toContain('legitimate_isp');
    });

    it('应该为云服务IP返回中性声誉（无白名单提升）', async() => {
      const request = createMockRequest('/');

      const result = await threatService.checkReputation(testIPs.cloudflare, request);
      expect(result.reputation).toBe('unknown');
      expect(result.riskScore).toBe(0);
      expect(result.indicators).not.toContain('legitimate_service');
    });

    it('应该为数据中心IP返回中性声誉（无白名单提升）', async() => {
      const request = createMockRequest('/');

      const result = await threatService.checkReputation(testIPs.aws, request);
      expect(result.reputation).toBe('unknown');
      expect(result.riskScore).toBe(0);
      expect(result.indicators).not.toContain('legitimate_datacenter');
    });
  });

  describe('Tor检测测试', () => {
    it('应该正确检测Tor浏览器用户', async() => {
      const torRequest = createMockRequest('/', {
        headers: {
          'user-agent': 'Mozilla/5.0 (Windows NT 10.0; rv:68.0) Gecko/20100101 Firefox/68.0'
        }
      });

      const result = await threatService.checkTor(testIPs.tor, torRequest);
      expect(result.detected).toBe(true);
      expect(result.riskScore).toBeGreaterThan(0);
    });

    it('应该检测Tor出口节点IP', async() => {
      const request = createMockRequest('/');

      const result = await threatService.checkTor(testIPs.tor, request);
      expect(result.detected).toBe(true);
      expect(result.riskScore).toBeGreaterThan(0);
      expect(result.indicators).toContain('tor_exit_node');
    });
  });

  describe('恶意活动检测测试', () => {
    it('应该检测常见攻击模式', async() => {
      const attackPatterns = [
        { path: '../../../etc/passwd', expectedRisk: 60 },
        { path: 'admin.php?union+select+*+from+users', expectedRisk: 60 },
        { path: '<script>alert("xss")</script>', expectedRisk: 60 },
        { path: 'eval(base64_decode("malicious"))', expectedRisk: 60 },
        { path: 'cmd=whoami', expectedRisk: 60 }
      ];

      for (const pattern of attackPatterns) {
        const request = createMockRequest(pattern.path);
        const result = await threatService.checkMaliciousActivity(testIPs.suspicious, request);
        expect(result.detected).toBe(true);
        expect(result.riskScore).toBeGreaterThanOrEqual(pattern.expectedRisk);
      }
    });

    // 回归保护：decodeRequestTarget 曾只解码一次，双重编码 %252e%252e%252f 解一层后
    // 仍是 %2e%2e%2f，绕过 /\.\./ 检测。须循环解码到稳定（上限 3 次）。
    it('应该检测双重编码的路径遍历攻击', async() => {
      const doubleEncodedAttacks = [
        '%252e%252e%252f%252e%252e%252fetc%252fpasswd', // ../ ../etc/passwd 双重编码
        '%252e%252e%252f%252e%252e%252f%252e%252e%252fwinnt%252fsystem32'
      ];

      for (const path of doubleEncodedAttacks) {
        const request = createMockRequest(path);
        const result = await threatService.checkMaliciousActivity(testIPs.suspicious, request);
        expect(result.detected).toBe(true);
      }
    });
  });

  describe('综合威胁评分测试', () => {
    it('应该为合法用户提供最小风险评分', async() => {
      const legitimateRequest = createMockRequest('/', {
        headers: {
          'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'accept-language': 'en-US,en;q=0.5',
          'accept-encoding': 'gzip, deflate'
        }
      });

      const result = await threatService.getThreatInfo(testIPs.legitimateISP, legitimateRequest);
      expect(result.riskScore).toBe(0);
      expect(result.riskLevel).toBe('minimal');
      expect(result.threats).toHaveLength(0);
    });

    it('应该为可疑用户计算适当的风险评分', async() => {
      const suspiciousRequest = createMockRequest('/', {
        headers: {
          'user-agent': 'bot-scan-malicious/1.0',
          'x-forwarded-for': '192.168.1.1, 203.0.113.1',
          'via': 'proxy-server'
        }
      });

      const result = await threatService.getThreatInfo(testIPs.suspicious, suspiciousRequest);
      expect(result.riskScore).toBeGreaterThan(0);
      expect(result.threats.length).toBeGreaterThan(0);
    });
  });

  describe('错误处理和边界情况', () => {
    it('应该优雅处理无效IP地址', async() => {
      const invalidIPs = ['invalid', '', null, undefined];

      for (const ip of invalidIPs) {
        await expect(threatService.getThreatInfo(ip, createMockRequest()))
          .resolves.toBeDefined();
      }
    });

    it('应该处理没有头部信息的请求', async() => {
      const emptyRequest = createMockRequest('/');

      const result = await threatService.getThreatInfo(testIPs.legitimateISP, emptyRequest);
      expect(result).toBeDefined();
      expect(result.ip).toBe(testIPs.legitimateISP);
    });
  });
});
