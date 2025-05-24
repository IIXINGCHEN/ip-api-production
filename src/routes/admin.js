import { Hono } from 'hono'
import { authMiddleware, requireAuth } from '../middleware/auth.js'
import { getCacheStats, clearCache } from '../middleware/cache.js'

const app = new Hono()

// Apply authentication to all admin routes
app.use('*', authMiddleware)
app.use('*', requireAuth)

// Get system statistics
app.get('/stats', async (c) => {
  try {
    const cacheStats = getCacheStats()

    const stats = {
      system: {
        uptime: 'N/A', // Not available in Workers environment
        memory: 'N/A', // Not available in Workers environment
        version: '2.0.0',
        timestamp: new Date().toISOString()
      },
      cache: cacheStats,
      requests: {
        // In a real implementation, you would track these metrics
        total: 'N/A',
        successful: 'N/A',
        failed: 'N/A',
        rateLimit: 'N/A'
      }
    }

    return c.json(stats)
  } catch (error) {
    return c.json({
      error: 'Internal Server Error',
      message: 'Failed to retrieve system statistics',
      timestamp: new Date().toISOString()
    }, 500)
  }
})

// Clear cache
app.post('/cache/clear', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}))
    const pattern = body.pattern

    clearCache(pattern)

    return c.json({
      success: true,
      message: pattern ? `Cache cleared for pattern: ${pattern}` : 'All cache cleared',
      timestamp: new Date().toISOString()
    })
  } catch (error) {
    return c.json({
      error: 'Internal Server Error',
      message: 'Failed to clear cache',
      timestamp: new Date().toISOString()
    }, 500)
  }
})

// Get cache information
app.get('/cache', async (c) => {
  try {
    const cacheStats = getCacheStats()

    return c.json({
      stats: cacheStats,
      timestamp: new Date().toISOString()
    })
  } catch (error) {
    return c.json({
      error: 'Internal Server Error',
      message: 'Failed to retrieve cache information',
      timestamp: new Date().toISOString()
    }, 500)
  }
})

// Health check with detailed information
app.get('/health', async (c) => {
  try {
    const health = {
      status: 'healthy',
      version: '2.0.0',
      timestamp: new Date().toISOString(),
      uptime: 'N/A', // Not available in Workers environment
      memory: 'N/A', // Not available in Workers environment
      cache: getCacheStats(),
      environment: {
        platform: 'cloudflare-workers',
        runtime: 'V8'
      }
    }

    return c.json(health)
  } catch (error) {
    return c.json({
      status: 'unhealthy',
      error: 'Health check failed',
      timestamp: new Date().toISOString()
    }, 500)
  }
})

// Configuration endpoint
app.get('/config', async (c) => {
  try {
    // Return non-sensitive configuration information
    const config = {
      rateLimit: {
        windowMs: 15 * 60 * 1000,
        max: 100
      },
      cache: {
        enabled: true,
        ttl: {
          ip: 300,
          geo: 3600,
          threat: 1800
        }
      },
      security: {
        threatDetection: true,
        ipWhitelist: 'configured',
        apiKeyRequired: false
      },
      timestamp: new Date().toISOString()
    }

    return c.json(config)
  } catch (error) {
    return c.json({
      error: 'Internal Server Error',
      message: 'Failed to retrieve configuration',
      timestamp: new Date().toISOString()
    }, 500)
  }
})

export default app
