/**
 * 🛡️ 威胁检测白名单配置
 *
 * 设计变更（2026-06-25 审查）：移除基于 IP 前缀（尤其整段 /8）的「合法 ISP/服务/数据中心」
 * 名誉白名单。理由：
 *  1. 过宽且易过期——`'199.'`/`'140.'`/`'52.'` 等把整段 /8 标为合法，而注释声称的所有者
 *     并不拥有该 /8（如 GitHub ≠ 140.0.0.0/8），在威胁检测上制造盲区（落点内的攻击者被跳过）。
 *  2. 「合法 ISP 的 IP」仍可能托管代理/VPN/僵尸网络——按 /8 名誉放行违背「信号驱动」原则。
 * 威胁检测现改为信号驱动（proxy/VPN/Tor/行为/UA/头部）。云/CDN 流量会被如实标记为
 * hosting/datacenter——这是**正确信号**而非误报（blockSuspicious=false，仅风险分）。
 * 仅保留基于域名的白名单（legitimateDomains，可经反向 DNS 验证）。
 *
 * 若将来确需按网段精确放行，应使用权威 CIDR 并运行时拉取（云厂商网段每周更新，
 * 如 AWS 的 ip-ranges.json），而非硬编码 /8。
 */

// IP 前缀名誉白名单已移除——保留空结构以兼容 isWhitelisted 调用签名（恒返回 false）
const EMPTY_IP_RANGES = { ipv4: [], ipv6: [] };

export const THREAT_WHITELIST = {
  // 已移除：按 IP 前缀的「合法」名誉白名单（恒返回 false，兼容旧调用点）
  legitimateISPs: EMPTY_IP_RANGES,
  legitimateServices: EMPTY_IP_RANGES,
  legitimateDatacenters: EMPTY_IP_RANGES,

  // 域名白名单——基于反向 DNS 可验证，保留
  legitimateDomains: [
    // 搜索引擎和爬虫
    'googlebot.com',
    'google.com',
    'bing.com',
    'yahoo.com',
    'baidu.com',
    'sogou.com',
    'yandex.com',

    // 社交媒体
    'facebook.com',
    'instagram.com',
    'twitter.com',
    'linkedin.com',
    'reddit.com',
    'tiktok.com',
    'youtube.com',

    // 云服务
    'amazonaws.com',
    'cloud.google.com',
    'azure.microsoft.com',
    'cloudflare.com',
    'fastly.com',
    'akamai.com',
    'akamaized.net',

    // 通讯服务
    'microsoft.com',
    'outlook.com',
    'gmail.com',
    'icloud.com',
    'protonmail.com',
    'tutanota.com',

    // 电商平台
    'amazon.com',
    'ebay.com',
    'alibaba.com',
    'taobao.com',
    'jd.com',

    // 流媒体
    'netflix.com',
    'spotify.com',
    'apple.com',
    'disney.com',

    // 开发者工具
    'github.com',
    'gitlab.com',
    'bitbucket.org',
    'docker.com',
    'kubernetes.io',
    'npmjs.com',
    'pypi.org',

    // 安全厂商
    'mcafee.com',
    'symantec.com',
    'kaspersky.com',
    'trendmicro.com',
    'sophos.com'
  ]
};

/**
 * 辅助函数：检查 IP 是否在指定白名单类别中。
 * IP 前缀类别已清空 → 恒返回 false（威胁检测改为信号驱动）。
 */
export function isWhitelisted(ip, category = 'legitimateISPs') {
  if (!ip || typeof ip !== 'string') {
    return false;
  }

  const whitelist = THREAT_WHITELIST[category];
  if (!whitelist) {
    return false;
  }

  const isIPv6 = ip.includes(':');
  const ranges = isIPv6 ? whitelist.ipv6 : whitelist.ipv4;

  if (!ranges || ranges.length === 0) {
    return false;
  }

  return ranges.some((range) => {
    if (range.includes('x')) {
      // 处理通配符模式，如 '2600:1fxx:'
      const regexPattern = range.replace(/x/g, '[0-9a-fA-F]');
      return new RegExp(`^${regexPattern}`).test(ip);
    } else {
      return ip.startsWith(range);
    }
  });
}

// 检查是否为合法 ISP（IP 名誉白名单已移除 → 恒 false）
export const isLegitimateISP = (ip) => isWhitelisted(ip, 'legitimateISPs');

// 检查是否为合法服务（同上）
export const isLegitimateService = (ip) => isWhitelisted(ip, 'legitimateServices');

// 检查是否为合法数据中心（同上）
export const isLegitimateDatacenter = (ip) => isWhitelisted(ip, 'legitimateDatacenters');

export default THREAT_WHITELIST;
