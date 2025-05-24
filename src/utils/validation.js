/**
 * Unified input validation utilities
 * Centralized validation logic for all API inputs
 */

import { isValidIP } from './ipValidation.js'
import { sanitizeInput } from './security.js'

/**
 * Validation result structure
 */
class ValidationResult {
  constructor(valid = true, errors = [], sanitized = null) {
    this.valid = valid
    this.errors = Array.isArray(errors) ? errors : [errors].filter(Boolean)
    this.sanitized = sanitized
  }

  addError(error) {
    this.valid = false
    this.errors.push(error)
    return this
  }

  merge(other) {
    if (!other.valid) {
      this.valid = false
      this.errors.push(...other.errors)
    }
    return this
  }
}

/**
 * IP address validation
 */
export function validateIP(ip, options = {}) {
  const { required = true, allowPrivate = true } = options

  if (!ip) {
    return required
      ? new ValidationResult(false, 'IP address is required')
      : new ValidationResult(true, [], null)
  }

  if (typeof ip !== 'string') {
    return new ValidationResult(false, 'IP address must be a string')
  }

  const sanitized = sanitizeInput(ip, { maxLength: 45, stripWhitespace: true })

  if (!isValidIP(sanitized)) {
    return new ValidationResult(false, 'Invalid IP address format')
  }

  // Additional IP-specific validations can be added here
  if (!allowPrivate && isPrivateIP(sanitized)) {
    return new ValidationResult(false, 'Private IP addresses are not allowed')
  }

  return new ValidationResult(true, [], sanitized)
}

/**
 * API key validation
 */
export function validateApiKey(apiKey, options = {}) {
  const { required = true, minLength = 16, maxLength = 128 } = options

  if (!apiKey) {
    return required
      ? new ValidationResult(false, 'API key is required')
      : new ValidationResult(true, [], null)
  }

  if (typeof apiKey !== 'string') {
    return new ValidationResult(false, 'API key must be a string')
  }

  const sanitized = sanitizeInput(apiKey, { maxLength: maxLength + 10, stripWhitespace: true })

  if (sanitized.length < minLength || sanitized.length > maxLength) {
    return new ValidationResult(false, `API key must be between ${minLength} and ${maxLength} characters`)
  }

  // Check for valid characters (alphanumeric, hyphens, underscores)
  if (!/^[a-zA-Z0-9_-]+$/.test(sanitized)) {
    return new ValidationResult(false, 'API key contains invalid characters')
  }

  return new ValidationResult(true, [], sanitized)
}

/**
 * Query parameter validation
 */
export function validateQueryParams(params, schema) {
  const result = new ValidationResult(true, [], {})

  for (const [key, rules] of Object.entries(schema)) {
    const value = params[key]
    const fieldResult = validateField(value, rules, key)

    if (!fieldResult.valid) {
      result.merge(fieldResult)
    } else {
      result.sanitized[key] = fieldResult.sanitized
    }
  }

  return result
}

/**
 * Request body validation
 */
export function validateRequestBody(body, schema) {
  if (!body || typeof body !== 'object') {
    return new ValidationResult(false, 'Request body must be a valid JSON object')
  }

  return validateQueryParams(body, schema)
}

/**
 * Field validation based on rules
 */
function validateField(value, rules, fieldName) {
  const {
    type = 'string',
    required = false,
    minLength = 0,
    maxLength = 1000,
    pattern = null,
    enum: enumValues = null,
    custom = null
  } = rules

  // Check if field is required
  if (required && (value === undefined || value === null || value === '')) {
    return new ValidationResult(false, `${fieldName} is required`)
  }

  // If not required and empty, return valid with null
  if (!required && (value === undefined || value === null || value === '')) {
    return new ValidationResult(true, [], null)
  }

  // Type validation
  const typeResult = validateType(value, type, fieldName)
  if (!typeResult.valid) {
    return typeResult
  }

  let sanitized = typeResult.sanitized

  // String-specific validations
  if (type === 'string' && typeof sanitized === 'string') {
    // Length validation
    if (sanitized.length < minLength) {
      return new ValidationResult(false, `${fieldName} must be at least ${minLength} characters`)
    }
    if (sanitized.length > maxLength) {
      return new ValidationResult(false, `${fieldName} must not exceed ${maxLength} characters`)
    }

    // Pattern validation
    if (pattern && !pattern.test(sanitized)) {
      return new ValidationResult(false, `${fieldName} format is invalid`)
    }

    // Enum validation
    if (enumValues && !enumValues.includes(sanitized)) {
      return new ValidationResult(false, `${fieldName} must be one of: ${enumValues.join(', ')}`)
    }
  }

  // Array-specific validations
  if (type === 'array' && Array.isArray(sanitized)) {
    if (sanitized.length < minLength) {
      return new ValidationResult(false, `${fieldName} must have at least ${minLength} items`)
    }
    if (sanitized.length > maxLength) {
      return new ValidationResult(false, `${fieldName} must not have more than ${maxLength} items`)
    }
  }

  // Custom validation
  if (custom && typeof custom === 'function') {
    const customResult = custom(sanitized, fieldName)
    if (customResult && !customResult.valid) {
      return customResult
    }
    if (customResult && customResult.sanitized !== undefined) {
      sanitized = customResult.sanitized
    }
  }

  return new ValidationResult(true, [], sanitized)
}

/**
 * Type validation and conversion
 */
function validateType(value, type, fieldName) {
  switch (type) {
  case 'string':
    if (typeof value !== 'string') {
      return new ValidationResult(false, `${fieldName} must be a string`)
    }
    return new ValidationResult(true, [], sanitizeInput(value))

  case 'number':
    const num = Number(value)
    if (isNaN(num)) {
      return new ValidationResult(false, `${fieldName} must be a valid number`)
    }
    return new ValidationResult(true, [], num)

  case 'integer':
    const int = parseInt(value, 10)
    if (isNaN(int) || int.toString() !== value.toString()) {
      return new ValidationResult(false, `${fieldName} must be a valid integer`)
    }
    return new ValidationResult(true, [], int)

  case 'boolean':
    if (typeof value === 'boolean') {
      return new ValidationResult(true, [], value)
    }
    if (value === 'true' || value === '1') {
      return new ValidationResult(true, [], true)
    }
    if (value === 'false' || value === '0') {
      return new ValidationResult(true, [], false)
    }
    return new ValidationResult(false, `${fieldName} must be a boolean`)

  case 'array':
    if (!Array.isArray(value)) {
      return new ValidationResult(false, `${fieldName} must be an array`)
    }
    return new ValidationResult(true, [], value)

  case 'object':
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return new ValidationResult(false, `${fieldName} must be an object`)
    }
    return new ValidationResult(true, [], value)

  case 'ip':
    return validateIP(value, { required: true })

  default:
    return new ValidationResult(false, `Unknown type: ${type}`)
  }
}

/**
 * Common validation schemas
 */
export const ValidationSchemas = {
  // IP lookup parameters
  ipLookup: {
    ip: {
      type: 'ip',
      required: true
    }
  },

  // Geo query parameters
  geoQuery: {
    format: {
      type: 'string',
      required: false,
      enum: ['json', 'xml', 'csv'],
      default: 'json'
    },
    lang: {
      type: 'string',
      required: false,
      pattern: /^[a-z]{2}$/,
      default: 'en'
    },
    fields: {
      type: 'string',
      required: false,
      pattern: /^[a-zA-Z,_]+$/
    },
    include_threat: {
      type: 'boolean',
      required: false,
      default: false
    }
  },

  // Batch request body
  batchRequest: {
    ips: {
      type: 'array',
      required: true,
      minLength: 1,
      maxLength: 10,
      custom: (ips) => {
        const errors = []
        const sanitized = []

        for (let i = 0; i < ips.length; i++) {
          const ipResult = validateIP(ips[i])
          if (!ipResult.valid) {
            errors.push(`IP at index ${i}: ${ipResult.errors.join(', ')}`)
          } else {
            sanitized.push(ipResult.sanitized)
          }
        }

        return errors.length > 0
          ? new ValidationResult(false, errors)
          : new ValidationResult(true, [], sanitized)
      }
    },
    options: {
      type: 'object',
      required: false,
      default: {}
    }
  },

  // API key validation
  apiKey: {
    key: {
      type: 'string',
      required: true,
      minLength: 16,
      maxLength: 128,
      pattern: /^[a-zA-Z0-9_-]+$/
    }
  }
}

/**
 * Validate request using predefined schema
 */
export function validateRequest(data, schemaName) {
  const schema = ValidationSchemas[schemaName]
  if (!schema) {
    return new ValidationResult(false, `Unknown validation schema: ${schemaName}`)
  }

  return validateQueryParams(data, schema)
}

// Helper function for private IP check (simplified)
function isPrivateIP(ip) {
  if (!ip) {return false}

  if (ip.includes('.')) {
    return (
      ip.startsWith('10.') ||
      ip.startsWith('192.168.') ||
      (ip.startsWith('172.') &&
        parseInt(ip.split('.')[1]) >= 16 &&
        parseInt(ip.split('.')[1]) <= 31)
    )
  }

  return false
}
