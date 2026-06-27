import { THREAT_RULES, THREAT_CONFIG } from '../config/threatRules.js';
import {
  isLegitimateISP,
  isLegitimateService,
  isLegitimateDatacenter
} from '../config/threatWhitelist.js';

// 🎯 单例模式 - 避免重复实例化
class ThreatServiceSingleton {
  constructor() {
    if (ThreatServiceSingleton.instance) {
      return ThreatServiceSingleton.instance;
    }

    this.name = 'ThreatService';
    this.rules = THREAT_RULES;
    this.config = THREAT_CONFIG;
    this.lastUsed = Date.now();
    this.usageCount = 0;

    ThreatServiceSingleton.instance = this;
  }

  /**
   * 获取ThreatService单例实例
   */
  static getInstance() {
    if (!ThreatServiceSingleton.instance) {
      ThreatServiceSingleton.instance = new ThreatServiceSingleton();
    }
    return ThreatServiceSingleton.instance;
  }

  /**
   * 清理单例实例（用于内存管理）
   */
  static clearInstance() {
    ThreatServiceSingleton.instance = null;
  }
}

export class ThreatService extends ThreatServiceSingleton {
  constructor() {
    super();
    this.usageCount++;
    this.lastUsed = Date.now();
  }

  async getThreatInfo(ip, request) {
    try {
      const threatInfo = {
        ip,
        riskScore: 0,
        threats: [],
        isVPN: false,
        isProxy: false,
        isTor: false,
        isBot: false,
        isMalicious: false,
        reputation: 'unknown',
        lastSeen: null,
        sources: []
      };

      // 执行多项威胁检查
      const checks = await Promise.allSettled([
        this.checkVPN(ip, request),
        this.checkProxy(ip, request),
        this.checkTor(ip, request),
        this.checkBot(ip, request),
        this.checkReputation(ip, request),
        this.checkMaliciousActivity(ip, request)
      ]);

      // 处理检查结果
      checks.forEach((result, index) => {
        if (result.status === 'fulfilled' && result.value) {
          const checkName = [
            'VPN',
            'Proxy',
            'Tor',
            'Bot',
            'Reputation',
            'Malicious'
          ][index];
          const data = result.value;

          // 根据检查结果更新威胁信息
          if (data.detected) {
            threatInfo.threats.push(checkName.toLowerCase());
            // 使用配置的风险权重
            const weight =
              this.rules.riskWeights[`${checkName.toLowerCase()}Pattern`] ||
              data.riskScore ||
              10;
            threatInfo.riskScore += weight;
          }

          // 更新特定标志
          switch (checkName) {
          case 'VPN':
            threatInfo.isVPN = data.detected;
            break;
          case 'Proxy':
            threatInfo.isProxy = data.detected;
            break;
          case 'Tor':
            threatInfo.isTor = data.detected;
            break;
          case 'Bot':
            threatInfo.isBot = data.detected;
            break;
          case 'Malicious':
            threatInfo.isMalicious = data.detected;
            break;
          case 'Reputation':
            threatInfo.reputation = data.reputation || 'unknown';
            break;
          }

          if (data.source) {
            threatInfo.sources.push(data.source);
          }
        }
      });

      // 计算总体风险级别
      threatInfo.riskLevel = this.calculateRiskLevel(threatInfo.riskScore);

      // 添加时间戳
      threatInfo.timestamp = new Date().toISOString();

      return threatInfo;
    } catch (error) {
      // 威胁检测的增强错误处理
      if (error.message && error.message.includes('Invalid IP')) {
        throw new Error('Invalid IP address for threat analysis');
      }

      // 对于威胁检测，我们可以提供回退数据而不是失败
      return {
        ip,
        riskScore: 0,
        threats: [],
        isVPN: false,
        isProxy: false,
        isTor: false,
        isBot: false,
        isMalicious: false,
        reputation: 'unknown',
        lastSeen: null,
        sources: [],
        riskLevel: 'minimal',
        timestamp: new Date().toISOString(),
        error: 'Threat detection partially unavailable'
      };
    }
  }

  async checkVPN(ip, request) {
    try {
      // 🔒 关键：使用白名单检查，大幅减少误报
      if (isLegitimateISP(ip)) {
        return {
          detected: false,
          riskScore: 0,
          indicators: ['legitimate_isp'],
          source: 'enhanced_vpn_check'
        };
      }

      // 检查是否为合法数据中心（如云服务商）
      if (isLegitimateDatacenter(ip)) {
        return {
          detected: false,
          riskScore: 0,
          indicators: ['legitimate_datacenter'],
          source: 'enhanced_vpn_check'
        };
      }

      // 检查是否为合法服务提供商
      if (isLegitimateService(ip)) {
        return {
          detected: false,
          riskScore: 0,
          indicators: ['legitimate_service'],
          source: 'enhanced_vpn_check'
        };
      }

      let riskScore = 0;
      let detected = false;
      const indicators = [];

      // 检查已知VPN/托管提供商IP范围
      if (this.isKnownVPNRange(ip)) {
        detected = true;
        riskScore += 60;
        indicators.push('known_vpn_range');
      }

      // 检查托管/数据中心IP范围
      if (this.isDatacenterIP(ip)) {
        detected = true;
        riskScore += 40;
        indicators.push('datacenter_ip');
      }

      // 检查可疑的地理位置模式
      const geoCheck = this.checkGeoInconsistency(request);
      if (geoCheck.suspicious) {
        riskScore += 20;
        indicators.push('geo_inconsistency');
      }

      // 检查多个IP跳跃（代理链）
      const hopCheck = this.checkIPHops(request);
      if (hopCheck.multipleHops) {
        detected = true;
        riskScore += 30;
        indicators.push('multiple_hops');
      }

      // 检查VPN特定头部
      const headerCheck = this.checkVPNHeaders(request);
      if (headerCheck.detected) {
        detected = true;
        riskScore += headerCheck.score;
        indicators.push(...headerCheck.indicators);
      }

      return {
        detected,
        riskScore,
        indicators,
        source: 'enhanced_vpn_check'
      };
    } catch {
      return { detected: false, riskScore: 0, indicators: [] };
    }
  }

  async checkProxy(ip, request) {
    try {
      // 🔒 关键：使用白名单检查，大幅减少误报
      if (isLegitimateISP(ip)) {
        return {
          detected: false,
          riskScore: 0,
          indicators: ['legitimate_isp'],
          source: 'enhanced_proxy_check'
        };
      }

      // 检查是否为合法数据中心
      if (isLegitimateDatacenter(ip)) {
        return {
          detected: false,
          riskScore: 0,
          indicators: ['legitimate_datacenter'],
          source: 'enhanced_proxy_check'
        };
      }

      // 检查是否为合法服务提供商（如CDN）
      if (isLegitimateService(ip)) {
        return {
          detected: false,
          riskScore: 0,
          indicators: ['legitimate_service'],
          source: 'enhanced_proxy_check'
        };
      }

      let riskScore = 0;
      let detected = false;
      const indicators = [];

      // 检查代理特定头部
      const proxyHeaders = this.analyzeProxyHeaders(request);
      const isCdnTraffic = proxyHeaders.indicators.includes('cdn_usage');
      if (proxyHeaders.detected) {
        detected = true;
        riskScore += proxyHeaders.score;
        indicators.push(...proxyHeaders.indicators);
      }

      // 检查已知代理IP范围
      if (this.isKnownProxyRange(ip)) {
        detected = true;
        riskScore += 50;
        indicators.push('known_proxy_range');
      }

      // 检查可疑端口模式
      const portCheck = this.checkSuspiciousPorts(request);
      if (portCheck.suspicious) {
        riskScore += 15;
        indicators.push('suspicious_ports');
      }

      // 检查代理特定用户代理模式
      // NOTE: CDN 转发的请求常缺失浏览器头（UA/accept-*），此处的 missing_* 评分会误报。
      // analyzeProxyHeaders 已判定为正常 CDN 流量时跳过，避免与 CDN 识别冲突产生误报。
      if (!isCdnTraffic) {
        const uaCheck = this.checkProxyUserAgent(request);
        if (uaCheck.detected) {
          detected = true;
          riskScore += uaCheck.score;
          indicators.push('proxy_user_agent');
        }
      }

      return {
        detected,
        riskScore,
        indicators,
        source: 'enhanced_proxy_check'
      };
    } catch {
      return { detected: false, riskScore: 0, indicators: [] };
    }
  }

  async checkTor(ip, request) {
    try {
      let detected = false;
      let riskScore = 0;
      const indicators = [];

      // 检查Tor浏览器用户代理模式
      const userAgent = request.header('user-agent') || '';
      if (userAgent.includes('Tor Browser')) {
        detected = true;
        riskScore += 50;
        indicators.push('tor_browser_ua');
      }

      // 检查已知Tor出口节点模式
      if (this.isKnownTorExitNode(ip)) {
        detected = true;
        riskScore += 70;
        indicators.push('tor_exit_node');
      }

      // 检查Tor特定头部或模式
      const torHeaders = this.checkTorHeaders(request);
      if (torHeaders.detected) {
        detected = true;
        riskScore += torHeaders.score;
        indicators.push(...torHeaders.indicators);
      }

      // 检查SOCKS代理模式（通常与Tor一起使用）
      const socksCheck = this.checkSocksProxy(request);
      if (socksCheck.detected) {
        riskScore += socksCheck.score;
        indicators.push('socks_proxy_pattern');
      }

      return {
        detected,
        riskScore,
        indicators,
        source: 'enhanced_tor_check'
      };
    } catch {
      return {
        detected: false,
        riskScore: 0,
        indicators: []
      };
    }
  }

  isKnownTorExitNode(ip) {
    // 使用已知模式的增强Tor出口节点检测
    const torExitPatterns = [
      // 常见Tor出口节点IP模式
      '185.220.', // Tor项目
      '199.87.',  // Tor出口节点
      '176.10.',  // 常见Tor托管
      '51.15.',   // Scaleway Tor出口
      '163.172.', // Online.net Tor出口
      '95.216.'  // Hetzner Tor出口
    ];

    return torExitPatterns.some(pattern => ip.startsWith(pattern));
  }

  checkTorHeaders(request) {
    const indicators = [];
    let score = 0;
    let detected = false;

    // 检查Tor特定头部
    const torHeaders = [
      'x-tor-exit-node',
      'x-tor-relay',
      'x-onion-location'
    ];

    for (const header of torHeaders) {
      if (request.header(header)) {
        detected = true;
        score += 40;
        indicators.push(`tor_header_${header}`);
      }
    }

    return { detected, score, indicators };
  }

  checkSocksProxy(request) {
    // 检查SOCKS代理使用模式
    const host = request.header('host') || '';
    const userAgent = request.header('user-agent') || '';

    let detected = false;
    let score = 0;

    // 检查SOCKS代理端口
    const socksPort = host.includes(':1080') || host.includes(':9050');
    if (socksPort) {
      detected = true;
      score += 30;
    }

    // 检查SOCKS代理用户代理
    if (userAgent.includes('SOCKS') || userAgent.includes('Proxy')) {
      score += 20;
    }

    return { detected, score };
  }

  async checkBot(_ip, request) {
    try {
      let detected = false;
      let riskScore = 0;
      const indicators = [];

      const userAgent = request.header('user-agent') || '';

      // 🔒 改进的机器人检测 - 减少误报

      // 0. CDN/边缘流量短路：仅在真正的无头请求（无 UA、无 accept）时抑制误报。
      // NOTE: CDN 注入的头（cf-ray/x-cache 等）未签名、客户端可随意伪造，故不能据此
      // 无条件跳过 bot 检测——否则携带恶意 UA 的请求只要伪造成 CDN 流量即可绕过。
      // 仅当请求确实缺失浏览器头（如边缘健康检查）时才短路。
      const hasBrowserHeaders = Boolean(userAgent) || Boolean(request.header('accept'));
      if (!hasBrowserHeaders && this.analyzeProxyHeaders(request).indicators.includes('cdn_usage')) {
        return {
          detected: false,
          riskScore: 0,
          indicators: ['cdn_usage'],
          source: 'enhanced_bot_check'
        };
      }

      // 1. 检查知名搜索引擎爬虫（这些是合法的）
      const legitimateBots = [
        /googlebot/i,
        /bingbot/i,
        /slurp/i,           // Yahoo
        /duckduckbot/i,      // DuckDuckGo
        /baiduspider/i,      // 百度
        /yandexbot/i,       // Yandex
        /facebookexternalhit/i, // Facebook
        /twitterbot/i,      // Twitter
        /linkedinbot/i,     // LinkedIn
        /whatsapp/i,        // WhatsApp
        /applebot/i,        // Apple
        /msnbot/i,          // Microsoft
        /semrushbot/i,      // SEMrush
        /ahrefsbot/i,       // Ahrefs
        /mj12bot/i         // Majestic
      ];

      const isLegitimateBot = legitimateBots.some(pattern => pattern.test(userAgent));
      if (isLegitimateBot) {
        return {
          detected: false,
          riskScore: 0,
          indicators: ['legitimate_bot'],
          source: 'enhanced_bot_check'
        };
      }

      // 2. 检查可疑的机器人模式
      const suspiciousBotPatterns = [
        /bot.*scan/i,
        /scan.*bot/i,
        /crawler.*aggressive/i,
        /scraper/i,
        /harvest/i,
        /extract/i,
        /spider.*malicious/i,
        /bot.*malicious/i
      ];

      for (const pattern of suspiciousBotPatterns) {
        if (pattern.test(userAgent)) {
          riskScore += 25;
          indicators.push('suspicious_bot_pattern');
          break;
        }
      }

      // 3. 检查常见开发工具（这些不一定是恶意的）
      const developmentTools = [
        /curl/i,
        /wget/i,
        /httpie/i,
        /postman/i,
        /insomnia/i,
        /rest-client/i,
        /fetch/i
      ];

      const isDevTool = developmentTools.some(pattern => pattern.test(userAgent));
      if (isDevTool) {
        return {
          detected: false,
          riskScore: 10,
          indicators: ['development_tool'],
          source: 'enhanced_bot_check'
        };
      }

      // 4. 检查缺失的常见头部（但要考虑一些工具的正常行为）
      if (!userAgent) {
        riskScore += 30; // 完全没有User-Agent更可疑
        indicators.push('missing_user_agent');
      } else if (userAgent.length < 20) {
        riskScore += 15;
        indicators.push('short_user_agent');
      }

      // 5. 检查User-Agent是否包含明显可疑特征
      const suspiciousUAPatterns = [
        /bot/i,
        /crawler/i,
        /spider/i,
        /scraper/i,
        /python/i,
        /requests/i,
        /go-http-client/i,
        /java/i,
        /node\.js/i
      ];

      const hasSuspiciousUA = suspiciousUAPatterns.some(pattern => pattern.test(userAgent));
      if (hasSuspiciousUA && !isDevTool) {
        riskScore += 20;
        indicators.push('suspicious_user_agent');
      }

      // 6. 检查缺失的其他头部（但降低权重）
      if (!request.header('accept-language')) {
        riskScore += 3;
        indicators.push('missing_accept_language');
      }
      if (!request.header('accept-encoding')) {
        riskScore += 2;
        indicators.push('missing_accept_encoding');
      }
      if (!request.header('accept')) {
        riskScore += 5;
        indicators.push('missing_accept_header');
      }

      // 7. 检查请求模式
      const acceptHeader = request.header('accept') || '';
      if (!acceptHeader.includes('text/html') && !acceptHeader.includes('application/json')) {
        riskScore += 8;
        indicators.push('unusual_accept_header');
      }

      // 8. 调整检测阈值 - 只有高风险才标记为机器人
      if (riskScore >= 40) {
        detected = true;
      }

      return {
        detected,
        riskScore,
        indicators,
        source: 'enhanced_bot_check'
      };
    } catch {
      return { detected: false, riskScore: 0, indicators: [] };
    }
  }

  async checkReputation(ip, _request) {
    try {
      let reputation = 'unknown';
      let riskScore = 0;
      const indicators = [];
      const sources = [];

      // 检查多个声誉源
      const reputationChecks = await Promise.allSettled([
        this.checkInternalBlacklist(ip),
        this.checkThreatIntelligence(ip),
        this.checkAbuseDatabase(ip),
        this.checkDNSBlacklist(ip)
      ]);

      // 处理声誉检查结果
      reputationChecks.forEach((result, index) => {
        if (result.status === 'fulfilled' && result.value) {
          const checkName = ['internal', 'threat_intel', 'abuse_db', 'dns_bl'][index];
          const data = result.value;

          if (data.malicious) {
            reputation = 'malicious';
            riskScore += data.score || 80;
            indicators.push(`${checkName}_malicious`);
            sources.push(data.source || checkName);
          } else if (data.suspicious) {
            if (reputation === 'unknown') {
              reputation = 'suspicious';
            }
            riskScore += data.score || 40;
            indicators.push(`${checkName}_suspicious`);
            sources.push(data.source || checkName);
          } else if (data.trusted) {
            if (reputation === 'unknown') {
              reputation = 'good';
            }
            sources.push(data.source || checkName);
          }
        }
      });

      // 🔒 使用白名单检查已知良好IP和服务
      const whitelistMatches = [
        [isLegitimateISP(ip), 'legitimate_isp', 'whitelist_isp'],
        [isLegitimateService(ip), 'legitimate_service', 'whitelist_service'],
        [isLegitimateDatacenter(ip), 'legitimate_datacenter', 'whitelist_datacenter']
      ];

      const matchedWhitelists = whitelistMatches.filter(([matched]) => matched);
      if (matchedWhitelists.length > 0) {
        reputation = 'good';
        riskScore = 0;
        matchedWhitelists.forEach(([, indicator, source]) => {
          indicators.push(indicator);
          sources.push(source);
        });
      } else if (this.isKnownGoodIP(ip)) {
        reputation = 'good';
        riskScore = Math.max(0, riskScore - 50);
        indicators.push('known_good_ip');
        sources.push('internal_whitelist');
      }

      return {
        detected: reputation === 'malicious',
        reputation,
        riskScore,
        indicators,
        sources,
        source: 'enhanced_reputation_check'
      };
    } catch {
      return {
        detected: false,
        reputation: 'unknown',
        riskScore: 0
      };
    }
  }

  async checkInternalBlacklist(ip) {
    // 检查内部黑名单
    if (this.isKnownBadIP(ip)) {
      return {
        malicious: true,
        score: 90,
        source: 'internal_blacklist'
      };
    }
    return { malicious: false };
  }

  async checkThreatIntelligence(ip) {
    // 具有模式匹配的增强威胁情报检查
    try {
      // 检查私有IP范围 - 这些绝不应被标记为威胁
      const privatePatterns = [
        /^10\./, // 私有IP范围
        /^192\.168\./, // 私有IP范围
        /^172\.(1[6-9]|2[0-9]|3[01])\./ // 私有IP范围
      ];

      // 不要将私有IP标记为威胁
      for (const pattern of privatePatterns) {
        if (pattern.test(ip)) {
          return { malicious: false, trusted: true };
        }
      }

      // 增强的威胁情报逻辑将在此处实现
      // 当前返回安全默认值
      return { malicious: false };
    } catch {
      return { malicious: false };
    }
  }

  async checkAbuseDatabase(_ip) {
    // 增强的滥用数据库检查实现
    try {
      // 增强的滥用数据库逻辑将在此处实现
      // 当前返回安全默认值
      return { malicious: false };
    } catch {
      return { malicious: false };
    }
  }

  async checkDNSBlacklist(_ip) {
    // 增强的DNS黑名单检查实现
    try {
      // 增强的DNS黑名单逻辑将在此处实现
      // 当前返回安全默认值
      return { malicious: false };
    } catch {
      return { malicious: false };
    }
  }

  async checkMaliciousActivity(_ip, request) {
    try {
      // 检查恶意活动迹象
      let detected = false;
      let riskScore = 0;

      // 检查可能表明恶意意图的请求模式
      const requestTarget = [request?.path, request?.url]
        .filter(Boolean)
        .join(' ');
      const path = this.decodeRequestTarget(requestTarget);
      const userAgent = request?.header?.('user-agent') || '';

      // 检查常见攻击模式
      const maliciousPatterns = [
        /\.\./, // Directory traversal
        /\/etc\/passwd/i, // Normalized Unix credential file probes
        /union.*select/i, // SQL injection
        /<script/i, // XSS
        /eval\(/i, // Code injection
        /cmd=/i // Command injection
      ];

      for (const pattern of maliciousPatterns) {
        if (pattern.test(path) || pattern.test(userAgent)) {
          detected = true;
          riskScore += 60;
          break;
        }
      }

      return {
        detected,
        riskScore,
        source: 'internal_malicious_check'
      };
    } catch {
      return { detected: false, riskScore: 0 };
    }
  }

  decodeRequestTarget(target) {
    // 循环解码以捕获多重编码（如双重编码 %252e%252e%252f → %2e%2e%2f → ../）。
    // 单次 decodeURIComponent 只解一层，会被双重编码绕过攻击模式检测。
    // 上限 3 次防止异常输入导致死循环。
    let decoded = target;
    for (let i = 0; i < 3; i++) {
      try {
        const next = decodeURIComponent(decoded);
        if (next === decoded) {
          break; // 已稳定，无更多编码层
        }
        decoded = next;
      } catch {
        break; // 遇到非法转义序列，停止
      }
    }
    return decoded;
  }

  calculateRiskLevel(score) {
    // 使用配置的风险阈值
    const thresholds = this.rules.riskThresholds;
    if (score >= thresholds.high) {
      return 'high';
    }
    if (score >= thresholds.medium) {
      return 'medium';
    }
    if (score >= thresholds.low) {
      return 'low';
    }
    return 'minimal';
  }

  isKnownVPNRange(ip) {
    // 具有改进ISP识别的增强VPN范围检测

    // 首先检查是否为绝不应被标记为VPN的合法ISP
    if (this.isLegitimateISP(ip)) {
      return false;
    }

    // 使用集中式VPN范围规则
    if (ip.includes(':')) {
      return this.rules.knownVPNRanges.ipv6.some((range) =>
        ip.startsWith(range)
      );
    } else {
      return this.rules.knownVPNRanges.ipv4.some((range) =>
        ip.startsWith(range)
      );
    }
  }

  isLegitimateISP(ip) {
    // 委派到 threatWhitelist 单一来源（IP 名誉白名单已移除 → 恒 false，改为信号驱动检测）
    // 这同时消除 THREAT_RULES.legitimateISPs 与 threatWhitelist 的双源重复（M11）。
    return isLegitimateISP(ip);
  }

  checkMobileNetworkVPN(_ip) {
    // 移动网络通常是合法的
    // 仅在有其他可疑指标时标记为VPN
    // 中国移动IPv6范围是合法ISP范围，默认不是VPN

    // 不要将合法移动ISP范围标记为VPN
    // 这些是正常用户连接，不是VPN服务
    return false;
  }

  isDatacenterIP(ip) {
    // 关键：首先检查是否为绝不应被标记为数据中心的合法ISP
    if (this.isLegitimateISP(ip)) {
      return false;
    }

    // 还要检查是否为合法服务（CDN等）
    if (this.isLegitimateService(ip)) {
      return false;
    }

    // 使用集中式数据中心范围规则
    return this.rules.datacenterRanges.ipv4.some((range) =>
      ip.startsWith(range)
    );
  }

  isKnownProxyRange(ip) {
    // 增强代理检测 - 仅标记实际代理服务

    // 首先检查是否为绝不应被标记为代理的合法服务
    if (this.isLegitimateService(ip)) {
      return false;
    }

    const proxyRanges = [
      // 特定代理服务提供商
      '185.220.100.',
      '185.220.101.', // 用作代理的Tor出口
      '198.98.50.',
      '198.98.51.', // 已知代理服务
      '46.166.160.',
      '46.166.161.', // Specific proxy ranges
      '192.42.116.', // Known proxy service

      // 其他已知代理范围
      '5.79.',
      '5.135.', // OVH代理服务
      '51.15.',
      '51.158.', // Scaleway代理服务
      '167.114.' // OVH加拿大代理
    ];

    return proxyRanges.some((range) => ip.startsWith(range));
  }

  isLegitimateService(ip) {
    // 委派到 threatWhitelist 单一来源（IP 名誉白名单已移除 → 恒 false）
    return isLegitimateService(ip);
  }

  checkGeoInconsistency(request) {
    // 检查地理位置不一致
    const _acceptLanguage = request.header('accept-language') || '';
    const _timezone = request.header('x-timezone') || '';

    // 增强的地理位置一致性检查
    // 当前实现基本验证
    return {
      suspicious: false, // 增强的地理分析将在此处实现
      score: 0
    };
  }

  checkIPHops(request) {
    // 检查指示代理链的多个IP跳跃
    const xForwardedFor = request.header('x-forwarded-for') || '';
    const _via = request.header('via') || '';

    const hopCount = xForwardedFor.split(',').length;

    return {
      multipleHops: hopCount > 2,
      hopCount
    };
  }

  checkVPNHeaders(request) {
    const indicators = [];
    let score = 0;
    let detected = false;

    // 检查VPN特定头部
    // NOTE: x-forwarded-proto / x-original-forwarded-for 是标准反向代理/CDN 头（任何 HTTPS
    // 反代都会设置），并非 VPN 特征，曾在此误报为 VPN。仅保留真正的 VPN 客户端特征头。
    const vpnHeaders = [
      'x-vpn-client',
      'x-tunnel-type'
    ];

    for (const header of vpnHeaders) {
      if (request.header(header)) {
        detected = true;
        score += 25;
        indicators.push(`vpn_header_${header}`);
      }
    }

    return { detected, score, indicators };
  }

  analyzeProxyHeaders(request) {
    const indicators = [];
    let score = 0;
    let detected = false;

    // 🔒 改进的代理头部检测 - 减少CDN和云服务的误报

    // 分类代理相关头部
    const strongProxyHeaders = [
      'x-proxy-id',
      'x-forwarded-proto',
      'x-forwarded-host',
      'x-cluster-client-ip',
      'forwarded'
    ];

    const weakProxyHeaders = [
      'x-forwarded-for',
      'x-real-ip',
      'via'
    ];

    // CDN头部（这些是正常的，不应增加风险）
    const cdnHeaders = [
      'cf-connecting-ip',
      'cf-ipcountry',
      'cf-ray',
      'cf-visitor',
      'x-amz-cf-id',        // AWS CloudFront
      'x-served-by',       // Akamai
      'x-cache'           // Fastly
    ];

    let strongProxyCount = 0;
    let weakProxyCount = 0;
    let cdnHeaderCount = 0;

    // 检查强代理指标
    for (const header of strongProxyHeaders) {
      if (request.header(header)) {
        strongProxyCount++;
        indicators.push(`strong_proxy_${header}`);
        score += 15;
      }
    }

    // 检查弱代理指标
    for (const header of weakProxyHeaders) {
      const headerValue = request.header(header);
      if (headerValue) {
        weakProxyCount++;
        indicators.push(`weak_proxy_${header}`);

        // 分析特定的代理模式
        if (header === 'x-forwarded-for' && headerValue.includes(',')) {
          // X-Forwarded-For中的多个IP可能表示代理链
          const ips = headerValue.split(',').map((ip) => ip.trim());
          if (ips.length > 2) { // 超过2个IP更可疑
            score += ips.length * 10;
            indicators.push(`proxy_chain_${ips.length}_hops`);
          }
        }

        if (header === 'via' && headerValue) {
          // Via头部明确表示代理使用
          score += 20;
          indicators.push('via_header_present');
        }

        score += 5; // 基础分
      }
    }

    // 检查CDN头部（这些是正常的，不应增加风险）
    for (const header of cdnHeaders) {
      if (request.header(header)) {
        cdnHeaderCount++;
        indicators.push(`cdn_${header}`);
        // CDN头部不增加风险分数
      }
    }

    // 🛡️ 智能检测逻辑 - 减少误报

    // 1. 如果有CDN头部但没有强代理指标，很可能是正常CDN使用
    if (cdnHeaderCount > 0 && strongProxyCount === 0) {
      return {
        detected: false,
        score: 0,
        indicators: ['cdn_usage']
      };
    }

    // 2. 只有强代理指标才被认为是真正的代理
    if (strongProxyCount >= 1) {
      detected = true;
      score += strongProxyCount * 20;
      indicators.push('strong_proxy_detected');
    }

    // 3. 多个弱代理指标也可能表示代理
    if (weakProxyCount >= 2 && strongProxyCount === 0) {
      detected = true;
      score += weakProxyCount * 10;
      indicators.push('multiple_weak_proxy_indicators');
    }

    // 4. 单个弱代理指标需要更高的分数才标记
    if (weakProxyCount === 1 && strongProxyCount === 0 && score >= 30) {
      detected = true;
      indicators.push('single_weak_proxy_with_high_score');
    }

    // 5. 调整检测阈值
    if (score >= 35) {
      detected = true;
    }

    return { detected, score, indicators };
  }

  checkSuspiciousPorts(request) {
    // 检查可疑端口使用模式
    const host = request.header('host') || '';
    const suspiciousPorts = ['8080', '3128', '1080', '8888', '9050'];

    for (const port of suspiciousPorts) {
      if (host.includes(`:${port}`)) {
        return { suspicious: true, port };
      }
    }

    return { suspicious: false };
  }

  checkProxyUserAgent(request) {
    const userAgent = request.header('user-agent') || '';
    const acceptLanguage = request.header('accept-language') || '';
    const acceptEncoding = request.header('accept-encoding') || '';

    let detected = false;
    let score = 0;
    const indicators = [];

    // 代理/VPN客户端模式
    const proxyPatterns = [
      /squid/i,
      /proxy/i,
      /curl/i,
      /wget/i,
      /python-requests/i,
      /go-http-client/i,
      /okhttp/i,
      /apache-httpclient/i,
      /java/i,
      /node\.js/i,
      /postman/i,
      /insomnia/i
    ];

    // VPN客户端模式
    const vpnPatterns = [
      /openvpn/i,
      /nordvpn/i,
      /expressvpn/i,
      /surfshark/i,
      /cyberghost/i,
      /tunnelbear/i,
      /protonvpn/i,
      /windscribe/i,
      /privatevpn/i,
      /vpn/i
    ];

    // 检查代理模式
    for (const pattern of proxyPatterns) {
      if (pattern.test(userAgent)) {
        detected = true;
        score += 30;
        indicators.push('proxy_user_agent');
        break;
      }
    }

    // 检查VPN模式
    for (const pattern of vpnPatterns) {
      if (pattern.test(userAgent)) {
        detected = true;
        score += 40;
        indicators.push('vpn_user_agent');
        break;
      }
    }

    // 检查可疑头部组合
    if (!userAgent) {
      score += 20;
      indicators.push('missing_user_agent');
    }

    if (!acceptLanguage) {
      score += 10;
      indicators.push('missing_accept_language');
    }

    if (!acceptEncoding) {
      score += 10;
      indicators.push('missing_accept_encoding');
    }

    // 检查自动化工具模式
    if (
      userAgent &&
      (userAgent.length < 20 ||
        !userAgent.includes('Mozilla') ||
        userAgent.includes('bot') ||
        userAgent.includes('crawler'))
    ) {
      score += 15;
      indicators.push('suspicious_user_agent_pattern');
    }

    if (score > 15) {
      detected = true;
    }

    return { detected, score, indicators };
  }

  isKnownBadIP(ip) {
    // 使用内部黑名单的增强恶意IP检查
    const badIPs = [
      // 已知恶意IP将在此处维护
      // 当前为空以确保安全
    ];

    return badIPs.includes(ip);
  }

  isKnownGoodIP(ip) {
    // 简化的良好IP检查
    // 已知良好IP范围（Google、Cloudflare等）
    const goodRanges = [
      '8.8.8.', // Google DNS
      '1.1.1.', // Cloudflare DNS
      '208.67.222.' // OpenDNS
    ];

    return goodRanges.some((range) => ip.startsWith(range));
  }
}
