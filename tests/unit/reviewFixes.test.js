/**
 * 🔬 2026-06-12 代码审查修复回归测试
 * 钉住 13 项修复中可单元化的核心行为，防止回归。
 * 编号对应 tasks/plan_monitoring_perf_fixes_20260612.md 中的问题表。
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { GeoLookup } from '../../src/services/geoLookup.js';
import { MetricsCollector, HealthChecker, MonitoringService } from '../../src/monitoring/monitoringService.js';
import { ThreatService } from '../../src/services/threatService.js';
import { isWorkersRuntime, isNodeRuntime, hasReliableTimers, getMemoryUsage } from '../../src/utils/runtime.js';
import { createMockRequest } from '../setup.js';

describe('运行时检测 (utils/runtime.js)', () => {
  it('Node 测试进程中应识别为 Node 而非 Workers', () => {
    expect(isWorkersRuntime()).toBe(false);
    expect(isNodeRuntime()).toBe(true);
    expect(hasReliableTimers()).toBe(true);
  });

  it('getMemoryUsage 在 Node 中返回有效堆信息', () => {
    const usage = getMemoryUsage();
    expect(usage).not.toBeNull();
    expect(usage.heapTotal).toBeGreaterThan(0);
  });

  it('getMemoryUsage 在堆信息为零时返回 null（模拟 workerd polyfill）', () => {
    const original = process.memoryUsage;
    process.memoryUsage = () => ({ heapUsed: 0, heapTotal: 0, external: 0, rss: 0 });
    try {
      expect(getMemoryUsage()).toBeNull();
    } finally {
      process.memoryUsage = original;
    }
  });
});

describe('#1 BLOCKER: BatchProcessor 并发批次必须全部结算', () => {
  it('不同 key 的并发批次互不阻塞（旧 processing 标志会让后到批次永久挂起）', async() => {
    const optimizer = new GeoLookup();
    const bp = optimizer.batchProcessor;

    const slow = bp.addRequest('1.1.1.1', async() => {
      await new Promise(resolve => setTimeout(resolve, 80));
      return 'slow';
    });
    const fast = bp.addRequest('2.2.2.2', async() => 'fast');

    const results = await Promise.all([slow, fast]);
    expect(results).toEqual(['slow', 'fast']);
    expect(bp.pendingRequests.size).toBe(0);
    optimizer.destroy();
  }, 5000);

  it('同一 key 的请求合并为一次执行', async() => {
    const optimizer = new GeoLookup();
    let executions = 0;
    const fn = async() => {
      executions++;
      return 'shared';
    };

    const [a, b, c] = await Promise.all([
      optimizer.batchProcessor.addRequest('3.3.3.3', fn),
      optimizer.batchProcessor.addRequest('3.3.3.3', fn),
      optimizer.batchProcessor.addRequest('3.3.3.3', fn)
    ]);

    expect(executions).toBe(1);
    expect([a, b, c]).toEqual(['shared', 'shared', 'shared']);
    optimizer.destroy();
  }, 5000);
});

describe('#5 cleanup() 不得打断在途合并请求', () => {
  it('例行 cleanup 期间在途批处理请求正常完成', async() => {
    const optimizer = new GeoLookup();
    const pending = optimizer.batchProcessor.addRequest('4.4.4.4', async() => {
      await new Promise(resolve => setTimeout(resolve, 60));
      return 'survived';
    });

    optimizer.cleanup(); // 旧实现会 reject('Batch processor cleared')

    await expect(pending).resolves.toBe('survived');
    optimizer.destroy();
  }, 5000);

  it('destroy() 才结算（拒绝）在途请求', async() => {
    const optimizer = new GeoLookup();
    const pending = optimizer.batchProcessor
      .addRequest('5.5.5.5', async() => 'never')
      .catch(error => error.message);

    optimizer.destroy();

    expect(await pending).toBe('Batch processor cleared');
  }, 5000);
});

describe('#6 DataCompressor 不得丢弃字段', () => {
  const { DataCompressor } = GeoLookup;

  it('缓存压缩保留 timezone/continent/postalCode/org/accuracy 等全部字段', () => {
    const data = {
      ip: '8.8.8.8',
      country: ' United States ',
      countryCode: 'US',
      timezone: 'America/Chicago',
      continent: 'North America',
      continentCode: 'NA',
      postalCode: '77002',
      org: 'Google LLC',
      accuracy: 1000,
      latitude: 29.97456789,
      longitude: -95.34678901,
      asn: 15169,
      sources: ['a', 'b', 'c', 'd'],
      threat: { riskScore: 0 }
    };

    const compressed = DataCompressor.compressGeoData(data);

    expect(compressed.timezone).toBe('America/Chicago');
    expect(compressed.continent).toBe('North America');
    expect(compressed.continentCode).toBe('NA');
    expect(compressed.postalCode).toBe('77002');
    expect(compressed.org).toBe('Google LLC');
    expect(compressed.accuracy).toBe(1000);
    expect(compressed.asn).toBe(15169);
    expect(compressed.country).toBe('United States'); // 字符串归一化保留
    expect(compressed.latitude).toBe(29.97456); // 坐标精度截断保留
    expect(compressed.sources).toHaveLength(3); // sources 限长保留
    expect(compressed.threat).toEqual({ riskScore: 0 });
    expect(compressed.threat).not.toBe(data.threat); // 子对象隔离
  });
});

describe('#11 ProviderPool 按 lastUsed 淘汰', () => {
  it('超过 maxAge 未使用的实例会被清理（旧 usageCount===0 条件不可达）', () => {
    class FakeProvider {
      isConfigured() { return true; }
    }

    const optimizer = new GeoLookup();
    const pool = optimizer.providerPool;
    pool.getProvider(FakeProvider);
    // ProviderPool.getProvider 实际用 key = `${name}:${fingerprint}`
    // （FakeProvider 不在 IPInfo/MaxMind/IPApiCom 名单中 → fingerprint = 'default'）
    const poolKey = 'FakeProvider:default';
    expect(pool.providers.has(poolKey)).toBe(true);

    // 模拟 11 分钟未使用，并允许 cleanup 节流窗口通过
    pool.providers.get(poolKey).lastUsed = Date.now() - 660000;
    pool.lastCleanup = Date.now() - 400000;

    pool.cleanup();

    expect(pool.providers.has(poolKey)).toBe(false);
    optimizer.destroy();
  });
});

describe('#12 合并查询：威胁检测单次执行 + 调用方结果隔离', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('并发 includeThreat 查询只跑一次 ThreatService，且各自拿到独立副本', async() => {
    const threatSpy = vi.spyOn(ThreatService.prototype, 'getThreatInfo');

    // 🆕 PR 4 改写：原 `optimizer.getOptimizedProviders = async() => []` 是 monkey-patch
    // 穿透到 instance 私有方法，违反"the interface is the test surface"。现在改用构造期
    // seam `new GeoLookup({ providers: [] })` —— 走真构造器，seam 不破。
    const optimizer = new GeoLookup({ providers: [] });

    const request = createMockRequest('/', {
      headers: { 'user-agent': 'vitest-agent/1.0' }
    });

    const [r1, r2] = await Promise.all([
      optimizer.get('203.0.113.77', request, { includeThreat: true }),
      optimizer.get('203.0.113.77', request, { includeThreat: true })
    ]);

    expect(threatSpy).toHaveBeenCalledTimes(1); // 旧实现每个 caller 各跑一次
    expect(r1.threat).toBeDefined();
    expect(r2.threat).toBeDefined();
    expect(r1).not.toBe(r2);
    expect(r1.threat).not.toBe(r2.threat);

    // 一方修改不得污染另一方
    r1.threat.riskScore = 999;
    expect(r2.threat.riskScore).not.toBe(999);

    optimizer.destroy();
  }, 10000);
});

describe('M1: threat 检测失败时不缓存错误哨兵', () => {
  it('threatDetector throw 时结果返回 threat.error，但不写入缓存（下次重跑）', async() => {
    const throwingDetector = vi.fn().mockRejectedValue(new Error('threat svc down'));
    const optimizer = new GeoLookup({
      providers: [],
      threatDetector: throwingDetector
    });

    const request = createMockRequest('/', { headers: { 'user-agent': 'x' } });

    // 第一次查询：threat 失败 → 结果带 error 哨兵，但不缓存
    const r1 = await optimizer.get('203.0.113.99', request, { includeThreat: true });
    expect(r1.threat).toEqual({ error: 'Threat detection unavailable' });
    // 缓存应为空（threat 失败跳过 cache.set）
    expect(optimizer.cache.cache.size).toBe(0);

    // 第二次查询：因未缓存，threatDetector 应被再次调用（而非命中错误缓存）
    throwingDetector.mockResolvedValue({ riskScore: 10, threats: {} });
    const r2 = await optimizer.get('203.0.113.99', request, { includeThreat: true });
    expect(throwingDetector).toHaveBeenCalledTimes(2); // 两次都跑了 detector
    expect(r2.threat).toEqual({ riskScore: 10, threats: {} }); // 第二次拿到真实结果，非错误哨兵

    optimizer.destroy();
  }, 10000);
});

describe('#3 MetricsCollector 基数保护', () => {
  it('超过 maxSeries 后新 label 组合聚合到无 label 序列', () => {
    const collector = new MetricsCollector();
    collector.maxSeries = 5;

    for (let i = 0; i < 10; i++) {
      collector.incrementCounter('cardinality_test', 1, { id: String(i) });
    }

    // 5 个带 label 序列 + 1 个聚合序列，绝不随 label 取值无界增长
    expect(collector.counters.size).toBe(6);
    expect(collector.counters.get('cardinality_test')).toBe(5);
  });

  it('cleanup 删除过期后变空的序列（释放 key 本身）', () => {
    const collector = new MetricsCollector();
    collector.metrics.set('stale_series', [
      { type: 'counter', name: 'stale_series', value: 1, labels: {}, timestamp: Date.now() - 7200000 }
    ]);

    collector.cleanup();

    expect(collector.metrics.has('stale_series')).toBe(false);
  });
});

describe('#10 HealthChecker 超时定时器清理', () => {
  it('检查完成后无残留 timer', async() => {
    vi.useFakeTimers();
    try {
      const checker = new HealthChecker();
      checker.register('fast_check', async() => ({ healthy: true, message: 'ok' }));

      const result = await checker.check('fast_check');

      expect(result.status).toBe('healthy');
      expect(vi.getTimerCount()).toBe(0); // 旧实现残留 1 个 5s timer
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('#8 内存健康检查在无堆信息运行时不误报', () => {
  it('process.memoryUsage 返回全零时（workerd polyfill）memory 检查为 healthy', async() => {
    const original = process.memoryUsage;
    process.memoryUsage = () => ({ heapUsed: 0, heapTotal: 0, external: 0, rss: 0 });

    try {
      const service = new MonitoringService();
      service.registerDefaultHealthChecks();

      const result = await service.healthChecker.check('memory');

      expect(result.status).toBe('healthy'); // 旧实现 NaN<90 恒 false → critical
      expect(result.message).toContain('not available');
    } finally {
      process.memoryUsage = original;
    }
  });
});

describe('#2 惰性监控维护（Workers 请求驱动）', () => {
  it('未到期返回 null，到期执行完整监控周期', async() => {
    const service = new MonitoringService();
    service.isRunning = true;
    service.lazyMode = true;
    service.maintenanceInterval = 30000;

    service.lastCycleAt = Date.now();
    expect(service.runMaintenanceIfDue()).toBeNull();

    service.lastCycleAt = Date.now() - 60000;
    const cycle = service.runMaintenanceIfDue();
    expect(cycle).toBeInstanceOf(Promise);
    await cycle;

    expect(service.metricsCollector.counters.get('monitoring_cycles')).toBe(1);
    // 周期开始即刷新时间戳，防止并发重复触发
    expect(service.runMaintenanceIfDue()).toBeNull();
  });

  it('非惰性模式（Node interval 模式）下 runMaintenanceIfDue 恒为 null', () => {
    const service = new MonitoringService();
    service.isRunning = true;
    service.lazyMode = false;
    service.lastCycleAt = 0;

    expect(service.runMaintenanceIfDue()).toBeNull();
  });
});
