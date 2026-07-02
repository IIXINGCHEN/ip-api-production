export const SECURITY_CONFIG = {
  // 速率限制配置
  rateLimit: {
    windowMs: 15 * 60 * 1000, // 15分钟
    max: 100, // 每个IP在窗口期内限制100个请求
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      error: 'Too Many Requests',
      message: 'Rate limit exceeded. Please try again later.',
      retryAfter: 900 // 15分钟（秒）
    }
  },

  // 🔒 安全修复：API密钥配置
  apiKey: {
    required: true, // 🔒 强制要求API密钥认证
    header: 'X-API-Key',
    adminRequired: true, // 管理员端点始终需要API密钥
    publicEndpoints: ['/health', '/', '/docs'], // 🔒 明确定义公开端点
    maxFailedAttempts: 5, // 🔒 最大失败尝试次数
    lockoutDuration: 15 * 60 * 1000 // 🔒 锁定时长（15分钟）
  },

  // CORS配置 - 已移至environment.js进行集中管理
  // 此部分已弃用 - 使用特定环境的CORS配置

  // 安全头
  headers: {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'X-XSS-Protection': '1; mode=block',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Content-Security-Policy': 'default-src \'self\'',
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains'
  },

  // IP白名单（空表示允许所有IP）
  ipWhitelist: [],

  // 被阻止的IP模式
  blockedPatterns: [
    // 为已知恶意IP或范围添加模式
  ],

  // 威胁检测
  threatDetection: {
    enabled: true,
    checkVPN: true,
    checkProxy: true,
    checkTor: true,
    blockSuspicious: false // 设置为true以阻止可疑IP
  }
};

export const PROVIDERS_CONFIG = {
  // 数据提供商优先级（数字越高优先级越高）
  priorities: {
    cloudflare: 100,
    maxmind: 80,
    ipinfo: 60,
    ipapicom: 40,
    fallback: 10
  },

  // 提供商端点和配置
  endpoints: {
    ipinfo: {
      url: 'https://ipinfo.io',
      token: null,
      timeout: 5000
    },
    maxmind: {
      url: 'https://geoip.maxmind.com',
      userId: null,
      licenseKey: null,
      timeout: 5000
    },
    // ip-api.com：免费、免 token、免注册的真实 HTTP API。
    // 限速 45 req/min（非商用授权），HTTP-only（免费版无 HTTPS）。
    // 优先级最低，仅在 Cloudflare/MaxMind/IPInfo 无数据时作为真实兜底。
    ipapicom: {
      url: 'http://ip-api.com',
      timeout: 5000,
      insecure: true,
      enabledByDefault: false
    }
  }
};
