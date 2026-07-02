/**
 * 🔧 User-Agent 生成（瘦身版）
 *
 * 仅保留活跃使用的 generateProviderUserAgent / getDefaultUserAgent。
 * 旧版 624 行（UserAgentGenerator 类 + 浏览器/平台探测 + 缓存 + 性能指标）已移除——
 * 服务端 Worker 无需浏览器探测，UA 仅用于外部 provider 请求标识。
 *
 * app.name / app.version 从 configManager 读（wrangler.toml [vars] APP_NAME/APP_VERSION 注入），
 * 不再硬编码。请求级调用（provider fetch），configManager 已 initialize。
 */

import { config } from '../config/configManager.js';

function baseUserAgent() {
  // config.get 在 configManager 未 initialize 时抛错（某些单元测试不走 init）；
  // 防御性 fallback，值镜像 configManager.app schema default。
  try {
    return `${config.get('app.name')}/${config.get('app.version')}`;
  } catch {
    return 'ip-api-production/2.0.0';
  }
}

/**
 * 默认 User-Agent（同步）
 */
export function getDefaultUserAgent() {
  return baseUserAgent();
}

/**
 * 为指定 provider 生成 User-Agent（异步，保持原签名兼容）
 */
export async function generateProviderUserAgent(providerName) {
  if (typeof providerName !== 'string' || providerName.length === 0) {
    throw new Error('Provider name must be a non-empty string');
  }
  return `${baseUserAgent()} ${providerName}-Client`;
}

export default { getDefaultUserAgent, generateProviderUserAgent };
