import { SECURITY_CONFIG } from '../config/security.js'

export const authMiddleware = async (c, next) => {
  const path = c.req.path
  const isAdminPath = path.startsWith('/admin')

  // Check if API key is required
  const requiresAuth = SECURITY_CONFIG.apiKey.required ||
    (isAdminPath && SECURITY_CONFIG.apiKey.adminRequired)

  if (requiresAuth) {
    const apiKey = c.req.header(SECURITY_CONFIG.apiKey.header)

    if (!apiKey) {
      return c.json({
        error: 'Unauthorized',
        message: 'API key required',
        timestamp: new Date().toISOString()
      }, 401)
    }

    // Validate API key
    const isValid = await validateApiKey(apiKey)
    if (!isValid) {
      return c.json({
        error: 'Unauthorized',
        message: 'Invalid API key',
        timestamp: new Date().toISOString()
      }, 401)
    }

    // Store API key info in context
    c.set('apiKey', apiKey)
    c.set('authenticated', true)
  }

  await next()
}

async function validateApiKey(apiKey) {
  // In a real implementation, you would validate against a database
  // For now, we'll use environment variables or hardcoded keys
  const validKeys = [
    globalThis.API_KEY_ADMIN,
    globalThis.API_KEY_USER,
    // Add more keys as needed
  ].filter(Boolean)

  return validKeys.includes(apiKey)
}

export const requireAuth = async (c, next) => {
  if (!c.get('authenticated')) {
    return c.json({
      error: 'Unauthorized',
      message: 'Authentication required',
      timestamp: new Date().toISOString()
    }, 401)
  }
  await next()
}
