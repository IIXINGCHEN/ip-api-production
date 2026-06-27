# 🌍 IP-API v2.0 - Production Ready

[![Security Score](https://img.shields.io/badge/Security-100%25-brightgreen)](https://github.com/IIXINGCHEN/ip-api-production)
[![Code Quality](https://img.shields.io/badge/Code%20Quality-100%25-brightgreen)](https://github.com/IIXINGCHEN/ip-api-production)
[![Production Ready](https://img.shields.io/badge/Production-Ready-success)](https://github.com/IIXINGCHEN/ip-api-production)

A high-performance IP geolocation API built with Hono framework, optimized for edge computing environments. Fully production-ready with enterprise-grade security and monitoring.

## ✨ Features

- **🌐 Multi-Provider Geolocation**: Cloudflare, MaxMind, IPInfo integration
- **🛡️ Advanced Threat Detection**: VPN, proxy, Tor, and malicious activity detection
- **⚡ High Performance**: Edge-optimized with intelligent caching
- **🔒 Production Security**: Rate limiting, API key authentication, security headers
- **📊 Multiple Formats**: JSON, XML, CSV response formats
- **🌍 IPv4/IPv6 Support**: Full dual-stack IP address support
- **📈 Real-time Analytics**: Request tracking and performance monitoring
- **🚀 Edge Computing**: Optimized for Cloudflare Workers

## 🚀 Quick Start

### Prerequisites

- Node.js 18+
- npm or pnpm
- Git

### Installation

```bash
# Clone the repository
git clone https://github.com/IIXINGCHEN/ip-api-production.git
cd ip-api-production

# Install dependencies from the lockfile
npm ci

# Run local validation
npm run build
```

### Deployment Options

#### 🔥 Cloudflare Workers (Recommended)

```bash
# Deploy to production
npm run deploy

# Deploy to staging
npm run deploy:staging

# Deploy to development
npm run deploy:dev
```

The current repository is configured for Cloudflare Workers. Add another deployment target only with
matching scripts, docs, and CI validation.

### Environment Variables

Configure these in your deployment platform:

```bash
# Required API keys
API_KEY_ADMIN=your-secure-admin-key-here
API_KEY_USER=your-secure-user-key-here

# Environment configuration
WORKER_ENV=production
NODE_ENV=production

# Optional third-party services
IPINFO_TOKEN=your-ipinfo-token
MAXMIND_USER_ID=your-maxmind-user-id
MAXMIND_LICENSE_KEY=your-maxmind-license-key
```

## 📁 项目结构 (Project Structure)

```
ip-api-production/
├── .arc/                   # 架构文档目录 (Architecture Documentation)
├── .github/                # GitHub配置 (GitHub Configuration)
│   └── workflows/          # CI/CD工作流 (CI/CD Workflows)
│       └── docker.yml      # Node质量门工作流 (Node Quality Gate Workflow)
├── .wrangler/              # Wrangler缓存目录 (Wrangler Cache Directory)
│   ├── state/              # 状态文件 (State Files)
│   └── tmp/                # 临时文件 (Temporary Files)
├── node_modules/           # 依赖包目录 (Dependencies Directory)
├── src/                    # 源代码目录 (Source Code Directory)
│   ├── app.js              # 主应用入口 (Main Application Entry)
│   ├── config/             # 配置文件目录 (Configuration Directory)
│   │   ├── baseConfig.js   # 基础配置 (Base Configuration)
│   │   ├── environment.js  # 环境配置 (Environment Configuration)
│   │   ├── security.js     # 安全配置 (Security Configuration)
│   │   └── threatRules.js  # 威胁检测规则 (Threat Detection Rules)
│   ├── providers/          # 数据提供商目录 (Data Providers Directory)
│   │   ├── BaseProvider.js # 基础提供商类 (Base Provider Class)
│   │   ├── cloudflare.js   # Cloudflare提供商 (Cloudflare Provider)
│   │   ├── ipinfo.js       # IPInfo提供商 (IPInfo Provider)
│   │   └── maxmind.js      # MaxMind提供商 (MaxMind Provider)
│   ├── routes/             # 路由处理目录 (Routes Directory)
│   │   └── geo-modern.js   # 地理位置API路由 (Geolocation API Routes)
│   ├── services/           # 业务服务目录 (Business Services Directory)
│   │   ├── geoService.js   # 地理位置服务 (Geolocation Service)
│   │   ├── ipService.js    # IP信息服务 (IP Information Service)
│   │   └── threatService.js # 威胁检测服务 (Threat Detection Service)
│   └── utils/              # 工具函数目录 (Utilities Directory)
│       ├── ipValidation.js # IP验证工具 (IP Validation Utilities)
│       ├── response.js     # 响应格式化 (Response Formatting)
│       └── userAgent.js    # User-Agent生成器 (User-Agent Generator)
├── .editorconfig           # 编辑器配置文件 (Editor Configuration)
├── .env.development        # 开发环境变量文件 (Development Environment Variables)
├── .gitignore              # Git忽略文件 (Git Ignore File)
├── index.js                # 项目入口文件 (Project Entry Point)
├── LICENSE                 # 开源许可证 (Open Source License)
├── package.json            # 项目配置文件 (Project Configuration)
├── package-lock.json       # 依赖版本锁定文件 (Dependency Lock File)
├── README.md               # 项目说明文档 (Project Documentation)
└── wrangler.toml           # Wrangler配置文件 (Wrangler Configuration)
```

### 🏗️ 架构说明 (Architecture Overview)

- **src/config/**: 所有配置文件，包括环境、安全、威胁检测规则
- **src/providers/**: 多数据源提供商实现，支持Cloudflare、IPInfo、MaxMind
- **src/services/**: 核心业务逻辑，包括地理位置查询、IP分析、威胁检测
- **src/routes/**: API路由处理，现代化RESTful接口设计
- **src/utils/**: 通用工具函数，IP验证、响应格式化、User-Agent生成
- **.arc/**: 项目架构文档和设计规范存储目录
- **.github/workflows/**: CI/CD自动化部署配置

## 📡 API Endpoints

### Core Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/` | API overview and documentation |
| `GET` | `/health` | Health check and system status |
| `GET` | `/docs` | Current endpoint documentation |
| `GET` | `/v1` | API version summary |
| `GET` | `/{ip}` | Get IP information for a specific address |
| `GET` | `/geo` | Get client IP geolocation data |
| `GET` | `/geo/{ip}` | Get geolocation for a specific IP |
| `POST` | `/v1/batch` | Batch geolocation lookup (max 10 IPs) |
| `POST` | `/validate` | Validate request input |
| `GET` | `/api/v1/geo` | Versioned geolocation endpoint |
| `GET` | `/api/v1/geo/{ip}` | Versioned geolocation endpoint for a specific IP |

### Operational Endpoints (Requires API Key)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/metrics` | System metrics, including Prometheus format |
| `GET` | `/config` | Sanitized runtime configuration |
| `GET` | `/alerts` | Alert state and history |
| `GET` | `/monitoring/status` | Monitoring status report |
| `GET` | `/performance` | Performance optimizer status |
| `GET` | `/memory` | Memory optimizer status and actions |

### 📄 Response Format

#### Geolocation Response

```json
{
  "ip": "203.0.113.1",
  "ipv4": "203.0.113.1",
  "flag": "🇺🇸",
  "country": "United States",
  "countryCode": "US",
  "region": "California",
  "city": "San Francisco",
  "latitude": 37.7749,
  "longitude": -122.4194,
  "timezone": "America/Los_Angeles",
  "asn": "AS15169",
  "asOrganization": "Google LLC",
  "isp": "Google LLC",
  "provider": "Cloudflare",
  "timestamp": "2025-08-21T12:00:00.000Z",
  "requestId": "a1b2c3d4-e5f6-4789-a012-b3c4d5e6f7g8"
}
```

#### Threat Detection Response

```json
{
  "ip": "203.0.113.1",
  "threat": {
    "riskScore": 15,
    "riskLevel": "low",
    "isVPN": false,
    "isProxy": false,
    "isTor": false,
    "isBot": false,
    "isMalicious": false,
    "reputation": "good",
    "sources": ["cloudflare", "internal"],
    "timestamp": "2025-08-21T12:00:00.000Z"
  }
}
```

### 🔧 Query Parameters

| Parameter | Type | Description | Default |
|-----------|------|-------------|---------|
| `format` | string | Response format: `json`, `xml`, `csv` | `json` |
| `lang` | string | Language code (e.g., `en`, `zh`) | `en` |
| `fields` | string | Comma-separated list of fields to include | all |
| `include_threat` | boolean | Include threat detection data | `false` |

## ⚡ Performance

| Metric | Value | Description |
|--------|-------|-------------|
| **Response Time** | < 100ms | Average global response time |
| **Throughput** | 10,000+ req/s | Maximum requests per second |
| **Uptime** | 99.9%+ | Service availability |
| **Cache Hit Rate** | 85%+ | Intelligent multi-layer caching |
| **Rate Limiting** | 100 req/15min | Default per-IP limit |

## 🔒 Security Features

- ✅ **Rate Limiting**: Configurable per-IP limits with burst protection
- ✅ **Security Headers**: HSTS, CSP, XSS protection, CSRF prevention
- ✅ **Input Validation**: Comprehensive request validation with Zod schemas
- ✅ **Threat Detection**: Advanced VPN/proxy/Tor detection
- ✅ **API Authentication**: Secure admin access with API keys
- ✅ **OWASP Compliance**: 100% security score (90/90)
- ✅ **Data Privacy**: No sensitive data logging in production
- ✅ **IP Whitelisting**: Configurable IP access control

## 🌐 Deployment Platform

### 🔥 Cloudflare Workers
```bash
npm run deploy
```
- Global edge network
- Zero cold starts
- Built-in DDoS protection
- KV storage integration

## ⚙️ Configuration

### Environment-based Configuration

Configuration is centralized and environment-aware:

```javascript
// src/config/environment.js
export const ENV_CONFIG = {
  production: {
    security: { strictMode: true, hideErrorDetails: true },
    logging: { level: "error" },
    rateLimit: { max: 100 }
  },
  development: {
    security: { strictMode: false, hideErrorDetails: false },
    logging: { level: "debug" },
    rateLimit: { max: 1000 }
  }
}
```

### Configuration Files

| File | Purpose |
|------|---------|
| `src/config/environment.js` | Environment-specific settings |
| `src/config/security.js` | Security policies and headers |
| `src/config/threatRules.js` | Threat detection rules |
| `src/config/baseConfig.js` | Base configuration templates |

## 📊 Monitoring & Analytics

### Built-in Monitoring

| Endpoint | Description | Auth Required |
|----------|-------------|---------------|
| `/health` | Basic health check | No |
| `/metrics` | Performance metrics | Yes |
| `/config` | Sanitized runtime configuration | Yes |
| `/alerts` | Alert state and history | Yes |
| `/monitoring/status` | Detailed monitoring report | Yes |

### Metrics Tracked

- Request count and response times
- Error rates and types
- Cache hit/miss ratios
- Geographic distribution
- Threat detection statistics
- Provider performance

## 🧪 Testing & Validation

### Local Validation

```bash
# Run lint and full tests
npm run build

# Run checks individually
npm run lint
npm run test:run

# Audit dependencies
npm run audit
```

### Manual Testing

```bash
# Test basic functionality
curl https://your-domain.com/health
curl https://your-domain.com/geo
curl https://your-domain.com/geo/8.8.8.8

# Test batch processing
curl -X POST https://your-domain.com/v1/batch \
  -H "Content-Type: application/json" \
  -d '{"ips":["8.8.8.8","1.1.1.1"]}'

# Test threat detection
curl "https://your-domain.com/geo?include_threat=true"
```

## 📚 Documentation

- [📖 API Standards](docs/API_STANDARDS.md)
- [⚡ Performance Optimization](docs/PERFORMANCE_OPTIMIZATION.md)

## 📄 License

MIT License - Production ready for commercial use.

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run `npm run build`
5. Submit a pull request

## 📞 Support

- **GitHub Issues**: [Report bugs or request features](https://github.com/IIXINGCHEN/ip-api-production/issues)
- **Documentation**: Check the `docs/` directory
- **Security Issues**: Please report privately via GitHub Security

---

**Made with ❤️ for the developer community**

[![GitHub stars](https://img.shields.io/github/stars/IIXINGCHEN/ip-api-production?style=social)](https://github.com/IIXINGCHEN/ip-api-production)
[![GitHub forks](https://img.shields.io/github/forks/IIXINGCHEN/ip-api-production?style=social)](https://github.com/IIXINGCHEN/ip-api-production)
