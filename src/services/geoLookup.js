/**
 * 🌍 GeoLookup — 地理位置查询主入口
 *
 * 本模块承载原先 performanceOptimizer 全部职责：
 * - 5 个 internal class: ProviderPool / ResultCache / BatchProcessor / DataCompressor / PerformanceMonitor
 * - Provider 注册表 (PROVIDER_REGISTRY → DEFAULT_PROVIDER_REGISTRY) 与 getOptimizedProviders
 * - 70+ 行 pipeline (cache → batch → sync/async tier → merge → threat → cache write)
 * - Helper: hasUsableGeo / deepFillNulls / basicMerge / withTimeout / cloneResult
 * - 顶层 instance: `geoLookup` (PR 1-3 期间已预留)
 * - startMemoryCleanup / stopMemoryCleanup
 *
 * 设计原则（见 /codebase-design skill）：
 * - 一接口多适配器：providers DI 允许测试用 fake provider 替换
 * - 删除测试通过：每个 internal class 都"删了会集中复杂度到调用方"——它们是 deep
 * - 内部 seam：5 个 internal class 通过 this.* 暴露给 GeoLookup.get()，但不向外暴露
 *
 * 历史：
 * - PR 1: 删 geoService facade
 * - PR 2: 引入 GeoLookup class（接口合约）
 * - PR 3: 接入 PerformanceOptimizer({ providers }) 构造期注入
 * - PR 4（本文件）: Pipeline 完整内化，performanceOptimizer.js 整文件删除
 */

import { hasReliableTimers } from '../utils/runtime.js';
import { CloudflareProvider } from '../providers/cloudflare.js';
import { MaxMindProvider } from '../providers/maxmind.js';
import { IPInfoProvider } from '../providers/ipinfo.js';
import { IPApiComProvider } from '../providers/ipApiCom.js';
import { ThreatService } from './threatService.js';
import { toCtx } from '../utils/requestAdapter.js';
import { config } from '../config/configManager.js';

// ============================================================
// Internal classes
// ============================================================

/**
 * Provider 实例池：避免重复实例化
 */
class ProviderPool {
  constructor() {
    this.providers = new Map();
    this.lastCleanup = Date.now();
    this.cleanupInterval = 300000; // 5分钟清理一次（_ensureConfigured lazy 覆盖）
    this.maxAge = 600000; // 10分钟未使用则清理（_ensureConfigured lazy 覆盖）
  }

  getProvider(ProviderClass, env = {}) {
    const providerName = ProviderClass.name;
    const providerKey = `${providerName}:${this.getProviderConfigFingerprint(ProviderClass, env)}`;
    this.cleanup();
    if (!this.providers.has(providerKey)) {
      const provider = new ProviderClass(env);
      this.providers.set(providerKey, {
        instance: provider,
        displayName: providerName,
        created: Date.now(),
        lastUsed: Date.now(),
        usageCount: 0
      });
    }
    const providerData = this.providers.get(providerKey);
    providerData.usageCount++;
    providerData.lastUsed = Date.now();
    return providerData.instance;
  }

  getProviderConfigFingerprint(ProviderClass, env = {}) {
    const name = ProviderClass.name;
    if (name === 'IPInfoProvider') {
      return env.IPINFO_TOKEN ? 'configured' : 'unconfigured';
    }
    if (name === 'MaxMindProvider') {
      return env.MAXMIND_USER_ID && env.MAXMIND_LICENSE_KEY ? 'configured' : 'unconfigured';
    }
    if (name === 'IPApiComProvider') {
      return String(env.ENABLE_INSECURE_IPAPI_FALLBACK || '').toLowerCase() === 'true' ? 'enabled' : 'disabled';
    }
    return 'default';
  }

  cleanup() {
    const now = Date.now();
    if (now - this.lastCleanup < this.cleanupInterval) {
      return;
    }
    this.lastCleanup = now;
    for (const [name, data] of this.providers.entries()) {
      if (now - data.lastUsed > this.maxAge) {
        this.providers.delete(name);
      }
    }
  }

  getStats() {
    return {
      size: this.providers.size,
      instances: Array.from(this.providers.entries()).map(([name, data]) => ({
        name: data.displayName || name,
        key: name,
        created: data.created,
        usageCount: data.usageCount
      }))
    };
  }
}

/**
 * 结果缓存：5分钟 TTL + LRU 淘汰
 */
class ResultCache {
  constructor(maxSize = 1000, ttl = 300000) {
    this.cache = new Map();
    this.maxSize = maxSize;
    this.ttl = ttl;
    this.hits = 0;
    this.misses = 0;
  }

  generateKey(ip, options = {}) {
    const normalizedOptions = options && typeof options === 'object' ? options : {};
    const cacheRelevantOptions = {
      language: normalizedOptions.language,
      includeThreat: normalizedOptions.includeThreat
    };
    const sortedOptions = Object.keys(cacheRelevantOptions)
      .filter((key) => cacheRelevantOptions[key] !== undefined)
      .sort()
      .map((key) => `${key}=${String(cacheRelevantOptions[key])}`)
      .join('|');
    return `${ip}:${sortedOptions}`;
  }

  get(ip, options = {}) {
    const key = this.generateKey(ip, options);
    const cached = this.cache.get(key);
    if (!cached) {
      this.misses++;
      return null;
    }
    if (Date.now() - cached.timestamp > this.ttl) {
      this.cache.delete(key);
      this.misses++;
      return null;
    }
    this.hits++;
    cached.accessCount++;
    cached.lastAccessed = Date.now();
    return cached.data;
  }

  set(ip, options = {}, data) {
    const key = this.generateKey(ip, options);
    if (this.cache.size >= this.maxSize) {
      this.evictOldest();
    }
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      lastAccessed: Date.now(),
      accessCount: 0
    });
  }

  evictOldest() {
    let oldestKey = null;
    let oldestTime = Infinity;
    for (const [key, value] of this.cache.entries()) {
      if (value.lastAccessed < oldestTime) {
        oldestTime = value.lastAccessed;
        oldestKey = key;
      }
    }
    if (oldestKey) {
      this.cache.delete(oldestKey);
    }
  }

  getStats() {
    const total = this.hits + this.misses;
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      hits: this.hits,
      misses: this.misses,
      hitRate: total > 0 ? Math.round((this.hits / total) * 100) / 100 : 0
    };
  }

  clear() {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
  }
}

/**
 * 批处理优化器：合并相同 IP+options 的并发请求
 */
class BatchProcessor {
  constructor(maxBatchSize = 10, maxWaitTime = 50) {
    this.pendingRequests = new Map();
    this.maxBatchSize = maxBatchSize;
    this.maxWaitTime = maxWaitTime;
  }

  async addRequest(ip, requestFn, options = {}) {
    const key = this.generateBatchKey(ip, options);
    return new Promise((resolve, reject) => {
      if (!this.pendingRequests.has(key)) {
        let timer = null;
        if (typeof setTimeout !== 'undefined') {
          timer = setTimeout(() => this.processBatch(key), this.maxWaitTime);
        } else {
          Promise.resolve().then(() => this.processBatch(key));
        }
        this.pendingRequests.set(key, { requests: [], timer });
      }
      const batch = this.pendingRequests.get(key);
      batch.requests.push({ resolve, reject, ip, requestFn, options });
      if (batch.requests.length >= this.maxBatchSize) {
        this.processBatch(key);
      }
    });
  }

  generateBatchKey(ip, options) {
    const normalizedOptions = options && typeof options === 'object' ? options : {};
    const batchRelevantOptions = {
      language: normalizedOptions.language,
      includeThreat: normalizedOptions.includeThreat
    };
    const optionPairs = Object.keys(batchRelevantOptions)
      .filter((key) => batchRelevantOptions[key] !== undefined)
      .sort()
      .map((key) => `${key}=${String(batchRelevantOptions[key])}`)
      .join('|');
    return `${ip}:${optionPairs}`;
  }

  async processBatch(key) {
    const batch = this.pendingRequests.get(key);
    if (!batch) return;
    this.pendingRequests.delete(key);
    if (batch.timer) {
      clearTimeout(batch.timer);
      batch.timer = null;
    }
    if (batch.requests.length === 0) return;
    try {
      const firstRequest = batch.requests[0];
      const result = await firstRequest.requestFn(firstRequest.ip, firstRequest.options);
      batch.requests.forEach(({ resolve }) => { resolve(result); });
    } catch (error) {
      batch.requests.forEach(({ reject }) => { reject(error); });
    }
  }

  clear() {
    for (const batch of this.pendingRequests.values()) {
      if (batch.timer) {
        clearTimeout(batch.timer);
      }
      batch.requests.forEach(({ reject }) => {
        reject(new Error('Batch processor cleared'));
      });
    }
    this.pendingRequests.clear();
  }
}

/**
 * 数据压缩器：归一化字段（保留全部字段，仅做归一化）
 */
class DataCompressor {
  static compressGeoData(data) {
    if (!data || typeof data !== 'object') {
      return data;
    }
    const compressed = {};
    for (const [field, value] of Object.entries(data)) {
      if (value === undefined) continue;
      if (typeof value === 'string') {
        compressed[field] = value.trim();
      } else if (typeof value === 'number' && (field === 'latitude' || field === 'longitude')) {
        compressed[field] = Math.trunc(value * 100000) / 100000;
      } else if (Array.isArray(value)) {
        compressed[field] = field === 'sources' ? value.slice(0, 3) : value.slice();
      } else if (value !== null && typeof value === 'object') {
        compressed[field] = { ...value };
      } else {
        compressed[field] = value;
      }
    }
    return compressed;
  }

  static decompressGeoData(data) {
    return data;
  }
}

/**
 * 性能监控器
 */
class PerformanceMonitor {
  constructor() {
    this.metrics = new Map();
    this.startTime = Date.now();
  }

  record(name, duration, _metadata = {}) {
    if (!this.metrics.has(name)) {
      this.metrics.set(name, {
        count: 0, totalTime: 0, minTime: Infinity, maxTime: 0, recentTimes: []
      });
    }
    const metric = this.metrics.get(name);
    metric.count++;
    metric.totalTime += duration;
    metric.minTime = Math.min(metric.minTime, duration);
    metric.maxTime = Math.max(metric.maxTime, duration);
    metric.recentTimes.push(duration);
    if (metric.recentTimes.length > 100) metric.recentTimes.shift();
  }

  getStats() {
    const uptime = Date.now() - this.startTime;
    const stats = {};
    for (const [name, metric] of this.metrics.entries()) {
      const avgTime = metric.totalTime / metric.count;
      const recentAvg = metric.recentTimes.length > 0
        ? metric.recentTimes.reduce((a, b) => a + b, 0) / metric.recentTimes.length
        : 0;
      stats[name] = {
        count: metric.count,
        avgTime: Math.round(avgTime * 100) / 100,
        minTime: Math.round(metric.minTime * 100) / 100,
        maxTime: Math.round(metric.maxTime * 100) / 100,
        recentAvg: Math.round(recentAvg * 100) / 100,
        qps: Math.round(metric.count / (uptime / 1000) * 100) / 100
      };
    }
    return { uptime: Math.round(uptime / 1000), metrics: stats };
  }

  clear() {
    this.metrics.clear();
    this.startTime = Date.now();
  }
}

// ============================================================
// Provider 注册表与 helper
// ============================================================

/**
 * 默认 provider 注册表：声明式，引用已静态导入的类。
 * tier:'sync' 走 tryExtractSync（进程内，如 Cloudflare）；tier:'async' 走 fetch（网络）。
 * 注释（沿用 perf-optimizer.js:439-441）：曾用动态 await import('字符串路径') 按需加载，但
 * workerd 本地 dev 对 '../providers/...' 的相对路径解析失败，生产 esbuild 打包则正常。
 * 静态 import 在所有运行时一致。
 */
const DEFAULT_PROVIDER_REGISTRY = [
  { ProviderClass: CloudflareProvider },
  { ProviderClass: MaxMindProvider },
  { ProviderClass: IPInfoProvider },
  { ProviderClass: IPApiComProvider }
];

// primary/fallback 阈值已迁至 GeoLookup.primaryThreshold（config.geo.primaryThreshold，wrangler GEO_PRIMARY_THRESHOLD）

function hasUsableGeo(geo) {
  if (!geo || typeof geo !== 'object') return false;
  const c = geo.country || {};
  const co = geo.location?.coordinates || {};
  return Boolean(
    c.name || c.code || c.city ||
    (typeof co.latitude === 'number' && typeof co.longitude === 'number')
  );
}

function deepFillNulls(target, source) {
  for (const key of Object.keys(source)) {
    if (key === 'ip' || key === 'provider') continue;
    const sv = source[key];
    if (sv === null || sv === undefined) continue;
    if (typeof sv === 'object' && !Array.isArray(sv)) {
      if (typeof target[key] !== 'object' || target[key] === null) {
        target[key] = {};
      }
      deepFillNulls(target[key], sv);
    } else if (target[key] === undefined || target[key] === null) {
      target[key] = sv;
    }
  }
}

// ============================================================
// 默认工厂（与 PR 2 接口兼容）
// ============================================================

/**
 * 默认 provider 集合：返回模块级注册表引用本身。
 * 注意契约（m2）：GeoLookup.getOptimizedProviders 用 `this.providers !== DEFAULT_PROVIDER_REGISTRY`
 * 引用相等判定"是否注入路径"。传 `[...getDefaultProviders()]`（拷贝）会被视为注入（不走池化）。
 * 测试/调用方若想保持默认池化行为，构造器不要传 providers，或传 getDefaultProviders() 本身。
 */
export function getDefaultProviders() {
  return DEFAULT_PROVIDER_REGISTRY;
}

/** 默认 threat detector：与原 perf-optimizer.js:562-564 一致，`new ThreatService()` 而非
 *  `getInstance()` —— 后者返回 ThreatServiceSingleton 实例（无 getThreatInfo 方法），
 *  前者继承 prototype 上的 getThreatInfo，测试 spy (`vi.spyOn(ThreatService.prototype, ...)`)
 *  才能拦截。生产行为等价（同一 prototype 方法）。 */
export function getDefaultThreatDetector() {
  return async(ip, request) => {
    return new ThreatService().getThreatInfo(ip, request);
  };
}

// ============================================================
// GeoLookup class
// ============================================================

/**
 * GeoLookup — IP 地理位置查询主入口。
 *
 * 构造器接受所有可注入依赖；get() 实现完整 pipeline（cache → batch → sync/async
 * tier → merge → threat → cache write），消费 this.* 所有字段。
 *
 * @param {object} [deps]
 * @param {Array}  [deps.providers]            注入的 provider 集合（默认 DEFAULT_PROVIDER_REGISTRY）
 * @param {object} [deps.cache]                注入的结果缓存（默认 new ResultCache()）
 * @param {object} [deps.batchProcessor]       注入的批处理器（默认 new BatchProcessor()）
 * @param {Function} [deps.threatDetector]     (ip, request) => Promise<{...}> 威胁检测
 * @param {object} [deps.monitor]              性能监控（默认 new PerformanceMonitor()）
 * @param {boolean} [deps.isTest]              抑制 startMemoryCleanup 等副作用
 */
export class GeoLookup {
  constructor(deps = {}) {
    // 默认 providers = DEFAULT_PROVIDER_REGISTRY 引用（非拷贝），
    // 这样 getOptimizedProviders 可通过引用相等判定"是否注入路径"
    this.providers = deps.providers ?? DEFAULT_PROVIDER_REGISTRY;
    this.providerPool = new ProviderPool();
    this.cache = deps.cache ?? new ResultCache();
    // 内部参数默认值（_ensureConfigured 首次 get 时从 config 覆盖；镜像 configManager.geo schema default）
    this.primaryThreshold = 50;
    this.providerTimeoutMs = 5000;
    this._configured = false;
    this.batchProcessor = deps.batchProcessor ?? new BatchProcessor();
    this.monitor = deps.monitor ?? new PerformanceMonitor();
    this.threatDetector = deps.threatDetector ?? getDefaultThreatDetector();
    this.isTest = Boolean(deps.isTest);
    this.enabled = true;
  }

  setEnabled(enabled) {
    this.enabled = enabled;
  }

  /**
   * 获取优化的 Provider 列表（声明式注册表驱动）。
   * 注入路径（this.providers !== DEFAULT_PROVIDER_REGISTRY）：直接 new ProviderClass(env)，不走 ProviderPool 池化。
   * 池化路径：复用 ProviderPool 缓存，避免重复实例化。
   */
  async getOptimizedProviders(env = {}) {
    const isInjected = this.providers !== DEFAULT_PROVIDER_REGISTRY;
    const instances = [];
    for (const { ProviderClass } of this.providers) {
      const provider = isInjected
        ? new ProviderClass(env)
        : this.providerPool.getProvider(ProviderClass, env);
      if (provider.isConfigured()) {
        instances.push(provider);
      }
    }
    return instances.sort((a, b) => b.priority - a.priority);
  }

  /**
   * 异步 provider 执行 + 兜底超时（provider 自带 AbortSignal.timeout 为第一道）
   */
  withTimeout(fn, ms = 5000, signal = null) {
    if (signal?.aborted) {
      return Promise.reject(new Error('Request aborted'));
    }
    if (typeof setTimeout === 'undefined') {
      return fn();
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`provider timeout after ${ms}ms`)), ms);
      const onAbort = () => {
        clearTimeout(timer);
        reject(new Error('Request aborted'));
      };
      signal?.addEventListener?.('abort', onAbort, { once: true });
      fn()
        .then(resolve)
        .catch(reject)
        .finally(() => {
          clearTimeout(timer);
          signal?.removeEventListener?.('abort', onAbort);
        });
    });
  }

  /**
   * 优先级感知合并：归因到含可用地理数据的最高优先级来源
   */
  basicMerge(results, providers, ip, _options) {
    const indexed = results
      .map((result, i) => ({ result, provider: providers[i] }))
      .filter((x) => x.result.status === 'fulfilled' && x.result.value)
      .sort((a, b) => (b.provider?.priority || 0) - (a.provider?.priority || 0));

    const merged = {
      ip,
      timestamp: new Date().toISOString(),
      country: {},
      location: { coordinates: {} },
      network: {}
    };

    let attributor = null;
    for (const { result, provider } of indexed) {
      deepFillNulls(merged, result.value);
      if (!attributor && hasUsableGeo(result.value)) {
        attributor = provider?.name;
      }
    }
    merged.provider = attributor || 'unknown';
    return merged;
  }

  /**
   * 浅拷贝结果对象（threat 子对象一并拷贝），防止合并请求/缓存命中的共享引用被调用方修改
   */
  cloneResult(result) {
    if (!result || typeof result !== 'object') {
      return result;
    }
    const copy = { ...result };
    if (copy.threat && typeof copy.threat === 'object') {
      copy.threat = { ...copy.threat };
    }
    return copy;
  }

  /**
   * 首次请求时从 config 重新配置内部 class 参数（lazy reconfigure）。
   * 模块级 `export const geoLookup = new GeoLookup()` 时 configManager 未 init，
   * 故构造用默认值，首个请求（configManager 已 init）时覆盖。
   */
  _ensureConfigured() {
    if (this._configured) return;
    try {
      this.cache.ttl = config.get('geo.resultTtlMs', this.cache.ttl);
      this.cache.maxSize = config.get('geo.resultMaxSize', this.cache.maxSize);
      this.batchProcessor.maxBatchSize = config.get('geo.batchMaxSize', this.batchProcessor.maxBatchSize);
      this.batchProcessor.maxWaitTime = config.get('geo.batchWaitMs', this.batchProcessor.maxWaitTime);
      this.providerTimeoutMs = config.get('geo.providerTimeoutMs', this.providerTimeoutMs);
      this.primaryThreshold = config.get('geo.primaryThreshold', this.primaryThreshold);
      this.providerPool.cleanupInterval = config.get('geo.poolCleanupIntervalMs', this.providerPool.cleanupInterval);
      this.providerPool.maxAge = config.get('geo.poolMaxAgeMs', this.providerPool.maxAge);
    } catch { /* configManager 未 init，保留构造默认 */ }
    this._configured = true;
  }

  /**
   * 优化的地理位置查询（三层：sync 快速路径 → async primary → async fallback）
   */
  async get(ip, request, options = {}) {
    this._ensureConfigured();
    const startTime = Date.now();

    try {
      // 1. 缓存
      const cached = this.cache.get(ip, options);
      if (cached) {
        this.monitor.record('geo_cache_hit', Date.now() - startTime);
        return this.cloneResult(DataCompressor.decompressGeoData(cached));
      }

      // 2. 批处理合并相同请求；威胁检测与缓存写入在批内只执行一次
      const result = await this.batchProcessor.addRequest(ip, async(ip, options) => {
        const providers = await this.getOptimizedProviders(options.env || {});
        // cf 在 Hono 上位于 c.req.raw.cf（c.req.cf 不存在）；兼容裸 Request 的 request.cf
        const ctx = toCtx(request);

        const sync = providers.filter((p) => p.tier === 'sync');
        const primary = providers.filter((p) => p.tier === 'async' && p.priority >= this.primaryThreshold);
        const fallback = providers.filter((p) => p.tier === 'async' && p.priority < this.primaryThreshold);

        // Tier 0：同步快速路径（Cloudflare）
        const syncResults = sync.map((p) => {
          try {
            return { status: 'fulfilled', value: p.tryExtractSync(ip, ctx) };
          } catch (error) {
            return { status: 'rejected', reason: error };
          }
        });

        // Tier 1：异步 primary 并行
        const primaryResults = await Promise.allSettled(
          primary.map((p) => this.withTimeout(() => p.fetch(ip, options), this.providerTimeoutMs, options.signal))
        );

        let merged = this.basicMerge([...syncResults, ...primaryResults], [...sync, ...primary], ip);

        // Tier 2：fallback 仅当 primary 无可用地理数据时调用
        if (!hasUsableGeo(merged) && fallback.length > 0) {
          const fallbackResults = await Promise.allSettled(
            fallback.map((p) => this.withTimeout(() => p.fetch(ip, options), this.providerTimeoutMs, options.signal))
          );
          merged = this.basicMerge(
            [...syncResults, ...primaryResults, ...fallbackResults],
            [...sync, ...primary, ...fallback],
            ip
          );
        }

        if (options.includeThreat) {
          try {
            merged.threat = await this.threatDetector(ip, request);
          } catch {
            merged.threat = { error: 'Threat detection unavailable' };
          }
        }

        // 缓存结果（每批一次）。
        // M1 修复：threat 检测失败时（merged.threat.error）不缓存——否则错误哨兵
        // 会在两层缓存驻留 5 分钟，把瞬时的 threat 服务故障呈现为误导的 all-clear。
        // 代价：threat 检测持续失败期间该 IP 每次查询都重跑 pipeline；可接受（失败应短暂）。
        if (!merged.threat?.error) {
          this.cache.set(ip, options, DataCompressor.compressGeoData(merged));
        }

        return merged;
      }, options);

      this.monitor.record('geo_lookup', Date.now() - startTime);
      return this.cloneResult(result);

    } catch (error) {
      this.monitor.record('geo_error', Date.now() - startTime);
      throw error;
    }
  }

  /**
   * 获取性能统计
   */
  getStats() {
    return {
      providerPool: this.providerPool.getStats(),
      cache: this.cache.getStats(),
      monitor: this.monitor.getStats(),
      enabled: this.enabled
    };
  }

  /**
   * 清理资源：只清理缓存与监控统计，不打断在途的合并请求
   */
  cleanup() {
    this.cache.clear();
    this.monitor.clear();
  }

  /**
   * 销毁优化器：清理缓存并结算（拒绝）所有在途批处理请求
   */
  destroy() {
    this.cleanup();
    this.batchProcessor.clear();
  }
}

// 兼容老路径：geoLookup.DataCompressor (perf-optimizer.js:713 旧导出)
GeoLookup.DataCompressor = DataCompressor;

// 🌍 全局实例
export const geoLookup = new GeoLookup();

// ============================================================
// Memory cleanup（沿用 perf-optimizer.js 顶层 startMemoryCleanup）
// ============================================================

let cleanupInterval = null;

export function startMemoryCleanup() {
  // 仅在真实 Node 进程中运行后台清理；workerd 中请求外定时器不可靠
  if (!hasReliableTimers() || process.env.NODE_ENV === 'test') {
    return;
  }
  if (cleanupInterval) return;

  cleanupInterval = setInterval(() => {
    if (globalThis.gc) {
      globalThis.gc();
    }
    geoLookup.cleanup();
    if (process.memoryUsage) {
      const usage = process.memoryUsage();
      console.log('Memory usage:', {
        heapUsed: Math.round(usage.heapUsed / 1024 / 1024) + 'MB',
        heapTotal: Math.round(usage.heapTotal / 1024 / 1024) + 'MB',
        external: Math.round(usage.external / 1024 / 1024) + 'MB'
      });
    }
  }, 300000);
}

export function stopMemoryCleanup() {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
  }
}
