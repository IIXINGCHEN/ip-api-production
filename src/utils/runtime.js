/**
 * 🧭 运行时环境检测
 *
 * workerd（Cloudflare Workers，含 wrangler dev --local）在 nodejs_compat 下同样提供
 * setTimeout/setInterval 与 process polyfill，因此 `typeof setInterval === 'undefined'`
 * 与 `process.env.NODE_ENV` 判断都无法区分 Workers 与 Node。本模块提供唯一可信的检测入口。
 */

/**
 * 是否运行在 Cloudflare Workers (workerd) 中。
 * WebSocketPair 是 workerd 专有全局；navigator.userAgent 自 compat 2022-03-21 起固定为
 * 'Cloudflare-Workers'。两者任一命中即视为 Workers。
 */
export function isWorkersRuntime() {
  if (typeof WebSocketPair !== 'undefined') {
    return true;
  }
  return typeof navigator !== 'undefined' && navigator.userAgent === 'Cloudflare-Workers';
}

/**
 * 是否运行在真实 Node.js 进程中（排除 workerd 的 nodejs_compat polyfill）。
 */
export function isNodeRuntime() {
  if (isWorkersRuntime()) {
    return false;
  }
  return typeof process !== 'undefined' && Boolean(process.versions && process.versions.node);
}

/**
 * 后台定时器（setInterval 长周期任务）是否可靠。
 * workerd 中请求上下文外的定时器不会执行，请求内排定的定时器随请求结束失效，
 * 因此只有真实 Node 进程返回 true。
 */
export function hasReliableTimers() {
  return isNodeRuntime();
}

/**
 * 安全读取进程内存信息。
 * workerd 的 nodejs_compat polyfill 返回全零（heapTotal=0 会让百分比变成 NaN），
 * 该场景与 API 缺失一样返回 null，调用方据此跳过内存相关判断。
 */
export function getMemoryUsage() {
  if (typeof process === 'undefined' || typeof process.memoryUsage !== 'function') {
    return null;
  }

  try {
    const usage = process.memoryUsage();
    if (!usage || !(usage.heapTotal > 0)) {
      return null;
    }
    return usage;
  } catch {
    return null;
  }
}
