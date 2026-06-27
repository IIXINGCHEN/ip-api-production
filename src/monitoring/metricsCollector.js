/**
 * 📈 指标收集器（从 monitoringService.js 拆分）
 * 计数器 / 直方图 / 仪表盘 / 计时器，含基数保护与惰性清理。
 */

export class MetricsCollector {
  constructor() {
    this.metrics = new Map();
    this.counters = new Map();
    this.histograms = new Map();
    this.timers = new Map();
    this.gauges = new Map();
    this.startTime = Date.now();
    this.maxSeries = 1000; // 单类指标的序列数硬上限（基数保护）
    this.maxHistoryPerSeries = 1000;
    this.writesSinceCleanup = 0;
  }

  /**
   * 基数保护：新序列超过上限时聚合到无 label 的同名序列，
   * 防止 label 取值无界（如曾经的 client_ip）撑爆内存
   */
  boundedKey(map, name, labels) {
    const key = this.createKey(name, labels);
    if (map.has(key) || map.size < this.maxSeries) {
      return key;
    }
    return name;
  }

  incrementCounter(name, value = 1, labels = {}) {
    const key = this.boundedKey(this.counters, name, labels);
    const current = this.counters.get(key) || 0;
    this.counters.set(key, current + value);
    this.recordMetric('counter', name, current + value, labels);
  }

  recordHistogram(name, value, labels = {}) {
    const key = this.boundedKey(this.histograms, name, labels);

    if (!this.histograms.has(key)) {
      this.histograms.set(key, {
        count: 0, sum: 0, min: value, max: value, mean: value, values: []
      });
    }

    const histogram = this.histograms.get(key);
    histogram.count++;
    histogram.sum += value;
    histogram.min = Math.min(histogram.min, value);
    histogram.max = Math.max(histogram.max, value);
    histogram.mean = histogram.sum / histogram.count;

    if (histogram.values.length < 1000) {
      histogram.values.push(value);
    }

    this.recordMetric('histogram', name, value, labels);
  }

  setGauge(name, value, labels = {}) {
    const key = this.boundedKey(this.gauges, name, labels);
    this.gauges.set(key, value);
    this.recordMetric('gauge', name, value, labels);
  }

  startTimer(name, labels = {}) {
    const startTime = Date.now();
    return {
      end: () => {
        const duration = Date.now() - startTime;
        this.recordHistogram(name, duration, labels);
        return duration;
      }
    };
  }

  recordMetric(type, name, value, labels = {}) {
    const timestamp = Date.now();
    const key = this.boundedKey(this.metrics, name, labels);

    if (!this.metrics.has(key)) {
      this.metrics.set(key, []);
    }

    this.metrics.get(key).push({ type, name, value, labels, timestamp });

    const history = this.metrics.get(key);
    if (history.length > this.maxHistoryPerSeries) {
      history.shift();
    }

    // 惰性清理：Workers 中没有后台定时器，由写入路径定期裁剪过期数据
    this.writesSinceCleanup++;
    if (this.writesSinceCleanup >= 1000) {
      this.writesSinceCleanup = 0;
      this.cleanup();
    }
  }

  createKey(name, labels) {
    const labelStr = Object.entries(labels)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}="${v}"`)
      .join(',');
    return labelStr ? `${name}{${labelStr}}` : name;
  }

  getMetrics() {
    const now = Date.now();
    const uptime = Math.max(1, now - this.startTime);
    return {
      uptime,
      timestamp: new Date().toISOString(),
      counters: Object.fromEntries(this.counters),
      histograms: this.getHistogramStats(),
      gauges: Object.fromEntries(this.gauges),
      customMetrics: this.getCustomMetrics()
    };
  }

  getHistogramStats() {
    const stats = {};
    for (const [key, histogram] of this.histograms) {
      const values = [...histogram.values].sort((a, b) => a - b);
      stats[key] = {
        count: histogram.count,
        sum: histogram.sum,
        min: histogram.min,
        max: histogram.max,
        mean: histogram.count > 0 ? histogram.mean : 0,
        p50: this.percentile(values, 0.5),
        p95: this.percentile(values, 0.95),
        p99: this.percentile(values, 0.99)
      };
    }
    return stats;
  }

  percentile(sortedArray, p) {
    if (sortedArray.length === 0) return 0;
    const index = Math.ceil(p * sortedArray.length) - 1;
    return sortedArray[index];
  }

  getCustomMetrics() {
    const custom = {};
    for (const [key, values] of this.metrics) {
      const recent = values.slice(-100);
      if (recent.length > 0) {
        custom[key] = {
          count: recent.length,
          latest: recent[recent.length - 1],
          average: recent.reduce((sum, m) => sum + m.value, 0) / recent.length,
          trend: this.calculateTrend(recent)
        };
      }
    }
    return custom;
  }

  calculateTrend(values) {
    if (values.length < 2) return 'stable';
    const half = Math.floor(values.length / 2);
    const firstHalf = values.slice(0, half);
    const secondHalf = values.slice(half);
    const firstAvg = firstHalf.reduce((sum, v) => sum + v.value, 0) / firstHalf.length;
    const secondAvg = secondHalf.reduce((sum, v) => sum + v.value, 0) / secondHalf.length;
    const change = ((secondAvg - firstAvg) / firstAvg) * 100;
    if (change > 10) return 'increasing';
    if (change < -10) return 'decreasing';
    return 'stable';
  }

  cleanup(maxAge = 3600000) {
    const cutoff = Date.now() - maxAge;
    for (const [key, values] of this.metrics) {
      const filtered = values.filter((m) => m.timestamp > cutoff);
      if (filtered.length === 0) {
        this.metrics.delete(key);
      } else {
        this.metrics.set(key, filtered);
      }
    }
  }

  reset() {
    this.metrics.clear();
    this.counters.clear();
    this.histograms.clear();
    this.timers.clear();
    this.gauges.clear();
    this.startTime = Date.now();
  }
}

export default MetricsCollector;
