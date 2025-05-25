# 🚀 Vercel 部署指南

## 📋 概述

本指南将帮助您将IP-API项目部署到Vercel平台，实现全球边缘网络的高性能API服务。

## 🔧 配置文件说明

### vercel.json 配置

项目已包含完整的 `vercel.json` 配置文件，包含以下功能：

- ✅ **路由配置**: 自动路由到正确的API端点
- ✅ **安全头**: 完整的安全头配置
- ✅ **缓存策略**: 针对不同端点的优化缓存
- ✅ **CORS配置**: 跨域资源共享设置
- ✅ **重定向规则**: 文档和GitHub链接重定向
- ✅ **环境变量**: 生产环境配置

### API入口文件

- `api/index.js`: Vercel serverless函数入口点
- 使用Hono的Vercel适配器
- 支持所有HTTP方法

## 🚀 部署步骤

### 方法1: 通过Vercel CLI部署

1. **安装Vercel CLI**
   ```bash
   npm install -g vercel
   ```

2. **登录Vercel**
   ```bash
   vercel login
   ```

3. **部署到生产环境**
   ```bash
   npm run deploy:vercel
   ```

4. **部署预览版本**
   ```bash
   npm run deploy:vercel-preview
   ```

### 方法2: 通过GitHub集成部署

1. **连接GitHub仓库**
   - 访问 [Vercel Dashboard](https://vercel.com/dashboard)
   - 点击 "New Project"
   - 选择GitHub仓库: `IIXINGCHEN/ip-api-production`

2. **配置项目设置**
   ```
   Framework Preset: Other
   Build Command: npm run build
   Output Directory: (留空)
   Install Command: npm install
   Development Command: npm run dev
   ```

3. **设置环境变量**
   在Vercel Dashboard中添加以下环境变量：
   ```
   ENVIRONMENT=production
   WORKER_ENV=vercel
   NODE_ENV=production
   IPINFO_TOKEN=your_token_here
   MAXMIND_USER_ID=your_user_id_here
   MAXMIND_LICENSE_KEY=your_license_key_here
   API_KEY_ADMIN=your_admin_key_here
   API_KEY_USER=your_user_key_here
   ```

4. **部署**
   - 点击 "Deploy" 开始部署
   - 等待部署完成

## 🌐 自定义域名配置

### 添加自定义域名

1. **在Vercel Dashboard中**
   - 进入项目设置
   - 点击 "Domains" 选项卡
   - 添加您的域名

2. **DNS配置**
   ```
   类型: CNAME
   名称: api (或您选择的子域名)
   目标: cname.vercel-dns.com
   ```

3. **SSL证书**
   - Vercel自动提供SSL证书
   - 支持自动续期

### 域名示例配置

```json
{
  "domains": [
    "api.yourdomain.com",
    "ip-api.yourdomain.com"
  ]
}
```

## 📊 性能优化

### 缓存策略

```json
{
  "headers": [
    {
      "source": "/",
      "headers": [
        {
          "key": "Cache-Control",
          "value": "public, max-age=300, s-maxage=600"
        }
      ]
    }
  ]
}
```

### 边缘函数配置

```json
{
  "functions": {
    "api/index.js": {
      "runtime": "nodejs20.x",
      "maxDuration": 30,
      "memory": 1024,
      "regions": ["all"]
    }
  }
}
```

## 🛡️ 安全配置

### 环境变量安全

- 所有敏感信息通过Vercel环境变量管理
- 生产环境自动隐藏调试信息
- API密钥加密存储

### 安全头配置

```json
{
  "headers": [
    {
      "key": "Strict-Transport-Security",
      "value": "max-age=31536000; includeSubDomains"
    },
    {
      "key": "X-Content-Type-Options",
      "value": "nosniff"
    },
    {
      "key": "X-Frame-Options",
      "value": "DENY"
    }
  ]
}
```

## 🧪 测试部署

### 基本功能测试

```bash
# 替换为您的Vercel域名
VERCEL_URL="your-project.vercel.app"

# 测试基本IP查询
curl https://$VERCEL_URL/

# 测试地理位置查询
curl https://$VERCEL_URL/geo

# 测试指定IP查询
curl https://$VERCEL_URL/?ip=8.8.8.8

# 测试健康检查
curl https://$VERCEL_URL/health
```

### 性能测试

```bash
# 响应时间测试
curl -w "@curl-format.txt" -o /dev/null -s https://$VERCEL_URL/

# 并发测试
ab -n 100 -c 10 https://$VERCEL_URL/
```

## 📈 监控和分析

### Vercel Analytics

1. **启用Analytics**
   - 在项目设置中启用Analytics
   - 查看请求量、响应时间等指标

2. **性能监控**
   - 函数执行时间
   - 内存使用情况
   - 错误率统计

### 日志查看

```bash
# 查看实时日志
vercel logs your-project.vercel.app

# 查看函数日志
vercel logs your-project.vercel.app --follow
```

## 🚨 故障排除

### 常见问题

1. **部署失败**
   ```bash
   # 检查构建日志
   vercel logs your-project.vercel.app --since=1h
   
   # 本地测试
   vercel dev
   ```

2. **函数超时**
   - 检查 `maxDuration` 设置
   - 优化API调用逻辑
   - 使用缓存减少处理时间

3. **环境变量问题**
   ```bash
   # 列出环境变量
   vercel env ls
   
   # 添加环境变量
   vercel env add VARIABLE_NAME
   ```

### 调试工具

```bash
# 本地开发服务器
vercel dev

# 检查配置
vercel inspect

# 查看项目信息
vercel ls
```

## 📝 部署检查清单

- [ ] vercel.json 配置文件已创建
- [ ] api/index.js 入口文件已创建
- [ ] package.json 脚本已更新
- [ ] 环境变量已设置
- [ ] 项目已连接到GitHub
- [ ] 自定义域名已配置（可选）
- [ ] SSL证书已启用
- [ ] 基本功能测试通过
- [ ] 性能测试满足要求
- [ ] 监控已启用

## 🎯 最佳实践

1. **版本控制**
   - 使用Git标签管理版本
   - 配置自动部署触发器

2. **环境分离**
   - 生产环境使用独立配置
   - 测试环境使用预览部署

3. **性能优化**
   - 启用边缘缓存
   - 优化函数冷启动时间
   - 使用适当的内存配置

4. **安全措施**
   - 定期更新依赖
   - 监控安全漏洞
   - 使用环境变量管理密钥

## 🎉 部署完成

部署完成后，您的IP-API将通过Vercel的全球边缘网络提供服务，具备：

- ⚡ 极低延迟响应
- 🌍 全球CDN加速
- 🔒 自动SSL证书
- 📊 详细分析数据
- 🛡️ 企业级安全

访问您的API：`https://your-project.vercel.app/`

祝您部署成功！🚀
