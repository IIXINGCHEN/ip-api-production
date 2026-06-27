# Code Review — ip-api.com 接入 & 多 provider 合并正确性

- **日期**: 2026-06-14
- **Profile**: standard
- **Scope**: diff（本轮 RESTful 重写 + 去硬编码 + ip-api.com 接入）
- **Focus**: correctness

## Stats

| 项 | 数量 |
|---|---|
| 发现问题 | 1 BLOCKER + 3 MAJOR + 1 MINOR |
| 主要涉及 | src/services/performanceOptimizer.js, src/providers/ipApiCom.js, src/services/geoService.js |

## 总体结论

ip-api.com 接入本身正确（provider 单测 6 项通过，dev 真实数据返回），但与既有的 `performanceOptimizer.basicMerge` 合并逻辑交互时暴露出**生产正确性 bug**：合并不按优先级，最低优先级的 ip-api.com 数据会覆盖高优先级的 Cloudflare 数据。同时所有 provider 每次并行调用，导致 ip-api.com（HTTP/第三方/限速）在生产被无谓打满。

---

## BLOCKER

### B1. basicMerge 优先级反转 —— 低优先级 provider 覆盖高优先级数据

```
severity: blocker
file: src/services/performanceOptimizer.js
symbol: basicMerge (约 line 555)
issue: Object.assign 按数组顺序合并，最低优先级 provider 最后赋值 → 覆盖高优先级数据
```

**detail**:
```js
basicMerge(results, _providers, ip, _options) {
  const merged = { ip, timestamp: new Date().toISOString() };
  results.forEach((result) => {
    if (result.status === 'fulfilled' && result.value) {
      Object.assign(merged, result.value);   // ← 顺序覆盖，最后者赢
    }
  });
  return merged;
}
```
`getOptimizedProviders()` 返回顺序为 Cloudflare(100)→MaxMind(80)→IPInfo(60)→IPApiCom(40)。`Object.assign` 后者覆盖前者，所以 **IPApiCom(40) 的数据覆盖 Cloudflare(100)**。优先级语义完全反转。

**生产影响**：真实 Cloudflare `request.cf` 返回精确数据（如 8.8.8.8 的 cf 归属），但 ip-api.com 的数据（HTTP 查询，可能与 cf 不同）覆盖之。响应展示低质量/不一致数据，且 `provider` 字段也被 IPApiCom 覆盖（误导来源归因）。

**dev 为何"看起来对"**：dev 下 Cloudflare 返回全 null，IPApiCom 有数据，Object.assign 恰好给出 IPApiCom 数据——正确结果但错误原因，掩盖了 bug。

**suggestion**：改为优先级感知合并——按 priority 降序，每个字段"先到先得"（高优先级先设、低优先级仅填空），并排除 `provider`/`sources`/`dataQuality` 后单独归因最高优先级贡献者。

---

## MAJOR

### M1. 所有 provider 每次请求并行调用 —— ip-api.com 被无谓打满

```
severity: major
file: src/services/performanceOptimizer.js
symbol: getOptimizedGeoInfo (line 449-453)
issue: providers.map(...).allSettled() 每次未缓存请求并行调用全部 provider
```

**detail**：即使 Cloudflare 已返回完整数据，ip-api.com 仍被并行调用。后果：
1. **隐私**：被查询的 IP 明文（HTTP）外发给第三方 ip-api.com，即使本不需要。
2. **限流**：免费 45 req/min 在低并发下即耗尽，后续请求全部失败。
3. **延迟/依赖**：每次请求多一次外部 HTTP 往返 + 第三方可用性依赖。

**suggestion**：将 ip-api.com 作为**纯兜底**——先并行执行高优先级 provider（Cloudflare/MaxMind/IPInfo），若合并结果已有可用地理数据（country/city/坐标任一），则跳过 ip-api.com；否则才调用。

### M2. getOptimizedProviders 不按优先级排序

```
severity: major
file: src/services/performanceOptimizer.js
symbol: getOptimizedProviders (line 505-516)
issue: 返回数组依赖声明顺序，未 sort(priority desc)
```
**detail**：当前声明顺序恰为降序，但这是巧合非保证。任何人调整声明顺序即破坏（与 B1 叠加）。应显式 `.sort((a,b)=>b.priority-a.priority)`。

### M3. provider 归因错误

```
severity: major
file: src/services/performanceOptimizer.js
symbol: basicMerge
issue: Object.assign 包含 provider 字段，最后一个 provider 覆盖真实来源
```
**detail**：响应的 `provider` 字段应是"实际贡献数据的高优先级来源"，现被最后一个 provider（IPApiCom）无条件覆盖。对比 `geoService.mergeGeoResults` 正确排除了 provider 字段。

---

## MINOR

### m1. ipApiCom.getIPInfo 未走 isConfigured 检查（一致性）

```
severity: minor
file: src/providers/ipApiCom.js
symbol: getIPInfo
issue: 与 MaxMind/IPInfo 模式不同，未在入口校验（虽然 isConfigured 恒 true，影响小）
```
**suggestion**：保持一致，或显式注释"免 token 无需校验"。

---

## Suggested Patch（已实施）

### 1. `performanceOptimizer.basicMerge` —— 优先级感知合并

按 priority 降序，高优先级先设、低优先级仅填空；排除 provider/sources/dataQuality；provider 归因最高优先级贡献者。

### 2. `getOptimizedGeoInfo` —— ip-api.com 兜底化

拆分 primary（Cloudflare/MaxMind/IPInfo）与 fallback（ip-api.com）。先执行 primary；若 primary 已有可用地理数据则跳过 fallback，否则执行 fallback 补齐。

### 3. `getOptimizedProviders` —— 显式按优先级排序

## Test Guidance

- 新增：`optimizedMerge_priority` 测试——高优先级 provider 与低优先级 provider 同字段不同值时，高优先级胜出。
- 新增：`ipapicom_fallback_only` 测试——primary 返回完整数据时，ip-api.com 不被调用（mock fetch 断言未被调用）。
- 新增：`provider_attribution` 测试——primary 贡献数据时 provider 字段为 primary 名。
- 现有：`ipApiComProvider.test.js`（6 项）继续通过。

## Follow-ups

- 统一合并逻辑：geoService.mergeGeoResults 与 performanceOptimizer.basicMerge 两份实现，应合并为单一 priority-aware 合并器，消除双路径分歧。
- ip-api.com HTTPS：免费版仅 HTTP；若生产用作兜底，考虑付费 HTTPS 或仅 dev 启用。
- `performanceOptimizer.enabled` 默认 true 与 app.js"仅 prod 启用"意图不符——应默认 false 或在非 prod 显式关闭（独立项，本轮不动）。

---

## 解决方案（2026-06-14 已实施）

| ID | 修复 | 文件 |
|---|---|---|
| B1 | `basicMerge` 重写为优先级感知：按 priority 降序、高优先级先占位、低优先级仅填空、排除 provider/sources/dataQuality/confidence | performanceOptimizer.js |
| M1 | `getOptimizedGeoInfo` 拆分 primary(≥50)/fallback(<50)：primary 先并行，`hasUsableGeo` 判定无地理数据时才调用 ip-api.com 兜底 | performanceOptimizer.js |
| M2 | `getOptimizedProviders` 显式 `.sort((a,b)=>b.priority-a.priority)` | performanceOptimizer.js |
| M3 | provider 归因改用 `hasUsableGeo(result.value)`：归到含可用地理数据的最高优先级来源（非贡献 ip 字段者） | performanceOptimizer.js |
| — | 新增模块级 `hasUsableGeo()` 辅助 | performanceOptimizer.js |
| — | 新增 `tests/unit/optimizedMerge.test.js`（7 项）锁定优先级合并 + 归因 | tests |

### 验证

- `npm run lint`：0 错误
- `npm run test:run`：**367/367 通过**（+7 优先级合并测试）
- dev 服务器：8.8.8.8→US/Ashburn/Google `[provider:IPApiCom]`（归因正确，非 Cloudflare）
- 端点矩阵：48/48 通过
- 生产路径正确性：高优先级 Cloudflare 数据现按优先级胜出（单元测试 `optimizedMerge.test.js` 覆盖），ip-api.com 仅在 primary 无数据时兜底（隐私/成本问题解决）

