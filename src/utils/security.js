/**
 * Security utility functions
 * Centralized security-related helper functions
 */

import { ENVIRONMENT } from '../config/environment.js'
import { isPrivateIP, isLoopbackIP, isMulticastIP } from './ipValidation.js'

/**
 * Enhanced input sanitization
 */
export function sanitizeInput(input, options = {}) {
  if (typeof input !== 'string') {return input}

  const {
    allowHTML = false,
    allowScripts = false,
    maxLength = 1000,
    stripWhitespace = true
  } = options

  let sanitized = input

  // Trim whitespace if requested
  if (stripWhitespace) {
    sanitized = sanitized.trim()
  }

  // Enforce maximum length
  if (sanitized.length > maxLength) {
    sanitized = sanitized.substring(0, maxLength)
  }

  // Remove potentially dangerous characters
  if (!allowHTML) {
    sanitized = sanitized
      .replace(/[<>]/g, '') // Remove angle brackets
      .replace(/javascript:/gi, '') // Remove javascript: protocol
      .replace(/data:/gi, '') // Remove data: protocol
      .replace(/vbscript:/gi, '') // Remove vbscript: protocol
  }

  if (!allowScripts) {
    sanitized = sanitized
      .replace(/on\w+=/gi, '') // Remove event handlers
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '') // Remove script tags
      .replace(/eval\s*\(/gi, '') // Remove eval calls
      .replace(/setTimeout\s*\(/gi, '') // Remove setTimeout calls
      .replace(/setInterval\s*\(/gi, '') // Remove setInterval calls
  }

  return sanitized
}

/**
 * Validate and sanitize API key
 */
export function validateApiKey(apiKey) {
  if (!apiKey || typeof apiKey !== 'string') {
    return { valid: false, error: 'API key is required' }
  }

  // Basic format validation
  if (apiKey.length < 16 || apiKey.length > 128) {
    return { valid: false, error: 'Invalid API key format' }
  }

  // Check for suspicious patterns
  if (/[<>'"&]/.test(apiKey)) {
    return { valid: false, error: 'Invalid characters in API key' }
  }

  return { valid: true, sanitized: apiKey.trim() }
}

/**
 * Generate secure request ID with additional entropy
 */
export function generateSecureRequestId() {
  // Get high-precision timestamp
  const timestamp = Date.now()
  const microTime = performance.now().toString().replace('.', '')

  // Generate crypto-quality random bytes if available
  let randomBytes = ''
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const array = new Uint8Array(16)
    crypto.getRandomValues(array)
    randomBytes = Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('')
  } else {
    // Fallback to Math.random
    randomBytes = Array.from({ length: 32 }, () =>
      Math.floor(Math.random() * 16).toString(16)
    ).join('')
  }

  // Generate UUID v4
  const uuid = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })

  // Combine all entropy sources
  return `${uuid}-${randomBytes}-${timestamp}-${microTime}`
}

/**
 * Secure header validation
 */
export function validateHeaders(headers) {
  const issues = []
  const secureHeaders = {}

  // Check for required security headers in production
  if (ENVIRONMENT.isProduction()) {
    const requiredHeaders = [
      'x-content-type-options',
      'x-frame-options',
      'x-xss-protection',
      'strict-transport-security'
    ]

    for (const header of requiredHeaders) {
      if (!headers[header] && !headers[header.toLowerCase()]) {
        issues.push(`Missing security header: ${header}`)
      }
    }
  }

  // Validate Content-Security-Policy if present
  const csp = headers['content-security-policy'] || headers['Content-Security-Policy']
  if (csp) {
    if (!csp.includes('default-src') && !csp.includes('script-src')) {
      issues.push('CSP header should include default-src or script-src directive')
    }
  }

  // Validate CORS headers
  const origin = headers['origin'] || headers['Origin']
  if (origin) {
    try {
      new URL(origin)
      secureHeaders['Access-Control-Allow-Origin'] = origin
    } catch {
      issues.push('Invalid origin header format')
    }
  }

  return {
    valid: issues.length === 0,
    issues,
    secureHeaders
  }
}

/**
 * Rate limiting helper
 */
export function calculateRateLimit(requests, windowMs, maxRequests) {
  const now = Date.now()
  const validRequests = requests.filter(timestamp => now - timestamp < windowMs)

  return {
    count: validRequests.length,
    remaining: Math.max(0, maxRequests - validRequests.length),
    resetTime: validRequests.length > 0 ? Math.min(...validRequests) + windowMs : now + windowMs,
    exceeded: validRequests.length >= maxRequests
  }
}

/**
 * IP address security validation
 */
export function validateIPSecurity(ip, options = {}) {
  const {
    allowPrivate = true,
    allowLoopback = false,
    allowMulticast = false,
    blockedRanges = []
  } = options

  const issues = []

  // Check against blocked ranges
  for (const range of blockedRanges) {
    if (ip.startsWith(range)) {
      issues.push(`IP address matches blocked range: ${range}`)
    }
  }

  // Validate IP characteristics
  if (!allowPrivate && isPrivateIP(ip)) {
    issues.push('Private IP addresses are not allowed')
  }

  if (!allowLoopback && isLoopbackIP(ip)) {
    issues.push('Loopback IP addresses are not allowed')
  }

  if (!allowMulticast && isMulticastIP(ip)) {
    issues.push('Multicast IP addresses are not allowed')
  }

  return {
    valid: issues.length === 0,
    issues,
    riskLevel: calculateIPRiskLevel(ip, issues.length)
  }
}

/**
 * Calculate IP risk level based on characteristics
 */
function calculateIPRiskLevel(ip, issueCount) {
  let risk = 0

  // Base risk from validation issues
  risk += issueCount * 20

  // Additional risk factors could be added here
  // e.g., checking against threat intelligence feeds

  if (risk >= 80) {return 'high'}
  if (risk >= 40) {return 'medium'}
  if (risk >= 20) {return 'low'}
  return 'minimal'
}

/**
 * Secure error message formatting
 */
export function formatSecureError(error, includeDetails = false) {
  const baseError = {
    error: 'An error occurred',
    timestamp: new Date().toISOString(),
    requestId: generateSecureRequestId()
  }

  // In production, don't expose sensitive error details
  if (ENVIRONMENT.isProduction() && !includeDetails) {
    return baseError
  }

  // In development or when details are explicitly requested
  return {
    ...baseError,
    message: error.message || 'Unknown error',
    type: error.name || 'Error',
    ...(error.stack && !ENVIRONMENT.isProduction() && { stack: error.stack })
  }
}

/**
 * Content type validation
 */
export function validateContentType(contentType, allowedTypes = ['application/json']) {
  if (!contentType) {
    return { valid: false, error: 'Content-Type header is required' }
  }

  const normalizedType = contentType.toLowerCase().split(';')[0].trim()

  if (!allowedTypes.includes(normalizedType)) {
    return {
      valid: false,
      error: `Unsupported content type: ${normalizedType}`
    }
  }

  return { valid: true, type: normalizedType }
}

// IP validation functions are now imported from ipValidation.js
