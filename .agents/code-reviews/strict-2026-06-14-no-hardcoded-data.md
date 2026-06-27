# Strict Code Review — 禁止硬编码 / 强制真实请求

- **日期**: 2026-06-14
- **Profile**: strict
- **Scope**: repo（整个项目）
- **Focus**: No Mock Data Policy — API 接口 / 数据格式 / 响应不允许任何硬编码，必须真实请求获取
- **审查依据**: 用户指令"整个项目 API接口 数据格式 api返回响应 都不允许有任何的硬编码 必须是真实请求并真实获取返回的"

## Stats

| 项 | 数量 |
|---|---|
| Files Modified (建议) | 4 |
| Files Added | 0 |
| Files Deleted (建议) | 0（死代码内联移除） |
| 发现问题 | 1 BLOCKER + 5 MAJOR + 2 MINOR |

## 总体结论

**生产路径（真实 Cloudflare Workers）干净**：CloudflareProvider 读取真实 `request.cf`，MaxMind/IPInfo 走真实 HTTP 请求。

**但开发路径（`wrangler dev --local`）100% 返回硬编码假数据**：因本地无 `request.cf` 且 `.env.development` 未配置任何真实 provider token，唯一"数据源"是 `CloudflareProvider.getDevelopmentGeoData` 的硬编码 fixture 表。这违反 No Mock Data Policy（BLOCKER）。此外 `geoService` 用硬编码公式/映射表覆写/注入 timezone、currency、languages（MAJOR）。

---

## BLOCKER

### B1. CloudflareProvider.getDevelopmentGeoData — 开发环境返回硬编码假地理数据

```
severity: blocker
file: src/providers/cloudflare.js
symbol: CloudflareProvider.getDevelopmentGeoData (lines 121-205)
issue: 开发环境把硬编码 fixture 当作真实地理定位返回给 API 消费方
```

**detail**:
- `getDevelopmentGeoData(ip)` 维护一张 6 条已知 IP 的硬编码表（8.8.8.8→Google/Mountain View 等）。
- 未命中时按 `/24` 前缀 hash **选一个 fixture 区域**返回（`approxFromPrefix`）——对任意未知 IP 都"编造"出确定但虚假的国家/城市/坐标，标记 `dataSource: 'development-fixture'` 但仍以正常 200 响应返回。
- IPv6 fallback 直接返回 `country:'XX'`, `city:'Unknown'`, `latitude:0`, `longitude:0`, `asOrganization:'Unknown (development fixture)'`。
- `.env.development` 中 `IPINFO_TOKEN` / `MAXMIND_*` 全部注释，所以 dev **没有任何真实 provider 数据源**——所有 `/api/v1/ips/*` 的地理字段都来自这套硬编码。

**影响**：
1. 直接违反"必须是真实请求并真实获取返回的"。
2. 误导风险：若 `ENVIRONMENT.isDevelopment()` 误判（历史审查记录过环境检测 false-positive），fixture 会泄漏到生产。
3. `/24 hash` 返回的坐标/城市与真实归属无关，下游若做地图标注/风控会基于假数据决策。

**suggestion**（推荐方案，需用户确认 dev 数据源策略）：
- **移除** `getDevelopmentGeoData` 整个方法及 `isDevelopment && !hasRealGeoData` 分支（cloudflare.js:61-68）。
- 改为：CloudflareProvider 仅返回 `request.cf` 真实数据；无真实数据时返回**部分空字段**（不编造），由 geoService 的多 provider 合并 + 失败回退处理。
- 为 dev 配置**真实** provider：在 `.env.development` 填入真实 `IPINFO_TOKEN`（免费额度即可），使 IPInfoProvider 发起真实 HTTP 请求；或部署到 Cloudflare dev/staging 环境获取真实 `request.cf`。
- 若无任何真实数据源，API 应**显式失败**（`GEOLOCATION_UNAVAILABLE`，状态 503）而非返回编造数据。

---

## MAJOR

### M1. geoService.getTimezoneFromCoordinates — 硬编码公式覆写真实时区

```
severity: major
file: src/services/geoService.js
symbol: getTimezoneFromCoordinates (lines 370-385)，调用点 lines 86-91
issue: 用 longitude/15 的硬编码 UTC 偏移公式覆写 provider 返回的真实 IANA 时区
```

**detail**: `getGeoInfoOriginal` 第 86-91 行：只要 `geoInfo.latitude && longitude` 为真，就无条件执行 `geoInfo.timezone = getTimezoneFromCoordinates(...)`。该函数把经度除以 15 得到整数偏移，产出 `"UTC+8:00"` 这类**非真实时区字符串**，覆盖掉 Cloudflare/MaxMind 返回的真实值（如 `"America/Los_Angeles"`）。这既是正确性 bug（真实时区被假值替换），又是硬编码数据注入。

**suggestion**: 删除 lines 86-91 与 `getTimezoneFromCoordinates` 函数。时区只来自 provider 真实数据；provider 未提供则为 `null`，由响应层如实呈现。

### M2. geoService.getCurrencyFromCountry — 硬编码 11 国货币表

```
severity: major
file: src/services/geoService.js
symbol: getCurrencyFromCountry (lines 387-404)，调用点 line 95
issue: 硬编码 11 个国家的 {code,name,symbol} 映射，注入 geoInfo.currency
```

**detail**: 仅覆盖 US/GB/DE/FR/JP/CN/CA/AU/IN/BR/RU，其余国家 `currency=null`。注入到每个有 country 的响应。当前因 `geoFormatter.sanitizeGeoData` 的 stringFields 不含 `currency`，该字段在响应层被剥离（即死注入 + 死剥离），但硬编码表本身违反策略，且浪费计算。

**suggestion**: 删除 lines 94-96 注入与 `getCurrencyFromCountry` 函数。货币信息若需要，应来自真实 provider（MaxMind/IPInfo 未提供则不返回）。

### M3. geoService.getLanguagesFromCountry — 硬编码 ~20 国语言表

```
severity: major
file: src/services/geoService.js
symbol: getLanguagesFromCountry (lines 406-432)，调用点 line 100
issue: 硬编码 ~20 国语言数组，注入 geoInfo.languages
```

**detail**: 同 M2，硬编码表 + 死注入（响应层被剥离）。删除注入（lines 99-101）与函数。

### M4. IPInfoProvider.getCountryName — 硬编码 20 国国名回退表

```
severity: major
file: src/providers/ipinfo.js
symbol: getCountryName (lines 149-175)，调用点 line 124
issue: IPInfo 响应缺 country_name 时，用硬编码 20 国表编造国名
```

**detail**: `parseGeoResponse` 第 124 行 `country: response.country_name || this.getCountryName(response.country)`。IPInfo 通常返回 `country_name`，但缺失时回退到只覆盖 20 国的硬编码表，未命中则原样返回国家代码。应直接用 provider 真实字段。

**suggestion**: 改为 `country: response.country_name || null`（删除 getCountryName 函数）。国名缺失就如实返回 null，不编造。

### M5. response.js 死代码 + 硬编码国名表

```
severity: major
file: src/utils/response.js
symbol: formatIPResponse (54-92), formatGeoResponse (94-179), getCountryNameFromCode (331-358)
issue: 含硬编码 20 国国名表的遗留格式化器，新路由已不再引用（死代码）
```

**detail**: grep 确认 `formatGeoResponse`/`formatIPResponse`/`getCountryNameFromCode` 在 `src/` 内除定义处外**无任何引用**——新路由全部使用 `geoFormatter.js`。它们携带硬编码国名表（lines 331-358）与遗留响应结构，属死代码。

**suggestion**: 删除这三个函数（保留 `generateRequestId`/`secureCompare`/`calculateResponseTime`/`addResponseMetadata` 等仍在用的导出）。

---

## MINOR

### m1. BaseProvider 死占位块

```
severity: minor
file: src/providers/BaseProvider.js
symbol: handleError (lines 49-51)
issue: `if (process.env.NODE_ENV === 'development') { // Development logging would go here }` 空占位
```

**suggestion**: 删除该空块；如需开发日志用 secureLogger。

### m2. cloudflare.js fixture 残留字符串

```
severity: minor
file: src/providers/cloudflare.js
symbol: getDevelopmentGeoData (line 201)
issue: 'Unknown (development fixture)' / 'XX' 等硬编码字符串（随 B1 一并移除）
```

---

## 架构 / 根因

开发环境数据缺失的根因：`wrangler dev --local` 不注入真实 `request.cf`，而 `.env.development` 又未配置任何真实 provider 凭证。当前用硬编码 fixture "填坑"。正确做法是让数据来自真实请求，缺口处**显式失败**而非编造。

**生产侧无需改动**（真实 `request.cf`）。问题集中在 dev 数据源策略 + geoService 的硬编码富化注入。

## 验证清单（修复后）

- [ ] `grep -rn "development-fixture\|getDevelopmentGeoData" src/` 无结果（除注释说明）
- [ ] `grep -rn "getTimezoneFromCoordinates\|getCurrencyFromCountry\|getLanguagesFromCountry\|getCountryNameFromCode\|formatGeoResponse" src/` 无结果
- [ ] dev 环境：无真实 provider 时 `/api/v1/ips/8.8.8.8` 返回 503 `GEOLOCATION_UNAVAILABLE`（而非 200 假数据）；配置真实 IPINFO_TOKEN 后返回真实数据
- [ ] `npm run lint` 0 错误；`npm run test:run` 全绿（相关测试需更新预期）
- [ ] 生产环境 `request.cf` 真实数据流不受影响

## Test Guidance

- 更新 `tests/unit/cloudflareDevFixture.test.js`：该测试当前断言 dev fixture 行为，移除 fixture 后需改为断言"无 cf 数据时返回空字段 / 不编造"。
- 新增：`dev-no-provider-returns-error` 集成测试——dev 无 token 时 geo 查询返回 503。
- 新增：`timezone-not-overwritten` 测试——provider 返回真实时区时不被公式覆写。

## Follow-ups（非阻塞）

- 统一国名/货币/语言数据来源：若产品需要这些富化字段，接入真实数据源（如 MaxMind 已含部分），而非硬编码表。
- `cloudflare.js` 的 `getCloudflareMetadata` 暴露 `clientTrustScore` 等字段——确认这些在真实 Workers 环境可用，本地为 undefined 应如实呈现。

---

## 解决方案（2026-06-14 已实施）

用户选择 **方案 A：返回空真实数据**（移除 fixture，无真实 provider 数据时返回 null 字段，provider 仍标识真实来源）。

### 已修复

| ID | 修复 | 文件 |
|---|---|---|
| B1 | 移除 `getDevelopmentGeoData` 整个方法 + dev 分支 + 未用的 ENVIRONMENT 导入；空 cf 返回 null 字段 | cloudflare.js |
| M1 | 移除 `getTimezoneFromCoordinates` 调用与函数（不再用公式覆写真实时区） | geoService.js |
| M2 | 移除 `getCurrencyFromCountry` 注入与函数 | geoService.js |
| M3 | 移除 `getLanguagesFromCountry` 注入与函数 | geoService.js |
| M4 | ipinfo `getCountryName` 硬编码表移除，country 缺失返回 null | ipinfo.js |
| M5 | response.js 精简为仅 `generateRequestId`+`secureCompare`（删除 formatGeoResponse/formatIPResponse/getCountryNameFromCode 等死代码） | response.js |
| m1 | BaseProvider 死占位块移除 | BaseProvider.js |
| — | geoFormatter 移除 `dataSource='development-fixture'` 透传（死代码） | geoFormatter.js |
| — | cloudflare.js 字段一致性（`continent/timezone/asn` 空值 `?? null`，`let→const`） | cloudflare.js |

### 验证结果

- `npm run lint`：**0 错误 0 警告**
- `npm run test:run`：**354/354 通过**（新增 `cloudflareNoFabrication.test.js` 6 项断言无编造；旧 fixture 测试备份为 `.bak`）
- dev 服务器实测 `/api/v1/ips/8.8.8.8`：`country/network/timezone` 全 `null`，`provider: Cloudflare`，无 `dataSource` 字段；`includeThreat=true` 的 `security` 仍来自真实 ThreatService 规则
- 生产路径（真实 `request.cf`）不受影响——`cloudflareNoFabrication.test.js` 覆盖"真实 cf 原样透传"

### 残留（非生产路径，可恢复用）

- `src/routes/_geo-modern.legacy.bak`、`tests/unit/_cloudflareDevFixture.legacy.bak`：未跟踪备份文件，`.bak` 扩展名不被 import/lint，稳定后可删。

