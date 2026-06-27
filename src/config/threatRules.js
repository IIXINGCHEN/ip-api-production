/**
 * Threat detection rules and configuration
 * Centralized threat detection logic to improve accuracy and reduce false positives
 */

export const THREAT_RULES = {
  // 合法ISP范围，绝不应被标记为VPN/代理
  legitimateISPs: {
    ipv4: [
      // 中国ISP - 主要合法提供商
      '1.',
      '14.',
      '27.',
      '36.',
      '39.',
      '42.',
      '49.',
      '58.',
      '59.',
      '60.',
      '61.',
      '101.',
      '106.',
      '110.',
      '111.',
      '112.',
      '113.',
      '114.',
      '115.',
      '116.',
      '117.',
      '118.',
      '119.',
      '120.',
      '121.',
      '122.',
      '123.',
      '124.',
      '125.',
      '175.',
      '180.',
      '182.',
      '183.',
      '202.',
      '203.',
      '210.',
      '211.',
      '218.',
      '219.',
      '220.',
      '221.',
      '222.',
      '223.',

      // 美国主要ISP
      '8.8.',
      '8.34.', // Google DNS
      '1.1.',
      '1.0.', // Cloudflare DNS
      '4.2.2.', // Level3 DNS
      '208.67.', // OpenDNS

      // Comcast和美国主要ISP范围
      '24.',
      '50.',
      '66.',
      '67.',
      '68.',
      '69.',
      '70.',
      '71.',
      '72.',
      '73.',
      '74.',
      '75.',
      '76.',
      '96.',
      '97.',
      '98.',
      '99.',
      '173.',
      '174.',
      '184.',
      '190.',

      // 欧洲ISP
      '80.',
      '81.',
      '82.',
      '83.',
      '84.',
      '85.',
      '86.',
      '87.',
      '88.',
      '89.',
      '90.',
      '91.',
      '92.',
      '93.',
      '94.',
      '95.',

      // 全球其他主要ISP
      '200.',
      '201.',
      '202.',
      '203.', // APNIC地区
      '196.',
      '197.',
      '198.',
      '199.' // 各个地区
    ],
    ipv6: [
      // 中国ISP IPv6
      '2409:', // China Mobile
      '240e:', // China Telecom
      '2408:', // China Unicom
      '240c:', // China Mobile
      '2001:da8:', // CERNET

      // 全球主要ISP IPv6
      '2001:4860:',
      '2a00:1450:', // Google
      '2001:558:',
      '2600:1400:', // Comcast
      '2001:4998:', // Yahoo/Verizon
      '2620:0:', // Facebook/Meta
      '2a02:26f0:', // Deutsche Telekom
      '2001:8b0:', // BT
      '2001:200:', // WIDE项目（日本）
      '2400:cb00:' // Cloudflare亚洲
    ]
  },

  // 已知VPN提供商范围（更具体）
  knownVPNRanges: {
    ipv4: [
      '185.220.100.',
      '185.220.101.',
      '185.220.102.', // Tor/VPN出口
      '198.98.50.',
      '198.98.51.',
      '198.98.52.', // VPN提供商
      '46.166.160.',
      '46.166.161.', // 特定VPN范围
      '192.42.116.' // 已知VPN服务
    ],
    ipv6: [
      '2001:67c:4e8:', // 已知VPN提供商
      '2a03:2880:' // 某些VPN服务（用作VPN时）
    ]
  },

  // 常用于VPN/代理的数据中心/托管范围
  datacenterRanges: {
    ipv4: [
      // DigitalOcean特定范围
      '138.68.',
      '159.89.',
      '167.99.',
      '207.154.',
      '178.62.',
      '46.101.',

      // OVH托管
      '5.79.',
      '5.135.',
      '167.114.',

      // Scaleway托管
      '51.15.',
      '51.158.',

      // 仅限已知用于VPN的非常特定的云范围
      '52.0.',
      '52.1.',
      '52.2.', // AWS VPN专用
      '35.0.',
      '35.1.',
      '35.2.', // Google Cloud VPN专用
      '40.0.',
      '40.1.',
      '40.2.' // Azure VPN专用
    ]
  },

  // 绝不应被标记为代理的合法服务
  legitimateServices: {
    ipv4: [
      // CDN服务
      '104.28.',
      '172.67.', // Cloudflare CDN
      '151.101.', // Fastly CDN
      '185.199.',
      '140.82.', // GitHub Pages
      '13.107.', // Microsoft CDN
      '23.', // Akamai CDN范围

      // 主要云提供商（合法使用）
      '52.',
      '54.', // AWS（合法服务的广泛范围）
      '35.',
      '34.', // Google Cloud
      '40.',
      '13.', // Azure

      // 搜索引擎和主要服务
      '66.249.', // Googlebot
      '157.55.', // Bingbot
      '199.16.', // Twitter
      '31.13.' // Facebook
    ]
  },

  // 风险评分权重
  riskWeights: {
    knownVPN: 60,
    datacenter: 40,
    geoInconsistency: 20,
    multipleHops: 30,
    vpnHeaders: 25,
    proxyHeaders: 15,
    suspiciousPorts: 15,
    proxyUserAgent: 30,
    vpnUserAgent: 40,
    missingHeaders: 10,
    botPattern: 15,
    maliciousPattern: 60
  },

  // 风险级别阈值
  riskThresholds: {
    minimal: 0,
    low: 20,
    medium: 40,
    high: 80
  },

  // VPN/代理检测模式
  detectionPatterns: {
    vpnUserAgents: [
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
    ],
    proxyUserAgents: [
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
    ],
    botUserAgents: [
      /bot/i,
      /crawler/i,
      /spider/i,
      /scraper/i,
      /curl/i,
      /wget/i,
      /python/i,
      /requests/i
    ],
    maliciousPatterns: [
      /\.\./, // 目录遍历
      /union.*select/i, // SQL注入
      /<script/i, // XSS
      /eval\(/i, // 代码注入
      /cmd=/i // 命令注入
    ]
  },

  // 指示VPN/代理使用的头部
  suspiciousHeaders: {
    vpn: ['x-vpn-client', 'x-tunnel-type', 'x-original-forwarded-for'],
    proxy: [
      'x-forwarded-for',
      'x-real-ip',
      'x-proxy-id',
      'via',
      'forwarded',
      'x-cluster-client-ip',
      'x-forwarded-proto',
      'x-forwarded-host'
    ],
    cloudflare: ['cf-connecting-ip', 'cf-ipcountry', 'cf-ray', 'cf-visitor']
  },

  // 代理常用端口
  suspiciousPorts: ['8080', '3128', '1080', '8888', '9050'],

  // 已知恶意IP模式（简化版 - 生产环境使用威胁情报源）
  knownBadIPs: [
    // 在此添加已知恶意IP
  ],

  // 已知良好IP范围
  knownGoodIPs: [
    '8.8.8.', // Google DNS
    '1.1.1.', // Cloudflare DNS
    '208.67.222.' // OpenDNS
  ]
};

export const THREAT_CONFIG = {
  // 启用/禁用特定检测方法
  detection: {
    vpn: true,
    proxy: true,
    tor: true,
    bot: true,
    malicious: true,
    reputation: true
  },

  // 不同检测方法的置信度阈值
  confidence: {
    high: 0.8, // 80%置信度
    medium: 0.6, // 60%置信度
    low: 0.4 // 40%置信度
  },

  // 外部API调用的超时设置
  timeouts: {
    default: 5000,
    threatIntelligence: 3000,
    reputation: 2000
  }
};
