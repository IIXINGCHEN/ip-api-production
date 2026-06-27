/**
 * 🌍 地理位置 API 服务入口（薄 facade）
 *
 * 真正的编排（provider 选择 + 优先级合并 + 兜底）与缓存（resultCache / batchProcessor）
 * 统一在 performanceOptimizer.getOptimizedGeoInfo 中实现——单一数据路径，单一合并逻辑。
 *
 * 历史的 getGeoInfoOriginal / ProviderManager / mergeGeoResults / 各种 sanitize·validate·
 * dataQuality 辅助（~300 行）已移除：它们属于一条在 optimizer.enabled 恒真时永不执行的死路径，
 * 且与 optimizer.basicMerge 形成双轨合并。详见 .agents/code-reviews/arch-deep-2026-06-14.md。
 *
 * 公共 API（getGeoInfo）签名不变，路由与测试无需改动。
 */

import { performanceOptimizer } from './performanceOptimizer.js';

/**
 * 获取 IP 地理位置信息（转发到带缓存/批处理/优先级合并的优化器）
 * @param {string} ip - 目标 IP
 * @param {object} request - Hono 请求对象（provider 读取 cf/headers）
 * @param {object} [options] - { language, includeThreat }
 */
export async function getGeoInfo(ip, request, options = {}) {
  return performanceOptimizer.getOptimizedGeoInfo(ip, request, options);
}

export default { getGeoInfo };
