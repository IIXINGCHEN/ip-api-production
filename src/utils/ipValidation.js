/**
 * Unified IP validation utilities
 * Centralizes all IP-related validation logic to eliminate code duplication
 */

export function isValidIP(ip) {
  if (!ip || typeof ip !== 'string') {return false}

  // IPv4 regex - more comprehensive validation
  const ipv4Regex = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/

  // IPv6 regex - comprehensive validation including compressed forms
  const ipv6Regex = /^(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$|^::1$|^::$|^(?:[0-9a-fA-F]{1,4}:)*::[0-9a-fA-F]{1,4}(?::[0-9a-fA-F]{1,4})*$/

  return ipv4Regex.test(ip) || ipv6Regex.test(ip)
}

export function getIPType(ip) {
  if (isPrivateIP(ip)) {return 'private'}
  if (isLoopbackIP(ip)) {return 'loopback'}
  if (isMulticastIP(ip)) {return 'multicast'}
  if (isLinkLocalIP(ip)) {return 'link-local'}
  if (isBroadcastIP(ip)) {return 'broadcast'}
  return 'public'
}

export function getIPVersion(ip) {
  if (!ip || typeof ip !== 'string') {return null}
  return ip.includes(':') ? 6 : 4
}

export function isPrivateIP(ip) {
  if (!ip) {return false}

  // IPv4 private ranges (RFC 1918)
  if (ip.includes('.')) {
    return (
      ip.startsWith('10.') ||
      ip.startsWith('192.168.') ||
      (ip.startsWith('172.') &&
        parseInt(ip.split('.')[1]) >= 16 &&
        parseInt(ip.split('.')[1]) <= 31) ||
      // Additional private ranges
      ip.startsWith('169.254.') || // Link-local
      ip.startsWith('127.') // Loopback (technically not private but internal)
    )
  }

  // IPv6 private ranges (RFC 4193, RFC 3927)
  if (ip.includes(':')) {
    const lowerIP = ip.toLowerCase()
    return (
      lowerIP.startsWith('fc') ||
      lowerIP.startsWith('fd') ||
      lowerIP.startsWith('fe80') || // Link-local
      lowerIP.startsWith('::1') || // Loopback
      lowerIP === '::' // Unspecified
    )
  }

  return false
}

export function isLoopbackIP(ip) {
  if (!ip) {return false}

  // IPv4 loopback
  if (ip.includes('.')) {
    return ip === '127.0.0.1' || ip.startsWith('127.')
  }

  // IPv6 loopback
  if (ip.includes(':')) {
    return ip === '::1'
  }

  return false
}

export function isMulticastIP(ip) {
  if (!ip) {return false}

  // IPv4 multicast (224.0.0.0 to 239.255.255.255)
  if (ip.includes('.')) {
    const firstOctet = parseInt(ip.split('.')[0])
    return firstOctet >= 224 && firstOctet <= 239
  }

  // IPv6 multicast (ff00::/8)
  if (ip.includes(':')) {
    return ip.toLowerCase().startsWith('ff')
  }

  return false
}

export function isLinkLocalIP(ip) {
  if (!ip) {return false}

  // IPv4 link-local (169.254.0.0/16)
  if (ip.includes('.')) {
    return ip.startsWith('169.254.')
  }

  // IPv6 link-local (fe80::/10)
  if (ip.includes(':')) {
    return ip.toLowerCase().startsWith('fe80')
  }

  return false
}

export function isBroadcastIP(ip) {
  if (!ip) {return false}

  // IPv4 broadcast addresses
  if (ip.includes('.')) {
    return (
      ip === '255.255.255.255' || // Limited broadcast
      ip.endsWith('.255') // Network broadcast (simplified check)
    )
  }

  // IPv6 doesn't have broadcast (uses multicast instead)
  return false
}

export function isPublicIP(ip) {
  if (!ip) {return false}

  return !isPrivateIP(ip) &&
         !isLoopbackIP(ip) &&
         !isMulticastIP(ip) &&
         !isLinkLocalIP(ip) &&
         !isBroadcastIP(ip)
}

export function normalizeIP(ip) {
  if (!ip || typeof ip !== 'string') {return null}

  // Trim whitespace
  ip = ip.trim()

  // IPv6 normalization - expand compressed notation
  if (ip.includes(':')) {
    // Basic IPv6 normalization (can be enhanced)
    return ip.toLowerCase()
  }

  // IPv4 normalization - ensure proper format
  if (ip.includes('.')) {
    const parts = ip.split('.')
    if (parts.length === 4) {
      // Remove leading zeros and validate each octet
      const normalizedParts = parts.map(part => {
        const num = parseInt(part, 10)
        return (num >= 0 && num <= 255) ? num.toString() : null
      })

      if (normalizedParts.every(part => part !== null)) {
        return normalizedParts.join('.')
      }
    }
  }

  return null
}

export function getIPAddressInfo(ip) {
  if (!isValidIP(ip)) {
    return {
      valid: false,
      error: 'Invalid IP address format'
    }
  }

  const normalized = normalizeIP(ip)

  return {
    valid: true,
    original: ip,
    normalized,
    version: getIPVersion(ip),
    type: getIPType(ip),
    isPrivate: isPrivateIP(ip),
    isLoopback: isLoopbackIP(ip),
    isMulticast: isMulticastIP(ip),
    isLinkLocal: isLinkLocalIP(ip),
    isBroadcast: isBroadcastIP(ip),
    isPublic: isPublicIP(ip)
  }
}
