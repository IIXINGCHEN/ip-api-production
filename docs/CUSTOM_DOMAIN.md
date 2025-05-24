# 🌐 自定义域名快速配置

## 🚀 一键配置

使用我们提供的自动化脚本快速配置自定义域名：

```bash
npm run setup-domain
```

这个脚本将引导您完成整个配置过程。

## 📋 手动配置步骤

### 1. 准备域名

确保您的域名已添加到Cloudflare账户：

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. 点击 "Add a Site" 添加您的域名
3. 按照指引更新域名服务器到Cloudflare

### 2. 配置Worker路由

编辑 `wrangler.toml` 文件，在生产环境配置中添加路由：

```toml
[env.production]
name = "ip-api-production"
workers_dev = false
minify = true

# 替换为您的实际域名
routes = [
  { pattern = "api.yourdomain.com/*", zone_name = "yourdomain.com" }
]
```

### 3. 配置DNS记录

在Cloudflare DNS设置中添加CNAME记录：

```
类型: CNAME
名称: api
目标: ip-api-production.axingchen.workers.dev
代理状态: 已代理 (橙色云朵)
```

### 4. 部署和测试

```bash
# 部署到生产环境
npm run deploy:production

# 测试API
curl https://api.yourdomain.com/
```

## 🎯 推荐域名方案

### 方案A：API子域名（推荐）
- **域名**: `api.yourdomain.com`
- **优点**: 专业、易记、SEO友好
- **用途**: 通用API服务

### 方案B：专用子域名
- **域名**: `ip-api.yourdomain.com`
- **优点**: 功能明确、便于管理
- **用途**: 专门的IP查询服务

### 方案C：多子域名
- **域名**: 
  - `api.yourdomain.com` (主API)
  - `ip.yourdomain.com` (IP服务)
  - `geo.yourdomain.com` (地理位置服务)
- **优点**: 服务分离、扩展性好
- **用途**: 大型API平台

## 🔧 高级配置

### 多环境域名

```toml
# 生产环境
[env.production]
routes = [
  { pattern = "api.yourdomain.com/*", zone_name = "yourdomain.com" }
]

# 测试环境  
[env.staging]
routes = [
  { pattern = "api-staging.yourdomain.com/*", zone_name = "yourdomain.com" }
]

# 开发环境
[env.development]
workers_dev = true  # 使用 *.workers.dev 域名
```

### 路径路由

如果您希望使用路径而不是子域名：

```toml
routes = [
  { pattern = "yourdomain.com/api/*", zone_name = "yourdomain.com" }
]
```

访问地址将变为：`https://yourdomain.com/api/`

## 🛡️ 安全配置

### HTTPS强制重定向

Worker会自动处理HTTPS重定向，但您也可以在Cloudflare中配置：

1. 进入 SSL/TLS 设置
2. 选择 "完全" 或 "完全(严格)" 模式
3. 启用 "始终使用HTTPS"

### CORS配置

更新应用中的CORS设置以支持您的域名：

```javascript
// src/app.js
app.use('*', cors({
  origin: [
    'https://yourdomain.com',
    'https://api.yourdomain.com',
    'https://www.yourdomain.com'
  ],
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'X-API-Key']
}))
```

## 📊 监控和维护

### 健康检查

设置定期健康检查：

```bash
# 创建监控脚本
curl -f https://api.yourdomain.com/health || exit 1
```

### 性能监控

在Cloudflare Analytics中监控：
- 请求量和响应时间
- 错误率和状态码分布
- 地理分布和缓存命中率

## 🚨 故障排除

### 常见问题

1. **域名无法访问**
   ```bash
   # 检查DNS解析
   nslookup api.yourdomain.com
   
   # 检查Cloudflare代理状态
   dig api.yourdomain.com
   ```

2. **SSL证书错误**
   - 确保DNS记录的代理状态为"已代理"
   - 检查SSL/TLS设置为"完全"模式

3. **404错误**
   ```bash
   # 检查Worker部署状态
   wrangler deployments status --env production
   
   # 查看Worker日志
   wrangler tail --env production
   ```

### 调试工具

```bash
# 测试域名解析
nslookup api.yourdomain.com

# 测试SSL证书
openssl s_client -connect api.yourdomain.com:443

# 测试HTTP响应
curl -I https://api.yourdomain.com/
```

## 📝 配置检查清单

- [ ] 域名已添加到Cloudflare
- [ ] DNS记录已正确配置
- [ ] wrangler.toml已更新路由
- [ ] Worker已重新部署
- [ ] 自定义域名可以访问
- [ ] SSL证书正常工作
- [ ] API端点返回正确响应
- [ ] CORS配置正确
- [ ] 监控已设置

## 🎉 完成后的API访问

配置完成后，您可以通过以下方式访问API：

```bash
# 基本IP查询
curl https://api.yourdomain.com/

# 地理位置查询
curl https://api.yourdomain.com/geo

# 指定IP查询
curl https://api.yourdomain.com/?ip=8.8.8.8

# 威胁检测查询
curl https://api.yourdomain.com/?ip=8.8.8.8&include_threat=true
```

## 📞 支持

如果在配置过程中遇到问题，请：

1. 查看 [DOMAIN_SETUP_GUIDE.md](../DOMAIN_SETUP_GUIDE.md) 详细指南
2. 检查 Cloudflare Dashboard 中的设置
3. 使用 `wrangler tail` 查看实时日志
4. 参考故障排除部分

祝您配置成功！🎊
