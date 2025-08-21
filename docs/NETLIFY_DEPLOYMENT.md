# 🚀 Netlify 部署指南

## 📋 概述

本指南将帮助您将IP-API项目部署到Netlify平台，实现全球边缘网络的高性能API服务。

## 🔧 项目配置

### Netlify Edge Functions

项目已配置Netlify Edge Functions支持：

- `netlify/edge-functions/index.js`: Edge Function入口点
- 使用Hono框架的Netlify适配器
- 支持所有HTTP方法
- 兼容Cloudflare Workers API

### 环境配置

项目支持多环境部署：
- **Production**: 生产环境配置
- **Deploy Preview**: 预览环境配置  
- **Branch Deploy**: 分支部署配置

## 🚀 部署步骤

### 方法1: 通过Netlify Web界面部署（推荐）

1. **访问Netlify控制台**
   ```
   https://app.netlify.com/
   ```

2. **导入GitHub项目**
   - 点击 "Add new site" → "Import an existing project"
   - 选择 "Deploy with GitHub"
   - 授权Netlify访问您的GitHub账户
   - 选择仓库：`IIXINGCHEN/ip-api-production`
   - 选择分支：`main` 或 `dev`

3. **构建设置**
   ```
   Build command: npm run build
   Publish directory: public
   Functions directory: netlify/functions
   ```

4. **环境变量配置**
   在 "Site settings" → "Environment variables" 中添加：
   ```bash
   # 必需的API密钥
   API_KEY_ADMIN=your-secure-admin-key-here
   API_KEY_USER=your-secure-user-key-here
   
   # 环境配置
   WORKER_ENV=production
   NODE_ENV=production
   
   # 可选的第三方服务配置
   IPINFO_TOKEN=your-ipinfo-token
   MAXMIND_USER_ID=your-maxmind-user-id
   MAXMIND_LICENSE_KEY=your-maxmind-license-key
   ```

5. **部署**
   - 点击 "Deploy site"
   - Netlify会自动构建和部署

### 方法2: 通过Netlify CLI部署

1. **安装Netlify CLI**
   ```bash
   npm install -g netlify-cli
   ```

2. **登录Netlify**
   ```bash
   netlify login
   ```

3. **初始化项目**
   ```bash
   netlify init
   ```

4. **部署到生产环境**
   ```bash
   npm run deploy:netlify
   ```

5. **部署预览版本**
   ```bash
   npm run deploy:netlify-preview
   ```

## 🔧 配置详情

### Edge Functions配置

项目使用Netlify Edge Functions提供全球低延迟API服务：

```javascript
// netlify/edge-functions/index.js
import app from '../../src/app.js'

export const config = { path: "/*" };

export default async (req, ctx) => {
  // Netlify地理位置数据映射
  const request = new Request(req.url, {
    method: req.method,
    headers: req.headers,
    body: req.body
  })

  // 兼容Cloudflare Workers API
  request.cf = {
    country: ctx.geo?.country?.code,
    region: ctx.geo?.subdivision?.code,
    city: ctx.geo?.city,
    latitude: ctx.geo?.latitude,
    longitude: ctx.geo?.longitude,
    colo: ctx.server?.region || 'netlify'
  }

  return app.fetch(request)
}
```

### 安全配置

项目包含完整的安全配置：

- **安全头部**: HSTS, CSP, XSS保护
- **CORS配置**: 跨域资源共享设置
- **API认证**: 管理端点的API密钥保护
- **输入验证**: 全面的请求参数验证

## 📊 部署后验证

### 基础功能测试

```bash
# 健康检查
curl https://your-site-name.netlify.app/health

# 获取客户端IP信息
curl https://your-site-name.netlify.app/geo

# 查询特定IP
curl https://your-site-name.netlify.app/lookup/8.8.8.8

# 批量查询
curl -X POST https://your-site-name.netlify.app/batch \
  -H "Content-Type: application/json" \
  -d '{"ips":["8.8.8.8","1.1.1.1"]}'
```

### 威胁检测测试

```bash
# 测试威胁检测功能
curl "https://your-site-name.netlify.app/geo?include_threat=true"
```

### 管理接口测试

```bash
# 系统统计（需要API密钥）
curl -H "X-API-Key: your-admin-key" \
  https://your-site-name.netlify.app/admin/stats

# 缓存统计
curl -H "X-API-Key: your-admin-key" \
  https://your-site-name.netlify.app/admin/cache
```

## 🔍 监控和维护

### 内置监控端点

- `/health` - 基础健康检查
- `/admin/health` - 详细系统状态
- `/admin/stats` - 性能指标
- `/admin/cache` - 缓存统计

### 日志和分析

Netlify提供内置的：
- 实时日志查看
- 性能分析
- 错误追踪
- 流量统计

### 自动部署

配置GitHub集成后，每次推送到指定分支都会自动触发部署：
- `main` 分支 → 生产环境
- `dev` 分支 → 预览环境
- Pull Request → 预览部署

## 🚨 故障排除

### 常见问题

1. **构建失败**
   - 检查Node.js版本（推荐18+）
   - 确认所有依赖已正确安装
   - 查看构建日志中的错误信息

2. **环境变量问题**
   - 确认所有必需的环境变量已设置
   - 检查变量名称拼写
   - 重新部署以应用新的环境变量

3. **Edge Function错误**
   - 检查Edge Function日志
   - 确认路由配置正确
   - 验证请求格式

### 性能优化

- 启用Netlify的CDN缓存
- 配置适当的缓存头部
- 使用Edge Functions减少延迟
- 监控响应时间和错误率

## 📞 支持

- **Netlify文档**: https://docs.netlify.com/
- **项目仓库**: https://github.com/IIXINGCHEN/ip-api-production
- **技术支持**: 通过GitHub Issues提交问题

---

**最后更新**: 2025年8月21日
**版本**: 2.0.0
