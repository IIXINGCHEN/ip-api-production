/**
 * 🔧 User-Agent 生成（瘦身版）
 *
 * 仅保留活跃使用的 generateProviderUserAgent / getDefaultUserAgent。
 * 旧版 624 行（UserAgentGenerator 类 + 浏览器/平台探测 + 缓存 + 性能指标）已移除——
 * 服务端 Worker 无需浏览器探测，UA 仅用于外部 provider 请求标识。
 */

const APP_NAME = 'ip-api-production';
const APP_VERSION = '2.0.0';

function baseUserAgent() {
  return `${APP_NAME}/${APP_VERSION}`;
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
