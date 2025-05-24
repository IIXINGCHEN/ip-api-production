# 🌐 自定义域名配置指南

## 概述

本指南将帮助您为IP-API生产环境配置自定义域名，实现专业的API访问地址。

## 📋 前置要求

- ✅ 拥有一个域名（如：yourdomain.com）
- ✅ 域名已添加到Cloudflare账户
- ✅ Cloudflare Workers已部署
- ✅ 具有域名管理权限

## 🚀 配置步骤

### 步骤1：域名添加到Cloudflare

1. **登录Cloudflare Dashboard**
   - 访问：https://dash.cloudflare.com/
   - 使用您的Cloudflare账户登录

2. **添加域名**
   ```bash
   # 在Cloudflare Dashboard中：
   # 1. 点击 "Add a Site"
   # 2. 输入您的域名（如：yourdomain.com）
   # 3. 选择计划（Free计划即可）
   # 4. 按照指引更新域名服务器
   ```

3. **等待DNS传播**
   - 通常需要24-48小时
   - 可以使用在线工具检查DNS传播状态

### 步骤2：配置Worker路由

1. **更新wrangler.toml配置**
   
   编辑 `wrangler.toml` 文件，取消注释并修改路由配置：

   ```toml
   # Production environment
   [env.production]
   name = "ip-api-production"
   workers_dev = false
   minify = true

   # 自定义域名路由配置
   routes = [
     { pattern = "api.yourdomain.com/*", zone_name = "yourdomain.com" },
     { pattern = "ip-api.yourdomain.com/*", zone_name = "yourdomain.com" }
   ]
   ```

   **推荐的域名方案：**
   - `api.yourdomain.com` - 通用API子域名
   - `ip-api.yourdomain.com` - 专用IP-API子域名
   - `yourdomain.com/api/*` - 路径方式（需要不同配置）

2. **选择域名方案**

   **方案A：子域名（推荐）**
   ```toml
   routes = [
     { pattern = "api.yourdomain.com/*", zone_name = "yourdomain.com" }
   ]
   ```

   **方案B：多子域名**
   ```toml
   routes = [
     { pattern = "api.yourdomain.com/*", zone_name = "yourdomain.com" },
     { pattern = "ip.yourdomain.com/*", zone_name = "yourdomain.com" }
   ]
   ```

   **方案C：路径路由**
   ```toml
   routes = [
     { pattern = "yourdomain.com/api/*", zone_name = "yourdomain.com" }
   ]
   ```

### 步骤3：DNS记录配置

在Cloudflare DNS设置中添加以下记录：

1. **CNAME记录（推荐）**
   ```
   类型: CNAME
   名称: api
   目标: ip-api-production.axingchen.workers.dev
   代理状态: 已代理（橙色云朵）
   ```

2. **或者A记录**
   ```
   类型: A
   名称: api
   IPv4地址: 192.0.2.1 (Cloudflare代理IP)
   代理状态: 已代理（橙色云朵）
   ```

### 步骤4：部署配置

1. **部署到生产环境**
   ```bash
   wrangler deploy --env production
   ```

2. **验证部署**
   ```bash
   wrangler deployments status --env production
   ```

### 步骤5：测试验证

1. **测试API端点**
   ```bash
   # 测试基本IP查询
   curl https://api.yourdomain.com/

   # 测试地理位置查询
   curl https://api.yourdomain.com/geo

   # 测试特定IP查询
   curl https://api.yourdomain.com/?ip=8.8.8.8
   ```

2. **验证SSL证书**
   ```bash
   # 检查SSL证书
   curl -I https://api.yourdomain.com/
   
   # 应该返回200状态码和安全头
   ```

## 🔧 高级配置

### 多环境域名配置

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
workers_dev = true  # 使用workers.dev域名
```

### 自定义错误页面

在Worker中添加域名特定的错误处理：

```javascript
// src/app.js
app.notFound((c) => {
  const host = c.req.header('host')
  return c.json({
    error: 'Not Found',
    message: 'API endpoint not found',
    host: host,
    timestamp: new Date().toISOString(),
    docs: `https://${host}/docs`
  }, 404)
})
```

## 🛡️ 安全配置

### HTTPS重定向

确保所有HTTP请求重定向到HTTPS：

```javascript
// 在中间件中添加HTTPS检查
app.use('*', async (c, next) => {
  const protocol = c.req.header('x-forwarded-proto') || 'https'
  if (protocol !== 'https') {
    const httpsUrl = `https://${c.req.header('host')}${c.req.path}`
    return c.redirect(httpsUrl, 301)
  }
  await next()
})
```

### CORS配置

更新CORS配置以支持自定义域名：

```javascript
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

### 域名状态检查

```bash
# 检查DNS解析
nslookup api.yourdomain.com

# 检查SSL证书
openssl s_client -connect api.yourdomain.com:443 -servername api.yourdomain.com

# 检查Worker状态
wrangler tail --env production
```

### 性能监控

在Cloudflare Dashboard中监控：
- 请求数量和响应时间
- 错误率和状态码分布
- 地理分布和缓存命中率

## 🚨 故障排除

### 常见问题

1. **域名无法访问**
   - 检查DNS传播状态
   - 验证Cloudflare代理状态
   - 确认Worker路由配置

2. **SSL证书错误**
   - 确保代理状态为"已代理"
   - 检查SSL/TLS设置为"完全"或"完全(严格)"

3. **404错误**
   - 验证路由模式匹配
   - 检查Worker部署状态
   - 确认域名区域配置

### 调试命令

```bash
# 查看Worker日志
wrangler tail --env production

# 检查部署状态
wrangler deployments status --env production

# 测试本地开发
wrangler dev --env development
```

## 📝 配置示例

### 完整的wrangler.toml示例

```toml
name = "ip-api-production"
main = "src/app.js"
compatibility_date = "2024-12-01"
compatibility_flags = ["nodejs_compat"]

workers_dev = false
minify = true

[env.production]
name = "ip-api-production"
workers_dev = false
minify = true

routes = [
  { pattern = "api.yourdomain.com/*", zone_name = "yourdomain.com" }
]

[env.production.vars]
ENVIRONMENT = "production"
WORKER_ENV = "production"
NODE_ENV = "production"
```

## ✅ 完成检查清单

- [ ] 域名已添加到Cloudflare
- [ ] DNS记录已配置
- [ ] wrangler.toml已更新
- [ ] Worker已重新部署
- [ ] 自定义域名可以访问
- [ ] SSL证书正常工作
- [ ] API端点功能正常
- [ ] 安全头配置正确
- [ ] 监控已设置

完成以上步骤后，您的IP-API将通过专业的自定义域名提供服务！
