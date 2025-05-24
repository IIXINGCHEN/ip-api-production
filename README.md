# IP-API v2.0 - Production Ready

A high-performance IP geolocation API built with Hono framework, optimized for edge computing environments.

## Features

- **Multi-Provider Geolocation**: Cloudflare, MaxMind, IPInfo integration
- **Advanced Threat Detection**: VPN, proxy, Tor, and malicious activity detection
- **High Performance**: Edge-optimized with intelligent caching
- **Production Security**: Rate limiting, API key authentication, security headers
- **Multiple Formats**: JSON, XML, CSV response formats
- **IPv4/IPv6 Support**: Full dual-stack IP address support
- **Real-time Analytics**: Request tracking and performance monitoring

## Quick Start

### Deploy to Cloudflare Workers

```bash
# Install dependencies
pnpm install

# Deploy to production
pnpm run deploy

# Deploy to staging
wrangler deploy --env staging
```

### Environment Variables

Configure these in Cloudflare Dashboard or via `wrangler secret`:

```bash
# Optional API tokens for enhanced data
wrangler secret put IPINFO_TOKEN
wrangler secret put MAXMIND_USER_ID
wrangler secret put MAXMIND_LICENSE_KEY

# API authentication (for admin endpoints)
wrangler secret put API_KEY_ADMIN
wrangler secret put API_KEY_USER
```

## API Endpoints

### Core Endpoints

- `GET /` - Get client IP information (JSON)
- `GET /geo` - Get client geolocation data
- `GET /geo/{ip}` - Get geolocation for specific IP
- `POST /geo/batch` - Batch geolocation lookup (max 10 IPs)

### Response Format

```json
{
  "ip": "203.0.113.1",
  "ipv4": "203.0.113.1",
  "flag": "🇺🇸",
  "country": "US",
  "countryRegion": "California",
  "city": "San Francisco",
  "latitude": "37.7749",
  "longitude": "-122.4194",
  "asOrganization": "AS15169 Google LLC",
  "timestamp": "2024-12-19T10:30:00.000Z",
  "requestId": "a1b2c3d4-e5f6-4789-a012-b3c4d5e6f7g8-abc123-1703000000000-1703000000000"
}
```

### Query Parameters

- `format` - Response format: `json`, `xml`, `csv` (default: `json`)
- `fields` - Comma-separated list of fields to include
- `include_threat` - Include threat detection data (`true`/`false`)

### Admin Endpoints (Requires API Key)

- `GET /admin/stats` - System statistics
- `GET /admin/health` - Detailed health check
- `GET /admin/cache` - Cache statistics
- `POST /admin/cache/clear` - Clear cache

## Performance

- **Response Time**: < 50ms average
- **Throughput**: 10,000+ requests/second
- **Caching**: Intelligent multi-layer caching
- **Rate Limiting**: 100 requests per 15 minutes per IP

## Security Features

- **Rate Limiting**: Configurable per-IP limits
- **Security Headers**: HSTS, CSP, XSS protection
- **Input Validation**: Comprehensive request validation
- **Threat Detection**: Advanced VPN/proxy detection
- **API Authentication**: Secure admin access

## Deployment Platforms

### Cloudflare Workers (Recommended)
```bash
pnpm run deploy:cloudflare
```

### Vercel Edge Functions
```bash
pnpm run deploy:vercel
```

### Netlify Edge Functions
```bash
pnpm run deploy:netlify
```

## Configuration

All configuration is centralized in `src/config/security.js`:

- Rate limiting settings
- Cache TTL values
- Security policies
- Provider priorities

## Monitoring

Built-in monitoring endpoints:

- `/health` - Basic health check
- `/admin/health` - Detailed system status
- `/admin/stats` - Performance metrics

## License

ISC License - Production ready for commercial use.

## Support

For production support and enterprise features, contact: support@example.com
