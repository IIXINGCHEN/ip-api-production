/**
 * Threat detection rules and configuration
 * Centralized threat detection logic to improve accuracy and reduce false positives
 */

export const THREAT_RULES = {
  // Legitimate ISP ranges that should NEVER be flagged as VPN/proxy
  legitimateISPs: {
    ipv4: [
      // China ISPs - Major legitimate providers
      '1.', '14.', '27.', '36.', '39.', '42.', '49.', '58.', '59.', '60.', '61.',
      '101.', '106.', '110.', '111.', '112.', '113.', '114.', '115.', '116.',
      '117.', '118.', '119.', '120.', '121.', '122.', '123.', '124.', '125.',
      '175.', '180.', '182.', '183.', '202.', '203.', '210.', '211.', '218.',
      '219.', '220.', '221.', '222.', '223.',

      // Major US ISPs
      '8.8.', '8.34.', // Google DNS
      '1.1.', '1.0.', // Cloudflare DNS
      '4.2.2.', // Level3 DNS
      '208.67.', // OpenDNS

      // Comcast and major US ISP ranges
      '24.', '50.', '66.', '67.', '68.', '69.', '70.', '71.', '72.', '73.',
      '74.', '75.', '76.', '96.', '97.', '98.', '99.',
      '173.', '174.', '184.', '190.',

      // European ISPs
      '80.', '81.', '82.', '83.', '84.', '85.', '86.', '87.', '88.', '89.',
      '90.', '91.', '92.', '93.', '94.', '95.',

      // Other major ISPs globally
      '200.', '201.', '202.', '203.', // APNIC region
      '196.', '197.', '198.', '199.', // Various regions
    ],
    ipv6: [
      // China ISPs IPv6
      '2409:', // China Mobile
      '240e:', // China Telecom
      '2408:', // China Unicom
      '240c:', // China Mobile
      '2001:da8:', // CERNET

      // Major global ISPs IPv6
      '2001:4860:', '2a00:1450:', // Google
      '2001:558:', '2600:1400:', // Comcast
      '2001:4998:', // Yahoo/Verizon
      '2620:0:', // Facebook/Meta
      '2a02:26f0:', // Deutsche Telekom
      '2001:8b0:', // BT
      '2001:200:', // WIDE Project (Japan)
      '2400:cb00:', // Cloudflare Asia
    ]
  },

  // Known VPN provider ranges (more specific)
  knownVPNRanges: {
    ipv4: [
      '185.220.100.', '185.220.101.', '185.220.102.', // Tor/VPN exits
      '198.98.50.', '198.98.51.', '198.98.52.', // VPN providers
      '46.166.160.', '46.166.161.', // Specific VPN ranges
      '192.42.116.', // Known VPN service
    ],
    ipv6: [
      '2001:67c:4e8:', // Known VPN provider
      '2a03:2880:', // Some VPN services (when used as VPN)
    ]
  },

  // Datacenter/hosting ranges commonly used for VPN/proxy
  datacenterRanges: {
    ipv4: [
      // DigitalOcean specific ranges
      '138.68.', '159.89.', '167.99.', '207.154.', '178.62.', '46.101.',

      // OVH hosting
      '5.79.', '5.135.', '167.114.',

      // Scaleway hosting
      '51.15.', '51.158.',

      // Only very specific cloud ranges known for VPN usage
      '52.0.', '52.1.', '52.2.', // AWS VPN-specific
      '35.0.', '35.1.', '35.2.', // Google Cloud VPN-specific
      '40.0.', '40.1.', '40.2.', // Azure VPN-specific
    ]
  },

  // Legitimate services that should never be flagged as proxy
  legitimateServices: {
    ipv4: [
      // CDN services
      '104.28.', '172.67.', // Cloudflare CDN
      '151.101.', // Fastly CDN
      '185.199.', '140.82.', // GitHub Pages
      '13.107.', // Microsoft CDN
      '23.', // Akamai CDN ranges

      // Major cloud providers (legitimate usage)
      '52.', '54.', // AWS (broad ranges for legitimate services)
      '35.', '34.', // Google Cloud
      '40.', '13.', // Azure

      // Search engines and major services
      '66.249.', // Googlebot
      '157.55.', // Bingbot
      '199.16.', // Twitter
      '31.13.', // Facebook
    ]
  },

  // Risk scoring weights
  riskWeights: {
    knownVPN: 60,
    datacenter: 40,
    geoInconsistency: 20,
    multipleHops: 30,
    vpnHeaders: 25,
    proxyHeaders: 15,
    suspiciousPorts: 15,
    proxyUserAgent: 30,
    vpnUserAgent: 40,
    missingHeaders: 10,
    botPattern: 15,
    maliciousPattern: 60
  },

  // Risk level thresholds
  riskThresholds: {
    minimal: 0,
    low: 20,
    medium: 40,
    high: 80
  },

  // VPN/Proxy detection patterns
  detectionPatterns: {
    vpnUserAgents: [
      /openvpn/i, /nordvpn/i, /expressvpn/i, /surfshark/i,
      /cyberghost/i, /tunnelbear/i, /protonvpn/i, /windscribe/i,
      /privatevpn/i, /vpn/i
    ],
    proxyUserAgents: [
      /squid/i, /proxy/i, /curl/i, /wget/i, /python-requests/i,
      /go-http-client/i, /okhttp/i, /apache-httpclient/i,
      /java/i, /node\.js/i, /postman/i, /insomnia/i
    ],
    botUserAgents: [
      /bot/i, /crawler/i, /spider/i, /scraper/i,
      /curl/i, /wget/i, /python/i, /requests/i
    ],
    maliciousPatterns: [
      /\.\./,  // Directory traversal
      /union.*select/i,  // SQL injection
      /<script/i,  // XSS
      /eval\(/i,  // Code injection
      /cmd=/i,  // Command injection
    ]
  },

  // Headers that indicate VPN/proxy usage
  suspiciousHeaders: {
    vpn: [
      'x-vpn-client', 'x-tunnel-type', 'x-original-forwarded-for'
    ],
    proxy: [
      'x-forwarded-for', 'x-real-ip', 'x-proxy-id', 'via',
      'forwarded', 'x-cluster-client-ip', 'x-forwarded-proto',
      'x-forwarded-host'
    ],
    cloudflare: [
      'cf-connecting-ip', 'cf-ipcountry', 'cf-ray', 'cf-visitor'
    ]
  },

  // Ports commonly used by proxies
  suspiciousPorts: ['8080', '3128', '1080', '8888', '9050'],

  // Known bad IP patterns (simplified - in production use threat intelligence feeds)
  knownBadIPs: [
    // Add known malicious IPs here
  ],

  // Known good IP ranges
  knownGoodIPs: [
    '8.8.8.',     // Google DNS
    '1.1.1.',     // Cloudflare DNS
    '208.67.222.' // OpenDNS
  ]
}

export const THREAT_CONFIG = {
  // Enable/disable specific detection methods
  detection: {
    vpn: true,
    proxy: true,
    tor: true,
    bot: true,
    malicious: true,
    reputation: true
  },

  // Confidence thresholds for different detection methods
  confidence: {
    high: 0.8,    // 80% confidence
    medium: 0.6,  // 60% confidence
    low: 0.4      // 40% confidence
  },

  // Timeout settings for external API calls
  timeouts: {
    default: 5000,
    threatIntelligence: 3000,
    reputation: 2000
  }
}
