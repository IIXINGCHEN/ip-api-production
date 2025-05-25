import { CloudflareProvider } from "../providers/cloudflare.js";
import { MaxMindProvider } from "../providers/maxmind.js";
import { IPInfoProvider } from "../providers/ipinfo.js";
import {
  isValidIP,
  getIPType,
  getIPVersion,
  isPrivateIP,
  isLoopbackIP,
  isMulticastIP,
} from "../utils/ipValidation.js";

export async function getIPInfo(ip, request, options = {}) {
  try {
    // Validate IP address
    if (!isValidIP(ip)) {
      throw new Error("Invalid IP address");
    }

    // Get IP information from multiple providers
    const providers = getProviders();
    const results = await Promise.allSettled(
      providers.map((provider) => provider.getIPInfo(ip, request, options)),
    );

    // Merge results with priority
    const ipInfo = mergeIPResults(results, providers);

    // Add metadata
    ipInfo.ip = ip;
    ipInfo.timestamp = new Date().toISOString();
    ipInfo.sources = results
      .map((result, index) => ({
        provider: providers[index].name,
        success: result.status === "fulfilled",
        priority: providers[index].priority,
      }))
      .filter((source) => source.success);

    return ipInfo;
  } catch (_error) {
    // Enhanced error handling with specific error types
    if (error.message === "Invalid IP address") {
      throw new Error("Invalid IP address format provided");
    }

    // Check if it's a network/provider error
    if (error.code === "ENOTFOUND" || error.code === "ECONNREFUSED") {
      throw new Error("IP information service temporarily unavailable");
    }

    // Generic fallback
    throw new Error("Failed to retrieve IP information");
  }
}

function getProviders() {
  const providers = [
    new CloudflareProvider(),
    new MaxMindProvider(),
    new IPInfoProvider(),
  ];

  // Sort by priority (highest first)
  return providers.sort((a, b) => b.priority - a.priority);
}

function mergeIPResults(results, providers) {
  const merged = {
    ip: null,
    type: null,
    version: null,
    isPrivate: false,
    isLoopback: false,
    isMulticast: false,
    isBroadcast: false,
    sources: [],
  };

  // Process results in priority order
  results.forEach((result, index) => {
    if (result.status === "fulfilled" && result.value) {
      const data = result.value;
      const provider = providers[index];

      // Merge data with priority (higher priority overwrites lower)
      Object.keys(data).forEach((key) => {
        if (data[key] !== null && data[key] !== undefined) {
          if (!merged[key] || provider.priority > (merged._lastPriority || 0)) {
            merged[key] = data[key];
            merged._lastPriority = provider.priority;
          }
        }
      });
    }
  });

  // Clean up internal fields
  delete merged._lastPriority;

  // Determine IP characteristics using unified validation
  if (merged.ip) {
    merged.version = getIPVersion(merged.ip);
    merged.type = getIPType(merged.ip);
    merged.isPrivate = isPrivateIP(merged.ip);
    merged.isLoopback = isLoopbackIP(merged.ip);
    merged.isMulticast = isMulticastIP(merged.ip);
  }

  return merged;
}

// IP validation functions are now imported from utils/ipValidation.js
