# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a production-ready IP geolocation API built with Hono framework and optimized for edge computing environments (Cloudflare Workers, Vercel Edge, Netlify Edge). The API provides multi-provider geolocation data with threat detection capabilities.

## Key Commands

### Development
```bash
npm run dev          # Start development server with Wrangler
npm run start        # Alias for dev
```

### Deployment
```bash
npm run deploy                # Deploy to production (Cloudflare Workers)
npm run deploy:staging        # Deploy to staging environment
npm run deploy:dev            # Deploy to development environment
```

### Maintenance
```bash
npm run audit         # Run security audit with moderate level
npm run clean         # Clean cache and temporary files
```

### Testing & Validation
```bash
# Manual smoke testing against a running instance
curl https://your-domain.com/health
curl -H "X-API-Key: $KEY" https://your-domain.com/api/v1/ips/self
curl -H "X-API-Key: $KEY" https://your-domain.com/api/v1/ips/8.8.8.8
```

## Architecture Overview

### Multi-Provider Architecture
The application uses a provider pattern with three main geolocation sources:
1. **Cloudflare Provider** - Primary source with highest priority
2. **MaxMind Provider** - Secondary source requiring license credentials
3. **IPInfo Provider** - Tertiary source requiring API token

All providers extend `BaseProvider.js` and emit canonical `GeoData` via `tryExtractSync(ip, ctx)` (sync, in-process — tier:`'sync'`) or `fetch(ip, opts)` (async, network — tier:`'async'`), plus `isConfigured()`. `null` means "no data"; a thrown `ProviderError` (built via `this.classify()`) means a real failure.

### Core Services
- **geoService.js** - Main orchestration service that coordinates multiple providers
- **threatService.js** - Threat detection and security analysis
- **ipService.js** - IP validation and basic information extraction

### Configuration System
- **environment.js** - Environment-aware configuration (production/staging/development)
- **security.js** - Security policies and threat detection rules
- **baseConfig.js** - Base configuration templates

### Request Flow
1. Request comes through `app.js` → init → CORS/security headers → client IP → rate limiting → auth
2. Routes split by resource group: `discovery.js` (`/`, `/health`, `/api/v1`, `/docs`, openapi), `ips.js` (`/api/v1/ips`), `system.js` (`/api/v1/system/*`)
3. Providers queried in parallel with priority-based result merging
4. Response envelope: success `{data, meta, links}` / error `{error, meta}` (no `success` boolean; HTTP status codes are authoritative)
5. Format transformation via `geoFormatter.js` (JSON/XML/CSV/JSONP)

## Environment Variables

### Required for Production
Set via Wrangler secrets:
```bash
wrangler secret put API_KEY_ADMIN --env production
wrangler secret put API_KEY_USER --env production
```

### Optional Third-party Services
```bash
wrangler secret put IPINFO_TOKEN --env production
wrangler secret put MAXMIND_USER_ID --env production
wrangler secret put MAXMIND_LICENSE_KEY --env production
```

## Key Files and Their Purpose

### Application Entry
- `src/app.js` - Main application: global middleware chain + route mounting + error handling
- `src/routes/discovery.js` - Public endpoints (`/`, `/health`, `/api/v1`, `/docs`, `/api/v1/openapi.json`)
- `src/routes/ips.js` - IP geolocation resources (`/api/v1/ips`, `/self`, `/:ip`, `:batch`)
- `src/routes/system.js` - Ops endpoints (`/api/v1/system/*`, admin-gated)
- `src/utils/responseBuilder.js` - Unified RESTful response envelope (`buildSuccess`/`buildError`)
- `src/utils/geoFormatter.js` - Geo resource construction + XML/CSV/JSONP serialization

### Provider System
- `src/providers/BaseProvider.js` - Abstract base class with common functionality
- `src/providers/cloudflare.js` - Cloudflare-based geolocation provider
- `src/providers/maxmind.js` - MaxMind database provider
- `src/providers/ipinfo.js` - IPInfo API provider

### Utilities
- `src/utils/ipValidation.js` - IP address validation and type detection
- `src/utils/response.js` - Response formatting utilities
- `src/utils/userAgent.js` - User-Agent generation for external requests

### Configuration
- `src/config/environment.js` - Environment-specific settings and security
- `src/config/security.js` - Security headers and policies
- `src/config/threatRules.js` - Threat detection rule definitions

## Deployment Platforms

### Primary: Cloudflare Workers
- Entry point: `src/app.js`
- Configuration: `wrangler.toml`
- Environment support: production, staging, development

### Alternative: Vercel Edge Functions
- Compatible with existing codebase
- Automatic HTTPS and global distribution

### Alternative: Netlify Edge Functions
- Compatible with existing codebase
- Built-in DDoS protection

## Security Features

### Production Security
- Strict security headers enforced in production
- Rate limiting (100 req/15min default)
- Private IP address blocking for lookups
- Comprehensive input validation with Zod schemas
- Sensitive data filtering in logs

### Threat Detection
- VPN/proxy/Tor detection
- Malicious IP identification
- Risk scoring and reputation analysis
- Real-time threat intelligence

## Response Formats

The API supports multiple response formats:
- **JSON** (default) - Standard structured response
- **XML** - XML 1.0 compliant format
- **CSV** - Flattened CSV format with proper escaping

All responses include metadata with timing, request IDs, and source information.

## Caching Strategy

### Memory Caching
- 5-minute TTL for geolocation data
- LRU eviction with 10,000 entry limit
- Cache key includes query parameters for proper variation

### Cache Headers
- `Cache-Control: public, max-age=300` for client caching
- `Vary: Accept-Encoding` for proper content negotiation

## Error Handling

### Standardized Error Responses
All errors follow consistent format:
```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable message",
    "details": {...}
  },
  "meta": {
    "version": "v1",
    "timestamp": "...",
    "requestId": "...",
    "processingTime": 0
  }
}
```

### Error Types
- `RATE_LIMIT_EXCEEDED` - 429 status
- `REQUEST_TIMEOUT` - 408 status
- `GEOLOCATION_ERROR` - 500 status
- `RESOURCE_NOT_FOUND` - 404 status

## Development Notes

### Environment Detection
The application automatically detects its environment:
- Cloudflare Workers via global scope detection
- Vercel via `VERCEL_ENV` variable
- Netlify via `NETLIFY` global
- Defaults to development

### Logging
- Development: Full debug logging with stack traces
- Production: Error-only logging with sensitive data filtering
- Security: Automatic prevention of sensitive data logging in production

### Testing Strategy
Use curl commands for manual testing:
```bash
# Basic functionality
curl https://your-domain.com/health
curl -H "X-API-Key: $KEY" "https://your-domain.com/api/v1/ips/8.8.8.8?includeThreat=true"

# Format testing
curl -H "X-API-Key: $KEY" "https://your-domain.com/api/v1/ips/8.8.8.8?format=xml"
curl -H "X-API-Key: $KEY" "https://your-domain.com/api/v1/ips/8.8.8.8?format=csv"

# Batch processing (custom method)
curl -X POST -H "X-API-Key: $KEY" -H "Content-Type: application/json" \
  "https://your-domain.com/api/v1/ips:batch" \
  -d '{"ips":["8.8.8.8","1.1.1.1"]}'
```

## Production Considerations

### Performance
- Edge-optimized for sub-100ms response times
- Intelligent multi-provider caching
- Parallel provider queries with timeout protection

### Security
- Zero-trust architecture with comprehensive validation
- OWASP-compliant security headers
- Production security audit capabilities

### Monitoring
- Lightweight health probe at `/health` (public); detailed checks at `/api/v1/system/health` (admin)
- Prometheus metrics at `/api/v1/system/metrics?format=prometheus` (admin)
- Request tracking with unique IDs

## Common Tasks

### Adding a New Provider
1. Extend `BaseProvider.js` in `src/providers/`
2. Implement `tryExtractSync(ip, ctx)` (sync, `tier:'sync'`) OR `fetch(ip, opts)` (async, `tier:'async'`), plus `isConfigured()`. Build the return value with `createGeoData()`; return `null` for "no data", throw `ProviderError` (via `this.classify()`) on real failure.
3. Add one row to `PROVIDER_REGISTRY` in `src/services/performanceOptimizer.js` (`{ module, exportName }`); priority and tier are set in the provider constructor.
4. Set appropriate priority level (`>=50` = primary, `<50` = fallback)

### Modifying Security Settings
- Edit `src/config/security.js` for security policies
- Modify environment-specific settings in `src/config/environment.js`
- Production security changes require redeployment

### Updating Response Format
- Modify `buildGeoResource()` in `src/utils/geoFormatter.js` (resource shape)
- Update `convertToXML`/`convertToCSV`/`serializeByFormat` in the same file for serialization
- Envelope shape (`data`/`meta`/`links`) lives in `src/utils/responseBuilder.js`