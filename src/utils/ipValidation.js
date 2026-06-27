/**
 * Unified IP validation utilities
 * Centralizes all IP-related validation logic to eliminate code duplication
 */

export function isValidIP(ip) {
  if (!ip || typeof ip !== 'string') {
    return false;
  }

  // IPv4正则表达式 - 更全面的验证
  const ipv4Regex =
    /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;

  return ipv4Regex.test(ip) || isValidIPv6(ip);
}

function isValidIPv6(ip) {
  if (!ip || !ip.includes(':')) {
    return false;
  }

  // 禁止 IPv4 映射形式带端口/区域 ID 的歧义输入
  if (ip.includes('%') || ip.includes('/') || ip.includes(' ')) {
    return false;
  }

  // 拆分冒号分隔的 8 段（'::' 压缩必须存在）
  const doubleColonIndex = ip.indexOf('::');
  if (doubleColonIndex !== -1 && ip.indexOf('::', doubleColonIndex + 1) !== -1) {
    return false; // 多个 '::' 非法
  }

  let parts;
  if (doubleColonIndex !== -1) {
    const head = ip.slice(0, doubleColonIndex).split(':').filter(Boolean);
    const tail = ip.slice(doubleColonIndex + 2).split(':').filter(Boolean);
    if (head.length + tail.length >= 8) {
      return false; // '::' 至少要代表一个 0 段
    }
    parts = [...head, ...new Array(8 - head.length - tail.length).fill('0'), ...tail];
  } else {
    parts = ip.split(':');
    if (parts.length !== 8) {
      return false;
    }
  }

  return parts.every((segment) => /^[0-9a-fA-F]{1,4}$/.test(segment));
}

export function getIPType(ip) {
  if (isPrivateIP(ip)) {
    return 'private';
  }
  if (isLoopbackIP(ip)) {
    return 'loopback';
  }
  if (isMulticastIP(ip)) {
    return 'multicast';
  }
  if (isLinkLocalIP(ip)) {
    return 'link-local';
  }
  if (isBroadcastIP(ip)) {
    return 'broadcast';
  }
  return 'public';
}

export function getIPVersion(ip) {
  if (!ip || typeof ip !== 'string') {
    return null;
  }
  return ip.includes(':') ? 6 : 4;
}

export function isPrivateIP(ip) {
  if (!ip) {
    return false;
  }

  // IPv4私有地址范围 (RFC 1918)
  if (ip.includes('.')) {
    return (
      ip.startsWith('10.') ||
      ip.startsWith('192.168.') ||
      (ip.startsWith('172.') &&
        parseInt(ip.split('.')[1]) >= 16 &&
        parseInt(ip.split('.')[1]) <= 31) ||
      // 其他私有地址范围
      ip.startsWith('169.254.') || // 链路本地地址
      ip.startsWith('127.') // 回环地址（技术上不是私有但是内部地址）
    );
  }

  // IPv6私有地址范围 (RFC 4193, RFC 3927)
  if (ip.includes(':')) {
    const lowerIP = ip.toLowerCase();
    return (
      lowerIP.startsWith('fc') ||
      lowerIP.startsWith('fd') ||
      lowerIP.startsWith('fe80') || // 链路本地地址
      lowerIP.startsWith('::1') || // 回环地址
      lowerIP === '::' // 未指定地址
    );
  }

  return false;
}

export function isLoopbackIP(ip) {
  if (!ip) {
    return false;
  }

  // IPv4回环地址
  if (ip.includes('.')) {
    return ip === '127.0.0.1' || ip.startsWith('127.');
  }

  // IPv6回环地址
  if (ip.includes(':')) {
    return ip === '::1';
  }

  return false;
}

export function isMulticastIP(ip) {
  if (!ip) {
    return false;
  }

  // IPv4组播地址 (224.0.0.0 到 239.255.255.255)
  if (ip.includes('.')) {
    const firstOctet = parseInt(ip.split('.')[0]);
    return firstOctet >= 224 && firstOctet <= 239;
  }

  // IPv6组播地址 (ff00::/8)
  if (ip.includes(':')) {
    return ip.toLowerCase().startsWith('ff');
  }

  return false;
}

export function isLinkLocalIP(ip) {
  if (!ip) {
    return false;
  }

  // IPv4链路本地地址 (169.254.0.0/16)
  if (ip.includes('.')) {
    return ip.startsWith('169.254.');
  }

  // IPv6链路本地地址 (fe80::/10)
  if (ip.includes(':')) {
    return ip.toLowerCase().startsWith('fe80');
  }

  return false;
}

export function isBroadcastIP(ip) {
  if (!ip) {
    return false;
  }

  // IPv4广播地址
  if (ip.includes('.')) {
    return (
      ip === '255.255.255.255' || // 受限广播
      ip.endsWith('.255') // 网络广播（简化检查）
    );
  }

  // IPv6没有广播（使用组播代替）
  return false;
}

// isPublicIP / normalizeIP / getIPAddressInfo 已移除：0 外部引用；
// IP 校验/分类用 isValidIP / getIPType / getIPVersion / isPrivateIP 等单一职责函数。
