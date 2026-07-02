/**
 * 🔌 RequestAdapter — 隐藏 Hono / Workerd Request shape 差异
 *
 * HTML 报告 rerun #2 candidate 5: Hono 与 workerd 的 Request shape 差异（cf /
 * headers 位置）泄漏到 orchestrator 内部。orchestrator 不应该知道 c.req.raw
 * 存在与否；它只该拿到统一的 { cf, headers } 上下文。
 *
 * 适配规则：
 * - Hono 路径：调用方传 `c.req`（workerd Request），有 `.cf` / `.headers`
 * - 裸 Request 路径：调用方传 `new Request(...)`，同上 shape
 * - Mock 路径（测试）：`createMockRequest` 返回 bare Request，无 `.cf`、`.raw` 是 undefined
 *   → 现状 `request?.cf ?? request?.raw?.cf` 第二次取 `.raw.cf` 也 undefined，整体 fallthrough
 *
 * 此模块对外的接口只承诺 { cf, headers } 形状；任何上游 shape 变化只在此处处理。
 */

/**
 * 从 Hono c / 裸 Request 提取 orchestrator 需要的上下文。
 *
 * @param {object|undefined} request  Hono Context / 裸 Request / undefined
 * @returns {{ cf: object|undefined, headers: Headers }}
 */
export function toCtx(request) {
  // Hono 在 c 上是 c.req，workerd Request 是 c.req.raw；裸 Request 是 request 自身。
  // 旧实现用 `request?.cf ?? request?.raw?.cf` 兼容两种；这里保留相同语义。
  const cf = request?.cf ?? request?.raw?.cf;
  const headers = request?.headers || request?.raw?.headers || new Headers();
  return { cf, headers };
}
