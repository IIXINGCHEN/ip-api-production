import { THREAT_RULES, THREAT_CONFIG } from "../config/threatRules.js";

export class ThreatService {
  constructor() {
    this.name = "ThreatService";
    this.rules = THREAT_RULES;
    this.config = THREAT_CONFIG;
  }

  async getThreatInfo(ip, request) {
    try {
      const threatInfo = {
        ip,
        riskScore: 0,
        threats: [],
        isVPN: false,
        isProxy: false,
        isTor: false,
        isBot: false,
        isMalicious: false,
        reputation: "unknown",
        lastSeen: null,
        sources: [],
      };

      // Perform multiple threat checks
      const checks = await Promise.allSettled([
        this.checkVPN(ip, request),
        this.checkProxy(ip, request),
        this.checkTor(ip, request),
        this.checkBot(ip, request),
        this.checkReputation(ip, request),
        this.checkMaliciousActivity(ip, request),
      ]);

      // Process check results
      checks.forEach((result, index) => {
        if (result.status === "fulfilled" && result.value) {
          const checkName = [
            "VPN",
            "Proxy",
            "Tor",
            "Bot",
            "Reputation",
            "Malicious",
          ][index];
          const data = result.value;

          // Update threat info based on check results
          if (data.detected) {
            threatInfo.threats.push(checkName.toLowerCase());
            // Use configured risk weights
            const weight =
              this.rules.riskWeights[`${checkName.toLowerCase()}Pattern`] ||
              data.riskScore ||
              10;
            threatInfo.riskScore += weight;
          }

          // Update specific flags
          switch (checkName) {
            case "VPN":
              threatInfo.isVPN = data.detected;
              break;
            case "Proxy":
              threatInfo.isProxy = data.detected;
              break;
            case "Tor":
              threatInfo.isTor = data.detected;
              break;
            case "Bot":
              threatInfo.isBot = data.detected;
              break;
            case "Malicious":
              threatInfo.isMalicious = data.detected;
              break;
            case "Reputation":
              threatInfo.reputation = data.reputation || "unknown";
              break;
          }

          if (data.source) {
            threatInfo.sources.push(data.source);
          }
        }
      });

      // Calculate overall risk level
      threatInfo.riskLevel = this.calculateRiskLevel(threatInfo.riskScore);

      // Add timestamp
      threatInfo.timestamp = new Date().toISOString();

      return threatInfo;
    } catch (error) {
      // Enhanced error handling for threat detection
      if (error.message && error.message.includes("Invalid IP")) {
        throw new Error("Invalid IP address for threat analysis");
      }

      // For threat detection, we can provide fallback data instead of failing
      return {
        ip,
        riskScore: 0,
        threats: [],
        isVPN: false,
        isProxy: false,
        isTor: false,
        isBot: false,
        isMalicious: false,
        reputation: "unknown",
        lastSeen: null,
        sources: [],
        riskLevel: "minimal",
        timestamp: new Date().toISOString(),
        error: "Threat detection partially unavailable",
      };
    }
  }

  async checkVPN(ip, request) {
    try {
      // CRITICAL: Legitimate ISPs should NEVER be flagged as VPN
      if (this.isLegitimateISP(ip)) {
        return {
          detected: false,
          riskScore: 0,
          indicators: ["legitimate_isp"],
          source: "enhanced_vpn_check",
        };
      }

      let riskScore = 0;
      let detected = false;
      const indicators = [];

      // Check against known VPN/hosting provider IP ranges
      if (this.isKnownVPNRange(ip)) {
        detected = true;
        riskScore += 60;
        indicators.push("known_vpn_range");
      }

      // Check for hosting/datacenter IP ranges
      if (this.isDatacenterIP(ip)) {
        detected = true;
        riskScore += 40;
        indicators.push("datacenter_ip");
      }

      // Check for suspicious geolocation patterns
      const geoCheck = this.checkGeoInconsistency(request);
      if (geoCheck.suspicious) {
        riskScore += 20;
        indicators.push("geo_inconsistency");
      }

      // Check for multiple IP hops (proxy chains)
      const hopCheck = this.checkIPHops(request);
      if (hopCheck.multipleHops) {
        detected = true;
        riskScore += 30;
        indicators.push("multiple_hops");
      }

      // Check for VPN-specific headers
      const headerCheck = this.checkVPNHeaders(request);
      if (headerCheck.detected) {
        detected = true;
        riskScore += headerCheck.score;
        indicators.push(...headerCheck.indicators);
      }

      return {
        detected,
        riskScore,
        indicators,
        source: "enhanced_vpn_check",
      };
    } catch (error) {
      return { detected: false, riskScore: 0, indicators: [] };
    }
  }

  async checkProxy(ip, request) {
    try {
      // CRITICAL: Legitimate ISPs and services should NEVER be flagged as proxy
      if (this.isLegitimateISP(ip) || this.isLegitimateService(ip)) {
        return {
          detected: false,
          riskScore: 0,
          indicators: ["legitimate_service"],
          source: "enhanced_proxy_check",
        };
      }

      let riskScore = 0;
      let detected = false;
      const indicators = [];

      // Check for proxy-specific headers
      const proxyHeaders = this.analyzeProxyHeaders(request);
      if (proxyHeaders.detected) {
        detected = true;
        riskScore += proxyHeaders.score;
        indicators.push(...proxyHeaders.indicators);
      }

      // Check for known proxy IP ranges
      if (this.isKnownProxyRange(ip)) {
        detected = true;
        riskScore += 50;
        indicators.push("known_proxy_range");
      }

      // Check for suspicious port patterns
      const portCheck = this.checkSuspiciousPorts(request);
      if (portCheck.suspicious) {
        riskScore += 15;
        indicators.push("suspicious_ports");
      }

      // Check for proxy-specific user agent patterns
      const uaCheck = this.checkProxyUserAgent(request);
      if (uaCheck.detected) {
        detected = true;
        riskScore += uaCheck.score;
        indicators.push("proxy_user_agent");
      }

      return {
        detected,
        riskScore,
        indicators,
        source: "enhanced_proxy_check",
      };
    } catch (error) {
      return { detected: false, riskScore: 0, indicators: [] };
    }
  }

  async checkTor(_ip, request) {
    try {
      // Simplified Tor detection
      // In production, you would check against Tor exit node lists
      let detected = false;
      let riskScore = 0;

      // Check for Tor browser user agent patterns
      const userAgent = request.header("user-agent") || "";
      if (userAgent.includes("Tor Browser")) {
        detected = true;
        riskScore += 50;
      }

      return {
        detected,
        riskScore,
        source: "internal_tor_check",
      };
    } catch (error) {
      return { detected: false, riskScore: 0 };
    }
  }

  async checkBot(_ip, request) {
    try {
      let detected = false;
      let riskScore = 0;

      const userAgent = request.header("user-agent") || "";

      // Check for bot patterns
      const botPatterns = [
        /bot/i,
        /crawler/i,
        /spider/i,
        /scraper/i,
        /curl/i,
        /wget/i,
        /python/i,
        /requests/i,
      ];

      for (const pattern of botPatterns) {
        if (pattern.test(userAgent)) {
          detected = true;
          riskScore += 15;
          break;
        }
      }

      // Check for missing common headers
      if (!request.header("accept-language")) {
        riskScore += 5;
      }
      if (!request.header("accept-encoding")) {
        riskScore += 5;
      }
      if (!userAgent) {
        riskScore += 20;
      }

      if (riskScore > 10) {
        detected = true;
      }

      return {
        detected,
        riskScore,
        source: "internal_bot_check",
      };
    } catch (error) {
      return { detected: false, riskScore: 0 };
    }
  }

  async checkReputation(ip, _request) {
    try {
      // Simplified reputation check
      // In production, you would integrate with threat intelligence feeds

      let reputation = "unknown";
      let riskScore = 0;

      // Check against known bad IP patterns (simplified)
      if (this.isKnownBadIP(ip)) {
        reputation = "malicious";
        riskScore += 80;
      } else if (this.isKnownGoodIP(ip)) {
        reputation = "good";
        riskScore = 0;
      }

      return {
        detected: reputation === "malicious",
        reputation,
        riskScore,
        source: "internal_reputation_check",
      };
    } catch (error) {
      return { detected: false, reputation: "unknown", riskScore: 0 };
    }
  }

  async checkMaliciousActivity(_ip, request) {
    try {
      // Check for signs of malicious activity
      let detected = false;
      let riskScore = 0;

      // Check request patterns that might indicate malicious intent
      const path = request.path || "";
      const userAgent = request.header("user-agent") || "";

      // Check for common attack patterns
      const maliciousPatterns = [
        /\.\./, // Directory traversal
        /union.*select/i, // SQL injection
        /<script/i, // XSS
        /eval\(/i, // Code injection
        /cmd=/i, // Command injection
      ];

      for (const pattern of maliciousPatterns) {
        if (pattern.test(path) || pattern.test(userAgent)) {
          detected = true;
          riskScore += 60;
          break;
        }
      }

      return {
        detected,
        riskScore,
        source: "internal_malicious_check",
      };
    } catch (error) {
      return { detected: false, riskScore: 0 };
    }
  }

  calculateRiskLevel(score) {
    // Use configured risk thresholds
    const thresholds = this.rules.riskThresholds;
    if (score >= thresholds.high) {
      return "high";
    }
    if (score >= thresholds.medium) {
      return "medium";
    }
    if (score >= thresholds.low) {
      return "low";
    }
    return "minimal";
  }

  isKnownVPNRange(ip) {
    // Enhanced VPN range detection with improved ISP recognition

    // First check if it's a legitimate ISP that should never be flagged as VPN
    if (this.isLegitimateISP(ip)) {
      return false;
    }

    // Use centralized VPN range rules
    if (ip.includes(":")) {
      return this.rules.knownVPNRanges.ipv6.some((range) =>
        ip.startsWith(range),
      );
    } else {
      return this.rules.knownVPNRanges.ipv4.some((range) =>
        ip.startsWith(range),
      );
    }
  }

  isLegitimateISP(ip) {
    // Use centralized legitimate ISP rules
    if (ip.includes(":")) {
      return this.rules.legitimateISPs.ipv6.some((range) =>
        ip.startsWith(range),
      );
    } else {
      return this.rules.legitimateISPs.ipv4.some((range) =>
        ip.startsWith(range),
      );
    }
  }

  checkMobileNetworkVPN(_ip) {
    // Mobile networks are generally legitimate
    // Only flag as VPN if there are additional suspicious indicators
    // China Mobile IPv6 ranges are legitimate ISP ranges, not VPN by default

    // Don't flag legitimate mobile ISP ranges as VPN
    // These are normal user connections, not VPN services
    return false;
  }

  isDatacenterIP(ip) {
    // CRITICAL: First check if it's a legitimate ISP that should NEVER be flagged as datacenter
    if (this.isLegitimateISP(ip)) {
      return false;
    }

    // Also check if it's a legitimate service (CDN, etc.)
    if (this.isLegitimateService(ip)) {
      return false;
    }

    // Use centralized datacenter range rules
    return this.rules.datacenterRanges.ipv4.some((range) =>
      ip.startsWith(range),
    );
  }

  isKnownProxyRange(ip) {
    // Enhanced proxy detection - only flag actual proxy services

    // First check if it's a legitimate service that should never be flagged as proxy
    if (this.isLegitimateService(ip)) {
      return false;
    }

    const proxyRanges = [
      // Specific proxy service providers
      "185.220.100.",
      "185.220.101.", // Tor exits used as proxies
      "198.98.50.",
      "198.98.51.", // Known proxy services
      "46.166.160.",
      "46.166.161.", // Specific proxy ranges
      "192.42.116.", // Known proxy service

      // Additional known proxy ranges
      "5.79.",
      "5.135.", // OVH proxy services
      "51.15.",
      "51.158.", // Scaleway proxy services
      "167.114.", // OVH Canada proxy
    ];

    return proxyRanges.some((range) => ip.startsWith(range));
  }

  isLegitimateService(ip) {
    // Use centralized legitimate service rules
    return this.rules.legitimateServices.ipv4.some((range) =>
      ip.startsWith(range),
    );
  }

  checkGeoInconsistency(request) {
    // Check for geolocation inconsistencies
    const _acceptLanguage = request.header("accept-language") || "";
    const _timezone = request.header("x-timezone") || "";

    // Simple heuristic: if language doesn't match expected geo location
    // This is a simplified check - in production you'd use more sophisticated logic
    return {
      suspicious: false, // Placeholder - would need more complex geo analysis
      score: 0,
    };
  }

  checkIPHops(request) {
    // Check for multiple IP hops indicating proxy chains
    const xForwardedFor = request.header("x-forwarded-for") || "";
    const _via = request.header("via") || "";

    const hopCount = xForwardedFor.split(",").length;

    return {
      multipleHops: hopCount > 2,
      hopCount,
    };
  }

  checkVPNHeaders(request) {
    const indicators = [];
    let score = 0;
    let detected = false;

    // Check for VPN-specific headers
    const vpnHeaders = [
      "x-vpn-client",
      "x-tunnel-type",
      "x-forwarded-proto",
      "x-original-forwarded-for",
    ];

    for (const header of vpnHeaders) {
      if (request.header(header)) {
        detected = true;
        score += 25;
        indicators.push(`vpn_header_${header}`);
      }
    }

    return { detected, score, indicators };
  }

  analyzeProxyHeaders(request) {
    const indicators = [];
    let score = 0;
    let detected = false;

    const proxyHeaders = [
      "x-forwarded-for",
      "x-real-ip",
      "x-proxy-id",
      "via",
      "forwarded",
      "x-cluster-client-ip",
      "x-forwarded-proto",
      "x-forwarded-host",
      "cf-connecting-ip",
      "cf-ipcountry",
      "cf-ray",
      "cf-visitor",
    ];

    let headerCount = 0;
    for (const header of proxyHeaders) {
      const headerValue = request.header(header);
      if (headerValue) {
        headerCount++;
        indicators.push(`proxy_header_${header}`);

        // Analyze header values for proxy patterns
        if (header === "x-forwarded-for" && headerValue.includes(",")) {
          // Multiple IPs in X-Forwarded-For indicates proxy chain
          const ips = headerValue.split(",").map((ip) => ip.trim());
          if (ips.length > 1) {
            detected = true;
            score += ips.length * 15;
            indicators.push(`proxy_chain_${ips.length}_hops`);
          }
        }

        if (header === "via" && headerValue) {
          // Via header indicates proxy usage
          detected = true;
          score += 25;
          indicators.push("via_header_present");
        }

        // Check for Cloudflare headers that might indicate proxy usage
        if (header.startsWith("cf-") && headerValue) {
          score += 10;
          indicators.push(`cloudflare_${header}`);
        }
      }
    }

    // Enhanced proxy detection logic - reduce false positives
    // Cloudflare headers are normal for websites behind Cloudflare CDN
    const cfHeaderCount = indicators.filter((i) =>
      i.includes("cloudflare"),
    ).length;
    const realProxyHeaderCount = headerCount - cfHeaderCount;

    // Only flag as proxy if we have multiple strong indicators
    // Single headers from CDN services are normal
    if (realProxyHeaderCount > 2 || (realProxyHeaderCount > 1 && score > 40)) {
      detected = true;
    }

    // Don't flag if only Cloudflare headers are present (legitimate CDN usage)
    if (cfHeaderCount > 0 && realProxyHeaderCount === 0) {
      detected = false;
      score = 0;
    }

    return { detected, score, indicators };
  }

  checkSuspiciousPorts(request) {
    // Check for suspicious port usage patterns
    const host = request.header("host") || "";
    const suspiciousPorts = ["8080", "3128", "1080", "8888", "9050"];

    for (const port of suspiciousPorts) {
      if (host.includes(`:${port}`)) {
        return { suspicious: true, port };
      }
    }

    return { suspicious: false };
  }

  checkProxyUserAgent(request) {
    const userAgent = request.header("user-agent") || "";
    const acceptLanguage = request.header("accept-language") || "";
    const acceptEncoding = request.header("accept-encoding") || "";

    let detected = false;
    let score = 0;
    const indicators = [];

    // Proxy/VPN client patterns
    const proxyPatterns = [
      /squid/i,
      /proxy/i,
      /curl/i,
      /wget/i,
      /python-requests/i,
      /go-http-client/i,
      /okhttp/i,
      /apache-httpclient/i,
      /java/i,
      /node\.js/i,
      /postman/i,
      /insomnia/i,
    ];

    // VPN client patterns
    const vpnPatterns = [
      /openvpn/i,
      /nordvpn/i,
      /expressvpn/i,
      /surfshark/i,
      /cyberghost/i,
      /tunnelbear/i,
      /protonvpn/i,
      /windscribe/i,
      /privatevpn/i,
      /vpn/i,
    ];

    // Check for proxy patterns
    for (const pattern of proxyPatterns) {
      if (pattern.test(userAgent)) {
        detected = true;
        score += 30;
        indicators.push("proxy_user_agent");
        break;
      }
    }

    // Check for VPN patterns
    for (const pattern of vpnPatterns) {
      if (pattern.test(userAgent)) {
        detected = true;
        score += 40;
        indicators.push("vpn_user_agent");
        break;
      }
    }

    // Check for suspicious header combinations
    if (!userAgent) {
      score += 20;
      indicators.push("missing_user_agent");
    }

    if (!acceptLanguage) {
      score += 10;
      indicators.push("missing_accept_language");
    }

    if (!acceptEncoding) {
      score += 10;
      indicators.push("missing_accept_encoding");
    }

    // Check for automated tool patterns
    if (
      userAgent &&
      (userAgent.length < 20 ||
        !userAgent.includes("Mozilla") ||
        userAgent.includes("bot") ||
        userAgent.includes("crawler"))
    ) {
      score += 15;
      indicators.push("suspicious_user_agent_pattern");
    }

    if (score > 15) {
      detected = true;
    }

    return { detected, score, indicators };
  }

  isKnownBadIP(ip) {
    // Simplified bad IP check
    // In production, you would check against threat intelligence feeds
    const badIPs = [
      // Add known malicious IPs here
    ];

    return badIPs.includes(ip);
  }

  isKnownGoodIP(ip) {
    // Simplified good IP check
    // Known good IP ranges (Google, Cloudflare, etc.)
    const goodRanges = [
      "8.8.8.", // Google DNS
      "1.1.1.", // Cloudflare DNS
      "208.67.222.", // OpenDNS
    ];

    return goodRanges.some((range) => ip.startsWith(range));
  }
}
