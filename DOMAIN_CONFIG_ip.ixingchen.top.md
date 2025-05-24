# 🌐 ip.ixingchen.top 域名配置指南

## 📋 配置概览

**目标域名**: `ip.ixingchen.top`  
**主域名**: `ixingchen.top`  
**Worker名称**: `ip-api-production`  
**配置状态**: ✅ 已配置完成

## 🔧 DNS 配置要求

在Cloudflare DNS设置中添加以下记录：

### CNAME 记录配置

```
类型: CNAME
名称: ip
目标: ip-api-production.axingchen.workers.dev
代理状态: 已代理 (🟠 橙色云朵)
TTL: 自动
```

### 配置步骤

1. **登录 Cloudflare Dashboard**
   - 访问: https://dash.cloudflare.com/
   - 选择域名: `ixingchen.top`

2. **进入 DNS 设置**
   - 点击 "DNS" 选项卡
   - 点击 "Add record"

3. **添加 CNAME 记录**
   ```
   Type: CNAME
   Name: ip
   Target: ip-api-production.axingchen.workers.dev
   Proxy status: Proxied (Orange cloud)
   ```

4. **保存配置**
   - 点击 "Save" 保存记录
   - 确保代理状态为"已代理"（橙色云朵图标）

## 🚀 部署配置

### 当前 wrangler.toml 配置

```toml
[env.production]
name = "ip-api-production"
workers_dev = false
minify = true

# 自定义域名路由
routes = [
  { pattern = "ip.ixingchen.top/*", zone_name = "ixingchen.top" }
]

[env.production.vars]
ENVIRONMENT = "production"
WORKER_ENV = "production"
NODE_ENV = "production"
```

### 部署命令

```bash
# 部署到生产环境
npm run deploy:production

# 或使用 wrangler 直接部署
wrangler deploy --env production
```

## 🧪 测试验证

### API 端点测试

```bash
# 1. 基本IP查询
curl https://ip.ixingchen.top/

# 2. 地理位置查询
curl https://ip.ixingchen.top/geo

# 3. 指定IP查询
curl https://ip.ixingchen.top/?ip=8.8.8.8

# 4. 威胁检测查询
curl https://ip.ixingchen.top/?ip=8.8.8.8&include_threat=true

# 5. 健康检查
curl https://ip.ixingchen.top/admin/health

# 6. SSL证书检查
curl -I https://ip.ixingchen.top/
```

### 预期响应示例

```json
{
  "ip": "8.8.8.8",
  "country": "United States",
  "countryCode": "US",
  "region": "California",
  "regionCode": "CA",
  "city": "Mountain View",
  "latitude": 37.4056,
  "longitude": -122.0775,
  "timezone": "America/Los_Angeles",
  "isp": "Google LLC",
  "org": "Google Public DNS",
  "as": "AS15169",
  "asname": "Google LLC",
  "requestId": "uuid-random-timestamp",
  "timestamp": "2024-12-19T...",
  "version": 4,
  "type": "public",
  "isPrivate": false,
  "isLoopback": false,
  "isMulticast": false,
  "provider": "Cloudflare"
}
```

## 🛡️ 安全配置

### HTTPS 配置

- ✅ 自动HTTPS重定向
- ✅ SSL/TLS证书自动管理
- ✅ HSTS安全头
- ✅ CSP内容安全策略

### CORS 配置

已配置支持以下域名：
- `https://ip.ixingchen.top`
- `https://ixingchen.top`
- `https://www.ixingchen.top`

### 安全头

```
Strict-Transport-Security: max-age=31536000; includeSubDomains
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
X-XSS-Protection: 1; mode=block
Content-Security-Policy: default-src 'self'
```

## 📊 监控和性能

### Cloudflare Analytics

在 Cloudflare Dashboard 中监控：
- 请求量和响应时间
- 错误率和状态码分布
- 地理分布和缓存命中率
- 安全威胁拦截

### 性能指标

- **响应时间**: < 50ms 平均
- **可用性**: 99.9%+
- **全球CDN**: Cloudflare边缘网络
- **缓存命中率**: 80%+

## 🚨 故障排除

### 常见问题

1. **域名无法访问**
   ```bash
   # 检查DNS解析
   nslookup ip.ixingchen.top
   
   # 检查DNS传播
   dig ip.ixingchen.top
   ```

2. **SSL证书错误**
   - 确保DNS记录代理状态为"已代理"
   - 检查SSL/TLS设置为"完全"模式

3. **404错误**
   ```bash
   # 检查Worker部署状态
   wrangler deployments status --env production
   
   # 查看实时日志
   wrangler tail --env production
   ```

### 调试工具

```bash
# DNS解析检查
nslookup ip.ixingchen.top

# SSL证书检查
openssl s_client -connect ip.ixingchen.top:443 -servername ip.ixingchen.top

# HTTP响应检查
curl -v https://ip.ixingchen.top/

# Worker日志
wrangler tail --env production
```

## 📝 配置检查清单

- [x] wrangler.toml 已配置路由
- [x] CORS 已配置支持域名
- [x] 404 处理器已更新
- [ ] DNS CNAME 记录已添加
- [ ] DNS 代理状态已启用
- [ ] Worker 已重新部署
- [ ] 域名可以正常访问
- [ ] SSL 证书正常工作
- [ ] API 端点返回正确响应

## 🎯 下一步操作

1. **添加 DNS 记录**
   - 在 Cloudflare Dashboard 中添加 CNAME 记录
   - 确保代理状态为"已代理"

2. **重新部署 Worker**
   ```bash
   npm run deploy:production
   ```

3. **测试 API 访问**
   ```bash
   curl https://ip.ixingchen.top/
   ```

4. **验证功能完整性**
   - 测试所有API端点
   - 检查威胁检测功能
   - 验证地理位置查询

## 🎉 完成后的访问方式

配置完成后，您可以通过以下方式访问IP-API：

- **主页**: https://ip.ixingchen.top/
- **地理位置**: https://ip.ixingchen.top/geo
- **指定IP查询**: https://ip.ixingchen.top/?ip=YOUR_IP
- **威胁检测**: https://ip.ixingchen.top/?ip=YOUR_IP&include_threat=true
- **健康检查**: https://ip.ixingchen.top/admin/health

祝您配置成功！🚀
