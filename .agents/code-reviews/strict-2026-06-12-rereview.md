# Code Re-Review — strict profile, 2026-06-12 (second pass)

> Scope: working tree vs `HEAD` (45 tracked files: +7089/-7771, plus ~30 untracked src/tests files)
> Profile: strict | Focus: correctness + security
> Baseline at review time: `npm run lint` 0 errors; `vitest run` **320/320 passed**
> Prior report: `.agents/code-reviews/strict-2026-06-12.md` (round 1)
> Method: lead verified all round-1 fixes line-by-line; 3 parallel fresh-eyes agents covered geo-modern.js, monitoring/performance, secure-utils/threat. All BLOCKER claims independently re-verified by lead.

## Stats

- Files Modified: 28 | Files Deleted: 17 | Files Added (untracked): ~30 (12 src, 14 tests, docs/config)
- New lines: ~7089 | Deleted lines: ~7771

## Round-1 fix verification (9/9 claimed fixes landed)

| Round-1 item | Status | Evidence |
|---|---|---|
| BLOCKER 1 undefined `isDevelopmentEnvironment()` | **FIXED** | cloudflare.js:3,62 uses `ENVIRONMENT.isDevelopment()` |
| BLOCKER 2 optimizer empty provider pool | **FIXED** | performanceOptimizer.js:496-507 imports real providers, filters `isConfigured()` |
| BLOCKER 3 double rate limiter | **FIXED** | per-route limiter deleted; single global at app.js:281; leftover `getRateLimitCache` now dead (RM-13) |
| BLOCKER 4 IPInfo fail-open | **FIXED (fail-closed)** | ipinfo.js:177-181 `Boolean(this.config.token)` — but root cause resurfaces as R-MAJOR 1 |
| MAJOR 1 auth.js/authFixed.js drift | **FIXED** | authFixed.js deleted; only auth.js + rateLimitFixed.js remain |
| MAJOR 2 IPv6 via URL constructor | **FIXED** | ipValidation.js:18-50 manual parser (residual: `::ffff:1.2.3.4` false-negative, RM-19) |
| MAJOR 9 non-constant-time key compare | **FIXED** | response.js:295-312 XOR compare; wired at auth.js:227, geo-modern.js:1483,1615 |
| Fix #2 rate-limit skip on public endpoints | **FIXED** | rateLimitFixed.js:63-83 exact/boundary match incl. `/` special case + regression test |
| Fix #3 dev null geo → fixtures | **FIXED** | cloudflare.js:127-205 gated fixtures; dataSource propagated geo-modern.js:679-680,783-784 |

Round-1 items NOT yet addressed: MAJOR 3 (worse, R-MAJOR 15), MAJOR 4 (R-MAJOR 17), MAJOR 5 (R-MAJOR 16 + new R-BLOCKER 4), MAJOR 6 (quantified, R-MAJOR 8), MAJOR 7/8 (open), MAJOR 10 (open — note: rateLimitFixed got boundary matching, auth.js:152-156 did not), MINOR 1 (worse: duplicated generator in errorHandler.js:764-778), MINOR 2/3 (3 escalated to R-MAJOR 18), MINOR 4 (now self-contradictory, RM-9), MINOR 5/6/7/8 (open).

---

## Top issues (ordered)

### R-BLOCKER 1 — Production always runs as 'development': security gates inert

```
severity: blocker
file: src/config/environment.js (16-59), wrangler.toml (3-5, 24-27), src/app.js (948)
symbol: getEnvironment
issue: in deployed module-syntax Workers every environment signal is absent, so getEnvironment() falls through to 'development' in production
detail: app.js uses `export default app` (module syntax) → wrangler [vars] (ENVIRONMENT/WORKER_ENV/NODE_ENV) arrive only on the per-request `env` binding, never on globalThis; nothing in src ever bridges them (grep: zero assignments). process.env is not populated from bindings at compatibility_date 2024-12-01. `CloudflareWorkersGlobalScope` does not exist in workerd (it is an invented name declared as an ESLint global, which is why lint stays silent). Consequences in production: error responses include error.message + stack at 8 sites (geo-modern.js:474-477,594,940,1107…); CORS takes the permissive dev branch (app.js:195-211); SecureCache encryption off; secureLogger at debug level; dev fixtures become eligible (see R-BLOCKER 2).
suggestion: bridge once on first request — in initializationMiddleware: `globalThis.ENVIRONMENT ??= c.env?.ENVIRONMENT` (same for WORKER_ENV, IPINFO_TOKEN, MAXMIND_*) — or pass env explicitly into config. Add a /health field echoing the resolved environment, and a test asserting production resolves with only `env` populated.
```

### R-BLOCKER 2 — Target-IP lookups return the caller's geolocation in production

```
severity: blocker
file: src/providers/cloudflare.js (21-59), src/services/geoService.js (55-58), src/routes/geo-modern.js (896, 1813, 2275)
symbol: CloudflareProvider.getGeoInfo / secureGeoLookup(:ip)
issue: for /geo/:ip, /:ip, /api/v1/geo/:ip and /v1/batch, the Cloudflare provider reads request.cf — the CALLER's geo — and returns it labeled as the target IP, winning the merge on highest priority
detail: geoService fans out every lookup to all providers with the original c.req; CloudflareProvider ignores which ip was asked and extracts cf.city/cf.country etc. In real production request.cf is always populated → `/geo/8.8.8.8` returns the caller's own city attributed to 8.8.8.8. The only providers able to resolve arbitrary IPs (MaxMind/IPInfo) are dead in production because PROVIDERS_CONFIG snapshots globalThis at module load (R-MAJOR 1). Dev testing missed this because wrangler dev has empty request.cf, which routes into the (correct-looking) fixture table — today's integration tests validated the masked path.
suggestion: pass clientIP in options and have CloudflareProvider return null (not cf data) when ip !== clientIP; fix R-MAJOR 1 so MaxMind/IPInfo can serve target-IP lookups; add a test: request with cf={country:'DE'} looking up 8.8.8.8 must NOT return DE.
```

### R-BLOCKER 3 — BatchProcessor drops concurrent batches; callers hang until route timeout

```
severity: blocker
file: src/services/performanceOptimizer.js (186, 241-246)
symbol: BatchProcessor.processBatch / addRequest
issue: instance-wide `this.processing` flag early-returns BEFORE the batch is removed from pendingRequests, so any batch whose 50ms timer fires while another batch is awaiting provider I/O is orphaned — its callers' promises never settle
detail: processBatch line 241 `if (this.processing) return;` precedes the delete at 246. The orphaned batch's one-shot timer is already consumed; rescue requires 10 more same-key requests hitting the size trigger while processing happens to be false. This is the default hot path (optimizer enabled in constructor line 421; geoService.js:38 routes everything through it). Affected callers burn the full route timeout and surface as REQUEST_TIMEOUT 408 with the lookup result discarded.
suggestion: delete the processing flag entirely (the batch is removed from the map before execution, so re-entry per key is already impossible), or track in-flight per key. Add a regression test: two lookups for different IPs issued 10ms apart must both resolve.
```

### R-BLOCKER 4 — SecureCache truncates keys to ~24 significant bytes: cross-key data bleed

```
severity: blocker
file: src/utils/secureCache.js (32-39, 231-235)
symbol: SecureCache.generateSecureKey / generateEncryptionKey
issue: btoa(key+salt) stripped of +/= then .substring(0,32) keeps only ~24 leading bytes of the logical key, so distinct keys sharing a prefix collide onto one entry and get() serves the other key's data
detail: geo keys are `geo:<ip>:<query>` (geo-modern.js:234-240); `geo:` + a long IPv6 already exceeds the window, so two hosts in the same /64 collide entirely, and same-IP keys differing only in later query params collide too. The integrity checksum passes (computed at store time) and in production the XOR key is derived from the same truncated string (231-235), so colliding entries decrypt cleanly → wrong data even in prod. Salt is appended, then truncated away — it contributes nothing for long keys.
suggestion: use the full logical key as the Map key (an in-memory Map needs no obfuscation) or hash with crypto.subtle SHA-256. Test: two keys sharing a 30-char prefix must occupy distinct entries.
```

### R-MAJORs

```
severity: major
file: src/config/security.js (72-91)
symbol: PROVIDERS_CONFIG
issue: ipinfo.token / maxmind credentials read globalThis at module load — `wrangler secret put IPINFO_TOKEN` etc. can never reach providers in module-syntax Workers
detail: unlike auth (auth.js:129-134 reads c.env per request) and geo-modern's getRuntimeValue (85-89), this snapshot is taken before any request exists. MaxMind/IPInfo are permanently unconfigured in production — fail-closed, but the documented secrets workflow is dead code and target-IP lookups lose their only correct data source (feeds R-BLOCKER 2).
suggestion: make provider config lazy (resolve via getRuntimeValue(c.env) at request time) or hydrate globalThis in the R-BLOCKER 1 bridge.
```

```
severity: major
file: src/app.js (281-291, 474-484)
symbol: skipEndpoints / shouldHandleRootAsIpLookup
issue: '/' is exempt from rate limiting AND auth, yet in production every GET / is a real IP lookup (CF-Connecting-IP always present) with on-demand ThreatService via ?threat=true — an unthrottled compute endpoint
detail: shouldHandleRootAsIpLookup returns true whenever CF-Connecting-IP / X-Forwarded-For exists; the API-overview branch is unreachable in production. skipEndpoints (281-285) excludes '/' from the only remaining limiter.
suggestion: keep '/' public but rate-limited (use a higher bucket for health/metrics instead of full skip), or restrict the skip list to /health and /metrics.
```

```
severity: major
file: src/routes/geo-modern.js (1426-1427) + src/monitoring/monitoringService.js (91-124)
symbol: GET /metrics + MetricsCollector
issue: public, rate-limit-exempt /metrics dumps raw counters whose keys embed other clients' IPs (`api_requests{client_ip="..."}`), with unbounded response size and O(all-metrics) CPU per call
detail: label cardinality is unbounded (client_ip at geo-modern.js:598-602,2049-2053; raw error.message at app.js:403-405,925-927) and each key holds up to 10,000 record objects; the only pruning runs from an interval that never fires in Workers (monitoringService.js:754). /docs claims /metrics is authenticated (app.js:634); it is not (app.js:290).
suggestion: require auth for /metrics, drop client_ip/error.message labels (or hash/bucket), cap key count, run cleanup() opportunistically every N records.
```

```
severity: major
file: src/monitoring/monitoringService.js (636-653, 722-761) + src/app.js (79-126)
symbol: periodic monitoring / health checks / alert rules
issue: the whole monitoring subsystem is inert or lying in Workers: intervals die with the bootstrap request, alert conditions evaluate NaN>80 (always false), two health checks always fail so /monitoring/status reports 'critical' permanently
detail: `typeof setInterval === 'undefined'` guards are never true in workerd, so checkAlerts/cleanup never run after the first request; process.memoryUsage() under nodejs_compat yields zeros → NaN percentages; the 'memory' check (critical:true) and 'memory_optimizer' check (startMonitoring() has no call site — memoryOptimizer.js:59 defined, never called) fail unconditionally. startMemoryCleanup's NODE_ENV gate also passes in prod Workers (process exists, env empty) creating dead per-isolate timers (app.js:123-126).
suggestion: detect Workers positively; drive periodic work from request lifecycle or a Cron Trigger; make memory checks return 'skipped' when real data is unavailable; base memory_optimizer health on something that runs.
```

```
severity: major
file: src/services/performanceOptimizer.js (583-587, 272-282) + src/utils/memoryOptimizer.js (106-108, 163-172) + src/app.js (695-741)
symbol: PerformanceOptimizer.cleanup / BatchProcessor.clear
issue: routine "cleanup" rejects all in-flight coalesced lookups ('Batch processor cleared') and wipes the entire result cache — and any authenticated user can trigger it via GET /memory?action=cleanup
detail: cleanup() is invoked by memory-pressure paths, the 5-min interval (where timers work), shutdown, and the user-facing /memory endpoint; live traffic in the batch window errors out.
suggestion: cleanup should only evict expired entries; reserve batchProcessor.clear() for shutdown; remove cache-clearing from /memory or admin-gate it.
```

```
severity: major
file: src/services/performanceOptimizer.js (290-339)
symbol: DataCompressor.compressGeoData
issue: cache roundtrip is lossy — whitelist drops timezone, continent, postal, accuracy etc., so cached responses differ from fresh ones for identical queries
detail: decompressGeoData is an identity function; nothing is restored. Cached-vs-cold API responses visibly diverge.
suggestion: cache the full merged object (ResultCache already bounds size/TTL) and add a cached==fresh roundtrip test.
```

```
severity: major
file: src/routes/geo-modern.js (498-631, 847-971, 2040-2200, 2206-2381)
symbol: four geo handlers
issue: [ROUND1 MAJOR 6 still-present, quantified] 71-98% copy-paste across 596 lines with security-relevant drift
detail: /api/v1/geo/:ip and /:ip validate bare z.string().ip() (2207-2210, 373-376) so private/reserved IPs bypass the blocking that /geo/:ip enforces via ipParamSchema (847-848); /geo/:ip records zero metrics; /geo + /geo/:ip leak full cacheKey in meta (536, 882); /api/v1 errors leak details.endpoint in production (2181-2183, 2361-2363) where the others send null.
suggestion: extract one handler factory (ip source, param schema, endpoint tag, links builder as params); reuse ipParamSchema on all :ip routes.
```

```
severity: major
file: src/routes/geo-modern.js (234-240, 560, 710, 729-734, 2291-2302)
symbol: getCacheKey / buildGeoResponse
issue: cache key lacks an endpoint discriminator so the four handlers serve each other's meta/links — including https://localhost HATEOAS links that GET /geo bakes in via a stub context and persists into the cache
detail: buildGeoResponse line 710 calls getBaseUrl({req:{header:()=>null}}) → 'https://localhost'; /geo's fresh and cache-hit paths never override links; /api/v1 hit path serves them verbatim. Same key also fragments on format-only params (format/pretty/callback/timeout) multiplying identical entries, and `callback` permits unbounded distinct keys per IP (LRU pressure).
suggestion: key = endpoint + ip + response-affecting params only (lang, fields, include_threat); cache the data payload and rebuild meta/links per request.
```

```
severity: major
file: src/routes/geo-modern.js (1770, 1813-1816, 1841-1844)
symbol: POST /v1/batch
issue: batch path diverges from single lookups: no timeout at all (one hung provider stalls up to 100 IPs; the TimeoutError catch branch is unreachable), and a different query schema (`language` not `lang`, .strict()) 400s `?lang=`/`?pretty=` while the accepted `language` is read as the nonexistent query.lang — i.e. silently ignored
detail: single handlers race REQUEST_TIMEOUT (550-554 etc.); batch calls secureGeoLookup bare. validators.query (inputValidator.js:127-162) vs geoQuerySchema drift.
suggestion: share one query schema and the same withTimeout helper across single and batch paths.
```

```
severity: major
file: src/routes/geo-modern.js (1686-1762)
symbol: GET /monitoring/status
issue: exposes the same active/recent alert objects that /alerts admin-gates, to any user-tier API key
detail: /alerts requires secureCompare with API_KEY_ADMIN (1612-1624); /monitoring/status has no in-handler check and returns alertManager data plus health details and monitoring configuration.
suggestion: apply the admin check or strip alerts/configuration from the payload.
```

```
severity: major
file: src/routes/geo-modern.js (1131-1132, 1142-1148, 1902-1911)
symbol: convertToCSV / escapeCSV / flattenObject
issue: CSV is exploitable and broken: leading =+-@ formula injection reaches Excel/Sheets (Content-Disposition: attachment invites opening), and /v1/batch?format=csv collapses results to "[object Object];[object Object]"
detail: escapeCSV only quotes on , " \n; provider-sourced isp/org/city strings keep =+-@ after sanitizeGeoData. flattenObject joins arrays with String().
suggestion: prefix ' and force-quote fields starting with =+-@; emit one CSV row per batch result; quote on \r too.
```

```
severity: major
file: src/config/threatWhitelist.js (9-90, 287-412, 505-513) + src/services/threatService.js (163-190, 247-274, 842-869)
symbol: isLegitimateISP/Datacenter/Service + checkVPN/checkProxy
issue: [ROUND1 MAJOR 3 still-present, worse] whitelist now matches whole /8s by ip.startsWith(), short-circuiting detection — most VPN/proxy/datacenter ranges ('5.','46.','51.','167.','192.'…) are unreachable, and the data is factually wrong ('22.' labeled 中国移动 is US DoD space; '23.' whitelists all of 23/8 as Akamai)
detail: a /8 whitelist beats every /24 detection range; isKnownProxyRange and knownVPNRanges entries are shadowed dead code.
suggestion: CIDR matching with longest-prefix-wins; whitelist only verified infrastructure ranges; reconcile the contradictory Tor list (51.15.x is both 'Tor exit' and 'legitimate datacenter' → {isTor:true, reputation:'good'}).
```

```
severity: major
file: src/utils/secureCache.js (70-128, 231-235)
symbol: encrypt/decrypt
issue: [ROUND1 MAJOR 5 still-present + new evidence] XOR with key derived from the cache key itself; encrypt uses TextEncoder (UTF-8) but decrypt rebuilds via String.fromCharCode (Latin-1) so any non-ASCII payload (Chinese city names, "Zürich") fails integrity and is silently deleted — in production every non-ASCII geo response is uncacheable; decrypt returns null on all errors; entry stores key.substring(0,8)
suggestion: drop the cipher (or crypto.subtle AES-GCM with a secret-bound key); TextDecoder for byte→string; count and log decrypt failures; remove the stored key prefix.
```

```
severity: major
file: src/utils/secureLogger.js (10-59)
symbol: sanitizeMessage/maskKey/maskIP
issue: [ROUND1 MAJOR 4 still-present] /[a-zA-Z0-9]{20,}/g still masks any long identifier in any message; maskKey still leaks first6+last4; IPv6 addresses are never masked (ipMaskPattern is IPv4-only) while geo-modern logs targetIP believing "会被自动屏蔽"; the advertised sensitivePatterns array is dead config (never referenced)
suggestion: mask by sensitive key names + explicit token formats; add IPv6-aware masking; ≤4 leaked chars; wire or delete sensitivePatterns.
```

```
severity: major
file: src/config/configManager.js (13-23, 353-394) + src/app.js (214) + src/config/environment.js (82-87)
symbol: configSchema / loadFromEnvironment
issue: [ROUND1 MINOR 3 escalated] `api.corsOrigins` does not exist in the configManager schema (zod strips unknown keys), so even with environment detection fixed, production CORS allowlist is always [] — every cross-origin browser request denied; ENV_CONFIG's real origin list has zero importers (dead); loadFromEnvironment reads process.env which is empty in Workers
detail: same pattern: schema's security.rateLimitWindow/MaxRequests exist but the mounted limiter hard-codes 15min/100 (app.js:282-283) while /health displays the unenforced schema values.
suggestion: single config source seeded from c.env at first request; add corsOrigins to the schema; startup assertion that every config.get() path used in routes exists in the schema.
```

```
severity: major
file: src/utils/inputValidator.js (165-182) + src/routes/geo-modern.js (257)
symbol: securityHeadersSchema / createValidationMiddleware
issue: header validation 400s legitimate traffic on every geo route: x-request-id must be a UUID though the API's own generateRequestId emits timestamp36-counter36 (clients echoing our ID get rejected), x-forwarded-for capped at 100 chars rejects real multi-hop IPv6 proxy chains
suggestion: permissive shapes for headers the app actually consumes (/^[\w-]{8,64}$/ for x-request-id; raise/remove the XFF cap) or log-and-continue instead of reject.
```

```
severity: major
file: src/utils/errorHandler.js (279-287, 253-274) + src/middleware/auth.js (193-205, 230-241)
symbol: AppError.sanitizeForProduction / toResponse
issue: production 401/403 bodies leak clientIP, path, method and auth-failure reason: isSensitiveField exact-matches 'ip' but not 'clientip', and nested objects/arrays pass through unfiltered (arrays also get reshaped into {"0":...} numeric-key objects, changing the API contract between dev and prod)
suggestion: substring/regex field matching with recursion; stop putting clientIP/path into client-facing details at call sites — log server-side instead.
```

```
severity: major
file: src/services/threatService.js (88-96) + src/config/threatRules.js (217-230)
symbol: getThreatInfo riskScore aggregation
issue: riskWeights lookup keys (vpnPattern/proxyPattern/torPattern/reputationPattern) don't exist in THREAT_RULES.riskWeights (only botPattern/maliciousPattern), so 4 of 6 checks fall back to raw unbounded scores; the sum can exceed 300 and is returned unclamped on /:ip?threat=true (geo-modern.js:435) and the root lookup (app.js:467) — only buildGeoResponse clamps
suggestion: align the key names, clamp once in getThreatInfo (0-100), unit-test an all-checks-tripped request.
```

### R-MINORs (compact)

| # | file:line | issue |
|---|---|---|
| RM-1 | response.js:9-23 + errorHandler.js:764-778 | [R1-MINOR1 worse] counter-based request IDs, now two drifting copies (formats differ); use crypto.randomUUID() |
| RM-2 | secureLogger.js:165-172,234-247 | [R1-MINOR2] shouldLog hard-codes env→level; disagrees with configManager (production 'error' vs 'warn') |
| RM-3 | threatService.js:372-385 | [R1-MINOR4] hard-coded Tor /16 prefixes; contradicts whitelist → {isTor:true, reputation:'good'} |
| RM-4 | auth.js:152-156 | [R1-MAJOR10] publicEndpoints wildcard startsWith kept in auth while rateLimitFixed got boundary matching — asymmetric fix |
| RM-5 | auth.js:14-28,116-123 | constructor-time initializeKeys/this.validKeys is dead state; getSecurityStats counts keys without env → always 0 in Workers |
| RM-6 | auth.js:129-134 vs geo-modern.js:85-89 | two same-named getRuntimeValue helpers with different signatures ((env,name) vs (c,name)) — drift hazard |
| RM-7 | app.js:261 | X-Request-ID header generated separately from per-route requestId — IDs never correlate |
| RM-8 | app.js:267-277 | clientIP falls back to spoofable XFF/X-Real-IP when CF-Connecting-IP absent — rate limiter keyed on it in non-CF deploys |
| RM-9 | app.js:128-130 + performanceOptimizer.js:421 | setEnabled(true) "for production" is a no-op — constructor already enables everywhere; comment misleads |
| RM-10 | app.js:167-174 | init failure returns raw error.message to clients (onError gates on env; this path doesn't) |
| RM-11 | monitoringService.js:277-291 | health-check timeout timer never cleared when check wins the race |
| RM-12 | performanceOptimizer.js:41-55 | ProviderPool eviction unreachable (usageCount never resets); pool keyed by class .name which breaks under minify=true |
| RM-13 | secureCache.js:417-426 + geo-modern.js:1181-1210 | getRateLimitCache is a dead instance — live limiter uses its own Map; /metrics & /health report fictional zero rate-limit stats |
| RM-14 | performanceOptimizer.js:469-480 | N coalesced callers each re-run ThreatService and mutate the shared result object |
| RM-15 | geo-modern.js:1360-1367 | Prometheus branch emits nested-brace labels (`endpoint="request_duration{...}"`) — invalid exposition format |
| RM-16 | inputValidator.js:132-133 | z.coerce.boolean(): ?include_threat=false → true on /v1/batch (geoQuerySchema does it correctly) |
| RM-17 | geo-modern.js:762-771 | sanitizeGeoData strips '&< from legit names ("Coeur d'Alene"→"Coeur dAlene", "AT&T"→"ATT") though XML/CSV escape at serialization |
| RM-18 | geo-modern.js:1954-2034 | POST /validate echoes full body + SecurityChecker verdicts unconditionally — heuristics-tuning oracle; gate to dev/admin |
| RM-19 | ipValidation.js:18-50 | IPv4-mapped IPv6 (::ffff:1.2.3.4) rejected — false negative |
| RM-20 | ipService.js:101-115,141-168 | `type` means ipv4/ipv6 on simple path but public/private on merge path; merge priority uses single _lastPriority + falsy overwrite ([R1-MINOR5]) |
| RM-21 | geo-modern.js:143-147 + 550-554 | validated `timeout` query param is dead; no clearTimeout anywhere — every lookup leaks a 10s timer |
| RM-22 | geo-modern.js:835-838 | JSONP lacks U+2028/2029 escaping and /**/ prefix (callback name itself strictly validated) |
| RM-23 | geo-modern.js:1094-1096 | XML element names may start with digit/hyphen (not well-formed); xml-prefix not reserved |
| RM-24 | geo-modern.js:1795-1852 | batch doesn't dedupe IPs → up to 100 identical concurrent lookups |
| RM-25 | app.js:500,887; errorHandler.js:409; inputValidator.js:152; userAgent.js:2 | mojibake (U+FFFD) comments — [R1 follow-up] still open, 5 sites |
| RM-26 | tests/setup.js:9-15 | [R1-MINOR7] global.console replacement unchanged |

---

## Suggested patch (blocker-focused minimal diffs)

```diff
--- a/src/app.js  (R-BLOCKER 1 + R-MAJOR 1: bridge env bindings once)
 const initializationMiddleware = async(c, next) => {
+  // module-syntax Workers: [vars]/secrets live on c.env only — bridge once
+  globalThis.ENVIRONMENT ??= c.env?.ENVIRONMENT;
+  globalThis.WORKER_ENV ??= c.env?.WORKER_ENV;
+  globalThis.IPINFO_TOKEN ??= c.env?.IPINFO_TOKEN;
+  globalThis.MAXMIND_USER_ID ??= c.env?.MAXMIND_USER_ID;
+  globalThis.MAXMIND_LICENSE_KEY ??= c.env?.MAXMIND_LICENSE_KEY;
   if (!isInitialized) {
```
注意: PROVIDERS_CONFIG 在模块加载时已快照，桥接后仍需把 token 读取改为惰性（`getRuntimeValue`）才能生效；这是最小桥，完整修法是配置惰性化。

```diff
--- a/src/providers/cloudflare.js  (R-BLOCKER 2)
-  async getGeoInfo(ip, request, _options = {}) {
+  async getGeoInfo(ip, request, options = {}) {
     try {
+      // request.cf 描述的是连接客户端；对任意目标 IP 无效
+      if (options.clientIP && ip !== options.clientIP) {
+        throw new Error('Cloudflare provider can only resolve the connecting client IP');
+      }
```
(geo-modern.js 各 :ip 调用点传入 `clientIP: c.get('clientIP')`)

```diff
--- a/src/services/performanceOptimizer.js  (R-BLOCKER 3)
   async processBatch(key) {
-    if (this.processing) return;
-
     const batch = this.pendingRequests.get(key);
     if (!batch) return;
-
     this.pendingRequests.delete(key);
-    this.processing = true;
     try {
       ...
-    } finally {
-      this.processing = false;
     }
```

```diff
--- a/src/utils/secureCache.js  (R-BLOCKER 4)
   generateSecureKey(key, salt = 'ip-api-cache-salt') {
-    const encoder = new TextEncoder();
-    const data = encoder.encode(key + salt);
-    return btoa(String.fromCharCode(...data))
-      .replace(/[+/=]/g, '')
-      .substring(0, 32);
+    return key; // Map key 无需混淆；如需脱敏展示，仅在日志层截断
   }
```

## Test guidance

- 必须新增的回归测试（对应 4 个 BLOCKER）:
  - env: 仅注入 `env.ENVIRONMENT='production'`（不动 globalThis/process）断言 `ENVIRONMENT.isProduction()===true`，错误响应不含 stack。
  - 归因: mock `request.cf={country:'DE'}` 查询 8.8.8.8，断言结果 country ≠ 'DE'（或 CF provider 不参与）。
  - 并发批次: 10ms 间隔发起两个不同 IP 查询，断言两者都在 200ms 内 resolve（今日代码第二个会挂起）。
  - 缓存碰撞: 共享 30 字符前缀的两个键 set 不同值，get 各自返回自己的值。
- 运行顺序: `npm run lint` → `npx vitest run`（当前 320/320 为基线，修复不得引入回归）→ wrangler dev 手测 `/geo/:ip` 与 `/v1/batch?format=csv`。
- 现有 320 个测试全部在 Node + 内存 mock 下运行，未覆盖 module-Workers 环境语义（这正是 4 个 BLOCKER 全部漏网的原因）— 建议补 `@cloudflare/vitest-pool-workers` 集成层。

## Follow-ups (non-blocking)

- R-MAJOR 群修复顺序建议: 先 env/secrets 惰性化（解锁 1/2 与 CORS），再 monitoring 子系统 Workers 化（Cron Trigger），最后 geo-modern 工厂化去重（一并消灭 RM-17/21/22/23）。
- 仓库根目录的 FIXES_APPLIED.md / FIXES_SUMMARY.md / findings.md / progress.md / task_plan.md / apply-fixes.* 建议归档至 docs/archive/。
- wrangler.toml `compatibility_date` 升至 ≥2025-04-01 可让 process.env 自动填充 [vars]（不解决 secrets-at-module-load，但减少一类坑）。

---

*Reviewer notes*: 严格模式下 No-Mock-Data 政策评估 — dev fixture 本身门控正确（cloudflare.js:127 注释明确禁产线），但 R-BLOCKER 1 使 `isDevelopment()` 在生产为真，fixture 在生产可达（任何 cf 数据缺失的请求），故按 Blocker 链处理。本报告 report-only，未修改生产代码。
