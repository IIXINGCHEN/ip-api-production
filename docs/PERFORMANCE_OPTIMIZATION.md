# ⚡ 性能优化文档

## 🎯 概述

本文档详细说明了IP地理位置API的性能优化策略和实现，包括内存管理、缓存优化、批处理等技术。

## 📊 性能优化架构

### 核心组件

1. **PerformanceOptimizer** - 主要性能优化器
2. **MemoryOptimizer** - 内存监控和优化
3. **ProviderManager** - Provider实例管理
4. **ResultCache** - 智能结果缓存
5. **BatchProcessor** - 请求批处理

## 🧠 内存管理优化

### 内存��控

```javascript
import memoryOptimizer from './utils/memoryOptimizer.js';

// 获取内存使用统计
const stats = memoryOptimizer.getMemoryStats();
console.log('Current memory usage:', stats.current);

// 检测内存泄漏
const leaks = memoryOptimizer.detectMemoryLeaks();
if (leaks.detected) {
  console.warn('Memory leaks detected:', leaks.indicators);
}
```

### 内存清理策略

#### 自动清理
- **触发条件**: 内存使用超过80%
- **清理频率**: 每5分钟检查一次
- **清理内容**:
  - 强制垃圾回收
  - 清理缓存
  - 清理事件监听器
  - 清理定时器

#### 手动清理
```javascript
// 执行内存清理
memoryOptimizer.performCleanup();

// 优化内存使用
const optimizations = memoryOptimizer.optimizeMemoryUsage();
```

### 内存泄漏检测

#### 检测指标
- **增长趋势**: 内存使用持续增长
- **过度增长**: 内存增长超过基线100%
- **无效GC**: 垃圾回收效果不佳

#### 预警机制
- 内存使用超过90%时发出警告
- 检测到内存泄漏时记录指标
- 提供优化建议

## 🔄 缓存优化

### Provider实例池

```javascript
// 避免重复实例化Provider
class ProviderManager {
  getProviders() {
    const now = Date.now();

    // 5分钟内复用Provider实例
    if (!this.providers || (now - this.lastInit) > this.initCacheTime) {
      this.providers = [
        new CloudflareProvider(),
        new MaxMindProvider(),
        new IPInfoProvider(),
      ];
      this.lastInit = now;
    }

    return this.providers;
  }
}
```

### 结果缓存

#### 缓存策略
- **TTL**: 5分钟
- **最大容量**: 1000条记录
- **LRU淘汰**: 最近最少使用优先

#### 缓存键生成
```javascript
generateKey(ip, options = {}) {
  const sortedOptions = Object.keys(options)
    .sort()
    .map(key => `${key}=${options[key]}`)
    .join('|');
  return `${ip}:${sortedOptions}`;
}
```

### 数据压缩

#### 压缩策略
- 字符串字段去空格
- 数值字段限制精度（5位小数）
- 数组字段限制数量
- 移除冗余字段

```javascript
static compressGeoData(data) {
  const compressed = {};

  // 压缩数值精度
  if (typeof data.latitude === 'number') {
    compressed.latitude = Math.round(data.latitude * 100000) / 100000;
  }

  // 限制数组大小
  if (data.sources && Array.isArray(data.sources)) {
    compressed.sources = data.sources.slice(0, 3);
  }

  return compressed;
}
```

## 📦 批处理优化

### 批处理机制

```javascript
class BatchProcessor {
  async addRequest(ip, requestFn, options = {}) {
    const key = this.generateBatchKey(ip, options);

    return new Promise((resolve, reject) => {
      if (!this.pendingRequests.has(key)) {
        this.pendingRequests.set(key, {
          requests: [],
          timer: setTimeout(() => this.processBatch(key), 50)
        });
      }

      const batch = this.pendingRequests.get(key);
      batch.requests.push({ resolve, reject, ip, requestFn, options });

      // 达到最大批次时立即处理
      if (batch.requests.length >= this.maxBatchSize) {
        clearTimeout(batch.timer);
        this.processBatch(key);
      }
    });
  }
}
```

### 批处理配置
- **最大批次大小**: 10个请求
- **最大等待时间**: 50ms
- **自动合并**: 相同IP和选项的请求

## 🎯 性能监控

### 性能指标

#### 响应时间监控
```javascript
// 性能装饰器
@withMemoryMonitoring
async function getGeoInfo(ip, request, options) {
  // 函数执行时间会被自动记录
  return await performGeoLookup(ip, request, options);
}
```

#### 缓存命中率
```javascript
const cacheStats = performanceOptimizer.getPerformanceStats();
console.log('Cache hit rate:', cacheStats.cache.hitRate);
```

#### 内存使用统计
```javascript
const memoryStats = memoryOptimizer.getMemoryStats();
console.log('Memory peaks:', memoryStats.peaks);
```

### 性能端点

#### `/performance` - 性能统计
```json
{
  "success": true,
  "data": {
    "performance": {
      "cache": { "hitRate": 0.85 },
      "monitor": { "uptime": 3600 }
    },
    "memory": {
      "current": { "heapUsed": "45MB", "usagePercent": "45%" },
      "monitoring": true
    },
    "health": {
      "memoryLeaksDetected": false,
      "recommendations": []
    }
  }
}
```

#### `/memory` - 内存管理
```bash
# 获取内存统计
GET /memory

# 执行内存清理
GET /memory?action=cleanup

# 生成内存报告
GET /memory?action=report

# 优化内存使用
GET /memory?action=optimize
```

## ⚡ 性能优化配置

### 环境配置

#### 开发环境
```javascript
// 性能优化器禁用
performanceOptimizer.setEnabled(false);

// 内存监控启用
memoryOptimizer.startMonitoring();
```

#### 生产环境
```javascript
// 性能优化器启用
performanceOptimizer.setEnabled(true);

// 自动内存清理
startMemoryCleanup();
```

### 性能调优参数

```javascript
const PERFORMANCE_CONFIG = {
  // 缓存配置
  CACHE_TTL: 300000,        // 5分钟
  CACHE_MAX_SIZE: 1000,      // 1000条记录

  // 批处理配置
  BATCH_MAX_SIZE: 10,        // 10个请求
  BATCH_MAX_WAIT: 50,        // 50ms

  // 内存配置
  MEMORY_THRESHOLD: 80,     // 80%使用率
  CLEANUP_INTERVAL: 300000, // 5分钟

  // 监控配置
  MONITOR_INTERVAL: 30000,   // 30秒
  STATS_RETENTION: 100        // 100条记录
};
```

## 📈 性能基准

### 响应时间目标
- **简单IP查询**: < 50ms
- **地理位置查询**: < 200ms
- **威胁检测查询**: < 300ms
- **批处理查询**: < 500ms

### 内存使用目标
- **基础内存使用**: < 50MB
- **峰值内存使用**: < 100MB
- **内存增长率**: < 10%/小时

### 缓存效率目标
- **缓存命中率**: > 80%
- **缓存响应时间**: < 1ms
- **缓存更新频率**: 每5分钟

## 🔧 性能优化最佳实践

### 1. 缓存策略
- 合理设置TTL，避免过期数据
- 使用LRU淘汰，保持热点数据
- 定期清理缓存，防止内存泄漏

### 2. 批处理
- 合并相似请求，减少重复计算
- 设置合理的批处理大小和等待时间
- 避免批处理延迟过高

### 3. 内存管理
- 及时释放不再使用的对象
- 避免循环引用
- 定期监控内存使用情况

### 4. Provider管理
- 复用Provider实例，避免重复创建
- 合理设置实例缓存时间
- 定期清理长时间未使用的实例

### 5. 数据压缩
- 压缩不必要的字段
- 限制数值精度
- 移除冗余数据

## 🚨 性能问题排查

### 常见性能问题

#### 1. 内存泄漏
**症状**: 内存使用持续增长
**排查**:
- 使用内存泄漏检测
- 检查事件监听器和定时器
- 分析对象引用关系

#### 2. 缓存命中率低
**症状**: 缓存命中率 < 50%
**排查**:
- 检查缓存键生成逻辑
- 验证TTL设置是否合理
- 分析缓存使用模式

#### 3. 响应时间慢
**症状**: 响应时间 > 1秒
**排查**:
- 检查Provider性能
- 分析网络请求耗时
- 查看批处理效果

#### 4. CPU使用率高
**症状**: CPU使用率 > 80%
**排查**:
- 分析计算密集型操作
- 检查正则表达式复杂度
- 优化数据转换逻辑

### 性能分析工具

#### 内置工具
- `/performance` 端点 - 实时性能统计
- `/memory` 端点 - 内存管理和优化
- 性能装饰器 - 函数级别监控

#### 外部工具
- Chrome DevTools - 内存和性能分析
- Node.js Inspector - 详细的性能分析
- APM工具 - 应用性能监控

## 📚 性能优化进阶

### 1. 异步优化
- 使用Promise.all并行处理
- 实现超时机制
- 优化错误处理

### 2. 数据库优化
- 使用连接池
- 优化查询语句
- 实现读写分离

### 3. 网络优化
- 使用HTTP/2
- 实现请求合并
- 优化响应压缩

### 4. 算法优化
- 使用高效的数据结构
- 优化排序和查找算法
- 实现增量更新

## 🎯 性能优化路线图

### 短期目标 (1-2周)
- [x] 实现基础性能监控
- [x] 添加内存管理功能
- [x] 优化缓存策略
- [x] 实现批处理机制

### 中期目标 (1个月)
- [ ] 优化数据库查询
- [ ] 实现智能预加载
- [ ] 添加性能基准测试
- [ ] 优化数据压缩算法

### 长期目标 (3个月)
- [ ] 实现自适应性能调优
- [ ] 添加机器学习预测
- [ ] 实现分布式缓存
- [ ] 优化边缘计算性能

---

**版本**: v1.0.0
**最后更新**: 2024-01-01
**维护者**: 性能优化团队