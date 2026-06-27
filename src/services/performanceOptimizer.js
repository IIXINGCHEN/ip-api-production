/**
 * ⚡ 性能优化器
 * 提供缓存、连接池、实例管理等性能优化功能
 */

import { hasReliableTimers } from '../utils/runtime.js';
import { CloudflareProvider } from '../providers/cloudflare.js';
import { MaxMindProvider } from '../providers/maxmind.js';
import { IPInfoProvider } from '../providers/ipinfo.js';
import { IPApiComProvider } from '../providers/ipApiCom.js';

// 🔄 Provider实例池 - 避免重复实例化
class ProviderPool {
  constructor() {
    this.providers = new Map();
    this.lastCleanup = Date.now();
    this.cleanupInterval = 300000; // 5分钟清理一次
  }

  /**
   * 获取或创建Provider实例
   */
  getProvider(ProviderClass) {
    const providerName = ProviderClass.name;

    // 清理过期实例
    this.cleanup();

    if (!this.providers.has(providerName)) {
      const provider = new ProviderClass();
      this.providers.set(providerName, {
        instance: provider,
        created: Date.now(),
        lastUsed: Date.now(),
        usageCount: 0
      });
    }

    const providerData = this.providers.get(providerName);
    providerData.usageCount++;
    providerData.lastUsed = Date.now();

    return providerData.instance;
  }

  /**
   * 清理长时间未使用的Provider实例
   */
  cleanup() {
    const now = Date.now();
    if (now - this.lastCleanup < this.cleanupInterval) {
      return;
    }

    this.lastCleanup = now;
    const maxAge = 600000; // 10分钟未使用则清理

    for (const [name, data] of this.providers.entries()) {
      if (now - data.lastUsed > maxAge) {
        this.providers.delete(name);
      }
    }
  }

  /**
   * 获取池统计信息
   */
  getStats() {
    return {
      size: this.providers.size,
      instances: Array.from(this.providers.entries()).map(([name, data]) => ({
        name,
        created: data.created,
        usageCount: data.usageCount
      }))
    };
  }
}

// 📝 结果缓存 - 缓存计算结果避免重复处理
class ResultCache {
  constructor(maxSize = 1000, ttl = 300000) { // 5分钟TTL
    this.cache = new Map();
    this.maxSize = maxSize;
    this.ttl = ttl;
    this.hits = 0;
    this.misses = 0;
  }

  /**
   * 生成缓存键
   */
  generateKey(ip, options = {}) {
    const normalizedOptions = options && typeof options === 'object' ? options : {};
    const sortedOptions = Object.keys(normalizedOptions)
      .sort()
      .map(key => `${key}=${String(normalizedOptions[key])}`)
      .join('|');
    return `${ip}:${sortedOptions}`;
  }

  /**
   * 获取缓存结果
   */
  get(ip, options = {}) {
    const key = this.generateKey(ip, options);
    const cached = this.cache.get(key);

    if (!cached) {
      this.misses++;
      return null;
    }

    // 检查是否过期
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

  /**
   * 设置缓存结果
   */
  set(ip, options = {}, data) {
    const key = this.generateKey(ip, options);

    // LRU淘汰
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

  /**
   * 淘汰最旧的缓存项
   */
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

  /**
   * 获取缓存统计
   */
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

  /**
   * 清空缓存
   */
  clear() {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
  }
}

// 🎯 批处理优化器 - 合并相似请求
class BatchProcessor {
  constructor(maxBatchSize = 10, maxWaitTime = 50) { // 最多50ms等待
    this.pendingRequests = new Map();
    this.maxBatchSize = maxBatchSize;
    this.maxWaitTime = maxWaitTime;
  }

  /**
   * 添加请求到批处理队列
   */
  async addRequest(ip, requestFn, options = {}) {
    const key = this.generateBatchKey(ip, options);

    return new Promise((resolve, reject) => {
      // 如果没有现有的批次，创建新的
      if (!this.pendingRequests.has(key)) {
        let timer = null;
        if (typeof setTimeout !== 'undefined') {
          timer = setTimeout(() => this.processBatch(key), this.maxWaitTime);
        } else {
          // 无定时器环境兜底：微任务内处理，保证批次必然被结算
          Promise.resolve().then(() => this.processBatch(key));
        }

        this.pendingRequests.set(key, {
          requests: [],
          timer
        });
      }

      const batch = this.pendingRequests.get(key);
      batch.requests.push({ resolve, reject, ip, requestFn, options });

      // 如果达到最大批次大小，立即处理
      if (batch.requests.length >= this.maxBatchSize) {
        this.processBatch(key);
      }
    });
  }

  /**
   * 生成批处理键
   */
  generateBatchKey(ip, options) {
    // 相同IP和相似选项的请求可以合并
    const normalizedOptions = options && typeof options === 'object' ? options : {};
    const optionPairs = Object.keys(normalizedOptions)
      .sort()
      .map(key => `${key}=${String(normalizedOptions[key])}`)
      .join('|');
    return `${ip}:${optionPairs}`;
  }

  /**
   * 处理批次
   * 先把批次移出队列再执行：同一批次只会被处理一次，
   * 不同 key 的批次互不阻塞（不存在实例级互斥标志）。
   */
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
      // 执行第一个请求，其他请求共享结果
      const firstRequest = batch.requests[0];
      const result = await firstRequest.requestFn(firstRequest.ip, firstRequest.options);

      // 所有请求都使用相同的结果
      batch.requests.forEach(({ resolve }) => {
        resolve(result);
      });

    } catch (error) {
      // 所有请求都失败
      batch.requests.forEach(({ reject }) => {
        reject(error);
      });
    }
  }

  /**
   * 清理所有待处理请求
   */
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

// 🗜️ 数据压缩器 - 减少内存占用
class DataCompressor {
  /**
   * 压缩地理位置数据
   * 保留全部字段，仅做归一化（字符串去空白、坐标截断精度、sources 限长），
   * 确保缓存命中与新鲜查询返回相同的字段集合。
   */
  static compressGeoData(data) {
    if (!data || typeof data !== 'object') {
      return data;
    }

    const compressed = {};

    for (const [field, value] of Object.entries(data)) {
      if (value === undefined) {
        continue;
      }

      if (typeof value === 'string') {
        compressed[field] = value.trim();
      } else if (typeof value === 'number' && (field === 'latitude' || field === 'longitude')) {
        compressed[field] = Math.trunc(value * 100000) / 100000; // 5位小数精度
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

  /**
   * 解压缩地理位置数据
   */
  static decompressGeoData(data) {
    // 数据已经是解压状态，直接返回
    return data;
  }
}

// 📊 性能监控器
class PerformanceMonitor {
  constructor() {
    this.metrics = new Map();
    this.startTime = Date.now();
  }

  /**
   * 记录性能指标
   */
  record(name, duration, _metadata = {}) {
    if (!this.metrics.has(name)) {
      this.metrics.set(name, {
        count: 0,
        totalTime: 0,
        minTime: Infinity,
        maxTime: 0,
        recentTimes: []
      });
    }

    const metric = this.metrics.get(name);
    metric.count++;
    metric.totalTime += duration;
    metric.minTime = Math.min(metric.minTime, duration);
    metric.maxTime = Math.max(metric.maxTime, duration);

    // 保留最近100次的记录
    metric.recentTimes.push(duration);
    if (metric.recentTimes.length > 100) {
      metric.recentTimes.shift();
    }
  }

  /**
   * 获取性能统计
   */
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

    return {
      uptime: Math.round(uptime / 1000),
      metrics: stats
    };
  }

  /**
   * 清除所有指标
   */
  clear() {
    this.metrics.clear();
    this.startTime = Date.now();
  }
}

// Provider 注册表：声明式，引用已静态导入的类。新增 provider = 加一行 import + 加一行。
// tier:'sync' 走 tryExtractSync（进程内，如 Cloudflare）；tier:'async' 走 fetch（网络）。
// 注：曾用动态 await import('字符串路径') 按需加载，但 workerd 本地 dev 对 '../providers/...'
// 的相对路径解析失败（No such module），生产 esbuild 打包则正常。静态 import 在所有运行时
// 一致，且经核查 providers 不会反向依赖 geoService/performanceOptimizer，无循环依赖风险。
const PROVIDER_REGISTRY = [
  { ProviderClass: CloudflareProvider },
  { ProviderClass: MaxMindProvider },
  { ProviderClass: IPInfoProvider },
  { ProviderClass: IPApiComProvider }
];

// priority >= PRIMARY_THRESHOLD 为 primary（高优先级真实源），< 为 fallback（兜底，仅在 primary 无数据时调用）
const PRIMARY_THRESHOLD = 50;

// 判断合并结果是否含可用地理数据（用于决定是否触发 fallback provider）—— 规范 GeoData 形状
function hasUsableGeo(geo) {
  if (!geo || typeof geo !== 'object') return false;
  const c = geo.country || {};
  const co = geo.location?.coordinates || {};
  return Boolean(
    c.name || c.code || c.city ||
    (typeof co.latitude === 'number' && typeof co.longitude === 'number')
  );
}

/**
 * 按优先级深度填空：高优先级 provider 先占位，低优先级仅在叶子为 null/undefined 时补值。
 * ip/provider 由 merge 统一管理，不参与填空。递归处理 country/location/network/coordinates 嵌套。
 */
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

// 🎯 主性能优化器
export class PerformanceOptimizer {
  constructor() {
    this.providerPool = new ProviderPool();
    this.resultCache = new ResultCache();
    this.batchProcessor = new BatchProcessor();
    this.monitor = new PerformanceMonitor();
    this.enabled = true;
  }

  /**
   * 启用/禁用性能优化
   */
  setEnabled(enabled) {
    this.enabled = enabled;
  }

  /**
   * 优化的地理位置查询（三层：sync 快速路径 → async primary → async fallback）
   * 单一编排+缓存入口。geoService.getGeoInfo 为转发到此处的薄 facade。
   */
  async getOptimizedGeoInfo(ip, request, options = {}) {
    const startTime = Date.now();

    try {
      // 1. 缓存
      const cached = this.resultCache.get(ip, options);
      if (cached) {
        this.monitor.record('geo_cache_hit', Date.now() - startTime);
        return this.cloneResult(DataCompressor.decompressGeoData(cached));
      }

      // 2. 批处理合并相同请求；威胁检测与缓存写入在批内只执行一次
      const result = await this.batchProcessor.addRequest(ip, async(ip, options) => {
        const providers = await this.getOptimizedProviders();
        // cf 在 Hono 上位于 c.req.raw.cf（c.req.cf 不存在）；兼容裸 Request 的 request.cf
        const ctx = {
          cf: request?.cf ?? request?.raw?.cf,
          headers: request?.headers || request?.raw?.headers || new Headers()
        };

        const sync = providers.filter((p) => p.tier === 'sync');
        const primary = providers.filter((p) => p.tier === 'async' && p.priority >= PRIMARY_THRESHOLD);
        const fallback = providers.filter((p) => p.tier === 'async' && p.priority < PRIMARY_THRESHOLD);

        // Tier 0：同步快速路径（Cloudflare）—— 同一 tick，无 Promise/setTimeout 开销
        const syncResults = sync.map((p) => {
          try {
            return { status: 'fulfilled', value: p.tryExtractSync(ip, ctx) };
          } catch (error) {
            return { status: 'rejected', reason: error };
          }
        });

        // Tier 1：异步 primary 并行
        const primaryResults = await Promise.allSettled(
          primary.map((p) => this.withTimeout(() => p.fetch(ip, options), 5000))
        );

        let merged = this.basicMerge([...syncResults, ...primaryResults], [...sync, ...primary], ip);

        // Tier 2：fallback 仅当 primary 无可用地理数据时调用
        // （隐私：不把 IP 明文外发第三方；成本：不耗 ip-api.com 45/min 配额）
        if (!hasUsableGeo(merged) && fallback.length > 0) {
          const fallbackResults = await Promise.allSettled(
            fallback.map((p) => this.withTimeout(() => p.fetch(ip, options), 5000))
          );
          merged = this.basicMerge(
            [...syncResults, ...primaryResults, ...fallbackResults],
            [...sync, ...primary, ...fallback],
            ip
          );
        }

        if (options.includeThreat) {
          try {
            const { ThreatService } = await import('./threatService.js');
            const threatService = new ThreatService();
            merged.threat = await threatService.getThreatInfo(ip, request);
          } catch {
            merged.threat = { error: 'Threat detection unavailable' };
          }
        }

        // 缓存结果（每批一次）
        this.resultCache.set(ip, options, DataCompressor.compressGeoData(merged));

        return merged;
      }, options);

      this.monitor.record('geo_lookup', Date.now() - startTime);

      // 合并请求共享同一结果对象，返回拷贝避免调用方相互污染
      return this.cloneResult(result);

    } catch (error) {
      this.monitor.record('geo_error', Date.now() - startTime);
      throw error;
    }
  }

  /**
   * 浅拷贝结果对象（threat 子对象一并拷贝），
   * 防止合并请求/缓存命中的共享引用被调用方修改。
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
   * 获取优化的Provider列表（声明式注册表驱动）
   */
  async getOptimizedProviders() {
    const instances = [];
    for (const { ProviderClass } of PROVIDER_REGISTRY) {
      // Provider 类已在文件顶部静态导入（动态 import 的相对路径在 workerd 本地 dev 下解析失败）
      const provider = this.providerPool.getProvider(ProviderClass);
      if (provider.isConfigured()) {
        instances.push(provider);
      }
    }
    return instances.sort((a, b) => b.priority - a.priority); // 显式按优先级降序
  }

  /**
   * 异步 provider 执行 + 兜底超时（provider 自带 AbortSignal.timeout 为第一道，此处为第二道）
   */
  withTimeout(fn, ms = 5000) {
    // workerd 中后台定时器不可靠，直接执行
    if (typeof setTimeout === 'undefined') {
      return fn();
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`provider timeout after ${ms}ms`)), ms);
      fn()
        .then((result) => {
          clearTimeout(timer);
          resolve(result);
        })
        .catch((error) => {
          clearTimeout(timer);
          reject(error);
        });
    });
  }

  /**
   * 优先级感知合并（规范 GeoData 嵌套形状）
   * 高优先级先占位，低优先级仅在叶子为空时填空；归因到含可用地理数据的最高优先级来源。
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
      // 归因：最高优先级且含可用地理数据的 provider（避免 ip 字段导致误归因）
      if (!attributor && hasUsableGeo(result.value)) {
        attributor = provider?.name;
      }
    }
    merged.provider = attributor || 'unknown';
    return merged;
  }

  /**
   * 获取性能统计
   */
  getPerformanceStats() {
    return {
      providerPool: this.providerPool.getStats(),
      cache: this.resultCache.getStats(),
      monitor: this.monitor.getStats(),
      enabled: this.enabled
    };
  }

  /**
   * 清理资源
   * 例行维护安全：只清理缓存与监控统计，不打断在途的合并请求。
   */
  cleanup() {
    this.resultCache.clear();
    this.monitor.clear();
  }

  /**
   * 销毁优化器：清理缓存并结算（拒绝）所有在途批处理请求。
   * 仅在进程关闭/实例废弃时调用。
   */
  destroy() {
    this.cleanup();
    this.batchProcessor.clear();
  }
}

PerformanceOptimizer.DataCompressor = DataCompressor;

// 🌍 全局性能优化器实例
export const performanceOptimizer = new PerformanceOptimizer();

// 🔄 内存清理任务
let cleanupInterval = null;

export function startMemoryCleanup() {
  // 仅在真实 Node 进程中运行后台清理；workerd（含 wrangler dev）中
  // 请求上下文外的定时器不可靠，详见 utils/runtime.js
  if (!hasReliableTimers() || process.env.NODE_ENV === 'test') {
    return;
  }
  if (cleanupInterval) return;

  cleanupInterval = setInterval(() => {
    // 强制垃圾回收（如果可用）
    if (globalThis.gc) {
      globalThis.gc();
    }

    // 清理性能优化器
    performanceOptimizer.cleanup();

    // 记录内存使用情况
    if (process.memoryUsage) {
      const usage = process.memoryUsage();
      console.log('Memory usage:', {
        heapUsed: Math.round(usage.heapUsed / 1024 / 1024) + 'MB',
        heapTotal: Math.round(usage.heapTotal / 1024 / 1024) + 'MB',
        external: Math.round(usage.external / 1024 / 1024) + 'MB'
      });
    }
  }, 300000); // 每5分钟清理一次
}

export function stopMemoryCleanup() {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
  }
}
