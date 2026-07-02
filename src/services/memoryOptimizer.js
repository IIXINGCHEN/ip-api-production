/**
 * 🧠 内存优化器
 * 提供内存监控、清理和优化功能
 */

import { geoLookup } from './geoLookup.js';
import { hasReliableTimers } from '../utils/runtime.js';
import { config } from '../config/configManager.js';

class MemoryOptimizer {
  constructor() {
    this.metrics = {
      initial: this.getCurrentMemoryUsage(),
      peaks: [],
      collections: [],
      optimizations: []
    };
    // 监控阈值外部化 → config.memory.*（configManager 未 init 时 schema default 兜底）
    try {
      this.config = {
        maxHeapSize: config.get('memory.maxHeapBytes', 100 * 1024 * 1024),
        cleanupThreshold: config.get('memory.cleanupThresholdPercent', 80),
        monitorInterval: config.get('memory.monitorIntervalMs', 30000),
        statsRetention: config.get('memory.statsRetention', 100)
      };
    } catch {
      this.config = {
        maxHeapSize: 100 * 1024 * 1024,
        cleanupThreshold: 80,
        monitorInterval: 30000,
        statsRetention: 100
      };
    }
    this.monitoring = false;
    this.monitorTimer = null;
  }

  /**
   * 获取当前内存使用情况
   */
  getCurrentMemoryUsage() {
    if (typeof process !== 'undefined' && process.memoryUsage) {
      const usage = process.memoryUsage();
      return {
        heapUsed: usage.heapUsed,
        heapTotal: usage.heapTotal,
        external: usage.external,
        rss: usage.rss,
        timestamp: Date.now()
      };
    }

    // 浏览器环境的估算
    if (typeof performance !== 'undefined' && performance.memory) {
      const memory = performance.memory;
      return {
        heapUsed: memory.usedJSHeapSize,
        heapTotal: memory.totalJSHeapSize,
        external: 0,
        rss: 0,
        timestamp: Date.now()
      };
    }

    return null;
  }

  /**
   * 开始内存监控
   */
  startMonitoring() {
    if (this.monitoring) return;

    // workerd 中请求上下文外的定时器不可靠，保持 passive 模式
    if (!hasReliableTimers()) {
      console.log('🧠 Memory monitoring unavailable in this runtime (passive mode)');
      return;
    }

    this.monitoring = true;
    this.monitorTimer = setInterval(() => {
      this.checkMemoryUsage();
    }, this.config.monitorInterval);

    console.log('🧠 Memory monitoring started');
  }

  /**
   * 停止内存监控
   */
  stopMonitoring() {
    if (!this.monitoring) return;

    this.monitoring = false;
    if (this.monitorTimer) {
      clearInterval(this.monitorTimer);
      this.monitorTimer = null;
    }

    console.log('🧠 Memory monitoring stopped');
  }

  /**
   * 检查内存使用情况
   */
  checkMemoryUsage() {
    const current = this.getCurrentMemoryUsage();
    if (!current) return;

    const usagePercent = (current.heapUsed / current.heapTotal) * 100;

    // 记录峰值
    this.metrics.peaks.push({
      ...current,
      usagePercent
    });

    // 保留最近的统计
    if (this.metrics.peaks.length > this.config.statsRetention) {
      this.metrics.peaks.shift();
    }

    // 检查是否需要清理
    if (usagePercent > this.config.cleanupThreshold) {
      this.performCleanup();
    }

    // 记录高内存使用警告
    if (usagePercent > 90) {
      console.warn('⚠️ High memory usage detected:', {
        heapUsed: Math.round(current.heapUsed / 1024 / 1024) + 'MB',
        heapTotal: Math.round(current.heapTotal / 1024 / 1024) + 'MB',
        usagePercent: Math.round(usagePercent) + '%'
      });
    }
  }

  /**
   * 执行内存清理
   */
  performCleanup() {
    const before = this.getCurrentMemoryUsage();
    const startTime = Date.now();

    // 1. 手动触发垃圾回收（如果可用）
    if (typeof global !== 'undefined' && global.gc) {
      global.gc();
    }

    // 2. 清理缓存（这里可以扩展为实际的缓存清理）
    this.clearCaches();

    const after = this.getCurrentMemoryUsage();
    const duration = Date.now() - startTime;

    const freed = before && after ? before.heapUsed - after.heapUsed : 0;

    this.metrics.collections.push({
      timestamp: Date.now(),
      before: before,
      after: after,
      freed: freed,
      duration: duration
    });

    console.log('🧹 Memory cleanup completed:', {
      freed: Math.round(freed / 1024 / 1024) + 'MB',
      duration: duration + 'ms'
    });
  }

  /**
   * 清理缓存（占位符方法）
   */
  clearCaches() {
    // 这里可以集成实际的缓存清理逻辑
    // 例如：清理geoCache、rateLimitCache等
    try {
      // 清理 GeoLookup 缓存
      geoLookup.cleanup();
    } catch (error) {
      console.warn('Cache cleanup failed:', error.message);
    }
  }

  /**
   * 获取内存统计信息
   */
  getMemoryStats() {
    const current = this.getCurrentMemoryUsage();

    return {
      current: current ? {
        heapUsed: Math.round(current.heapUsed / 1024 / 1024) + 'MB',
        heapTotal: Math.round(current.heapTotal / 1024 / 1024) + 'MB',
        usagePercent: current ? Math.round((current.heapUsed / current.heapTotal) * 100) + '%' : 'N/A'
      } : null,
      peaks: this.metrics.peaks.slice(-10).map(peak => ({
        heapUsed: Math.round(peak.heapUsed / 1024 / 1024) + 'MB',
        usagePercent: Math.round(peak.usagePercent) + '%',
        timestamp: new Date(peak.timestamp).toISOString()
      })),
      collections: this.metrics.collections.slice(-5).map(collection => ({
        freed: Math.round(collection.freed / 1024 / 1024) + 'MB',
        duration: collection.duration + 'ms',
        timestamp: new Date(collection.timestamp).toISOString()
      })),
      totalCollections: this.metrics.collections.length,
      monitoring: this.monitoring
    };
  }

  /**
   * 优化内存使用：触发 GC + 缓存清理，记录一次优化事件。
   * （曾调用 optimizeObjectPools/StringCaches/ArrayUsage 三个 stub，已删——它们返回空数组、0 行为。）
   */
  optimizeMemoryUsage() {
    this.performCleanup();

    this.metrics.optimizations.push({
      timestamp: Date.now(),
      optimizations: []
    });

    return [];
  }

  /**
   * 检测内存泄漏
   */
  detectMemoryLeaks() {
    const current = this.getCurrentMemoryUsage();
    if (!current) return null;

    // 比较当前内存使用与基线
    const baseline = this.metrics.initial;
    if (!baseline) return null;

    const memoryGrowth = current.heapUsed - baseline.heapUsed;
    const growthPercent = (memoryGrowth / baseline.heapUsed) * 100;

    const leakIndicators = [];

    // 检查内存增长趋势
    if (this.metrics.peaks.length >= 5) {
      const recentPeaks = this.metrics.peaks.slice(-5);
      const trend = this.calculateMemoryTrend(recentPeaks);

      if (trend > 0.1) { // 10%增长趋势
        leakIndicators.push({
          type: 'growth_trend',
          value: Math.round(trend * 100) + '%',
          severity: trend > 0.5 ? 'high' : 'medium'
        });
      }
    }

    // 检查内存使用百分比
    if (growthPercent > 100) { // 内存增长超过100%
      leakIndicators.push({
        type: 'excessive_growth',
        value: Math.round(growthPercent) + '%',
        severity: 'high'
      });
    }

    // 检查垃圾回收效果
    if (this.metrics.collections.length > 0) {
      const recentCollections = this.metrics.collections.slice(-3);
      const avgFreed = recentCollections.reduce((sum, c) => sum + c.freed, 0) / recentCollections.length;

      if (avgFreed < 1024 * 1024) { // 平均清理少于1MB
        leakIndicators.push({
          type: 'ineffective_gc',
          value: Math.round(avgFreed / 1024) + 'KB',
          severity: 'medium'
        });
      }
    }

    return {
      detected: leakIndicators.length > 0,
      indicators: leakIndicators,
      currentUsage: {
        heapUsed: Math.round(current.heapUsed / 1024 / 1024) + 'MB',
        heapTotal: Math.round(current.heapTotal / 1024 / 1024) + 'MB',
        growth: Math.round(memoryGrowth / 1024 / 1024) + 'MB'
      }
    };
  }

  /**
   * 计算内存使用趋势
   */
  calculateMemoryTrend(peaks) {
    if (!peaks || peaks.length < 2) return 0;

    const firstPeak = peaks[0].heapUsed;
    const lastPeak = peaks[peaks.length - 1].heapUsed;
    const timeSpan = peaks[peaks.length - 1].timestamp - peaks[0].timestamp;

    if (timeSpan === 0 || firstPeak === 0) return 0;

    const trend = (lastPeak - firstPeak) / firstPeak;
    return trend;
  }

  /**
   * 生成内存使用报告
   */
  generateMemoryReport() {
    const stats = this.getMemoryStats();
    const leaks = this.detectMemoryLeaks();

    return {
      timestamp: new Date().toISOString(),
      summary: {
        currentUsage: stats.current,
        totalCollections: stats.totalCollections,
        monitoringActive: stats.monitoring
      },
      performance: {
        recentPeaks: stats.peaks,
        recentCollections: stats.collections
      },
      health: {
        memoryLeaksDetected: leaks ? leaks.detected : false,
        leakIndicators: leaks ? leaks.indicators : [],
        recommendations: this.generateRecommendations(leaks)
      }
    };
  }

  /**
   * 生成优化建议
   */
  generateRecommendations(leakDetection) {
    const recommendations = [];

    if (!leakDetection) {
      recommendations.push('继续监控内存使用情况');
      return recommendations;
    }

    leakDetection.indicators.forEach(indicator => {
      switch (indicator.type) {
      case 'growth_trend':
        recommendations.push('内存使用呈上升趋势，建议检查是否有内存泄漏');
        break;
      case 'excessive_growth':
        recommendations.push('内存增长过多，建议立即检查代码和缓存策略');
        break;
      case 'ineffective_gc':
        recommendations.push('垃圾回收效果不佳，可能存在对象引用泄漏');
        break;
      }
    });

    // 通用建议
    if (leakDetection.detected) {
      recommendations.push('考虑增加内存监控频率');
      recommendations.push('检查是否有未清理的事件监听器或定时器');
      recommendations.push('优化缓存策略，考虑设置TTL和大小限制');
    }

    return recommendations;
  }

  /**
   * 销毁内存优化器
   */
  destroy() {
    this.stopMonitoring();
    this.performCleanup();

    // 清理所有指标
    this.metrics = {
      initial: this.getCurrentMemoryUsage(),
      peaks: [],
      collections: [],
      optimizations: []
    };

    console.log('🧠 Memory optimizer destroyed');
  }
}

// 🌍 全局内存优化器实例
export const memoryOptimizer = new MemoryOptimizer();

// 内存监控将在应用初始化时启动

export default memoryOptimizer;
