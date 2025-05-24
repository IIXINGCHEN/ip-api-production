import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { prettyJSON } from 'hono/pretty-json'

// Import environment configuration
import { ENVIRONMENT, getCurrentConfig, isFeatureEnabled } from './config/environment.js'
import { formatSecureError } from './utils/security.js'

// Import routes
import ipRoutes from './routes/ip.js'
import geoRoutes from './routes/geo.js'
import adminRoutes from './routes/admin.js'

// Import middleware
import { rateLimitMiddleware } from './middleware/rateLimit.js'
import { cacheMiddleware } from './middleware/cache.js'
import { securityMiddleware } from './middleware/security.js'

const app = new Hono()

// Get environment-specific configuration
const envConfig = getCurrentConfig()

// Global middleware - conditionally applied based on environment
if (!ENVIRONMENT.isProduction() || isFeatureEnabled('debug')) {
  app.use('*', logger())
}

app.use('*', prettyJSON())

// CORS configuration from environment
app.use('*', cors({
  origin: envConfig.api.corsOrigins,
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'X-API-Key'],
  exposeHeaders: ['X-Client-IP', 'X-Rate-Limit-Remaining', 'X-Cache-Status']
}))

// Security middleware
app.use('*', securityMiddleware)

// Rate limiting
app.use('*', rateLimitMiddleware)

// Caching
app.use('*', cacheMiddleware)

// Health check endpoint
app.get('/health', (c) => {
  return c.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: '2.0.0'
  })
})

// API routes
app.route('/', ipRoutes)
app.route('/', geoRoutes)
app.route('/admin', adminRoutes)

// 404 handler
app.notFound((c) => {
  return c.json({
    error: 'Not Found',
    message: 'The requested endpoint does not exist',
    timestamp: new Date().toISOString()
  }, 404)
})

// Error handler with secure error formatting
app.onError((error, c) => {
  // Use secure error formatting based on environment
  const secureError = formatSecureError(error, !ENVIRONMENT.isProduction())

  return c.json(secureError, 500)
})

export default app
