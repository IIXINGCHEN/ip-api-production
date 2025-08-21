# 🚀 生产环境部署检查清单

## 📋 部署前必检项目

### ✅ 代码质量检查

- [ ] **移除所有模拟数据**
  - MaxMind提供商已实现真实API调用
  - 威胁检测使用真实数据源
  - 缓存系统支持生产环境存储

- [ ] **错误处理完整性**
  - 所有catch块变量名一致
  - 异常情况全覆盖
  - 错误信息不泄露敏感信息

- [ ] **数据验证和清理**
  - IP地址验证完整
  - 地理位置数据标准化
  - 输入参数安全过滤

### 🔒 安全配置检查

- [ ] **环境变量配置**
  ```bash
  # 必需的环境变量
  API_KEY_ADMIN=your-admin-key
  WORKER_ENV=production
  
  # 可选但推荐的环境变量
  IPINFO_TOKEN=your-ipinfo-token
  MAXMIND_USER_ID=your-maxmind-user
  MAXMIND_LICENSE_KEY=your-maxmind-key
  ```

- [ ] **CORS配置**
  - 生产域名已添加到白名单
  - 移除开发环境域名
  - 禁用通配符(*)

- [ ] **安全头部**
  - Content-Security-Policy已配置
  - X-Frame-Options设置为DENY
  - Strict-Transport-Security已启用

### 📊 性能和监控

- [ ] **缓存配置**
  - Cloudflare KV或Redis已配置
  - TTL值适合生产环境
  - 缓存键命名规范

- [ ] **限流设置**
  - 生产环境限流值已调整
  - IP白名单已配置
  - 监控阈值已设置

- [ ] **日志配置**
  - 日志级别设置为error或warn
  - 敏感数据不记录到日志
  - 结构化日志格式

### 🔧 第三方服务集成

- [ ] **MaxMind GeoIP2**
  - 用户ID和许可证密钥已配置
  - API端点URL正确
  - 错误处理和重试机制

- [ ] **IPInfo服务**
  - API令牌已配置（可选）
  - 请求限制已了解
  - 降级策略已实现

- [ ] **威胁检测**
  - 威胁情报源已配置
  - 检测规则已更新
  - 误报率已测试

## 🧪 部署前测试

### 运行验证脚本
```bash
# 运行生产环境验证
npm run validate:production

# 运行完整测试套件
npm run test

# 代码质量检查
npm run lint
npm run format:check
```

### 手动测试检查点

1. **基础功能测试**
   ```bash
   # 测试当前IP查询
   curl https://your-domain.com/geo
   
   # 测试特定IP查询
   curl https://your-domain.com/lookup/8.8.8.8
   
   # 测试批量查询
   curl -X POST https://your-domain.com/batch \
     -H "Content-Type: application/json" \
     -d '{"ips":["8.8.8.8","1.1.1.1"]}'
   ```

2. **威胁检测测试**
   ```bash
   # 测试威胁检测
   curl "https://your-domain.com/geo?include_threat=true"
   ```

3. **错误处理测试**
   ```bash
   # 测试无效IP
   curl https://your-domain.com/lookup/invalid-ip
   
   # 测试限流
   # (快速发送多个请求)
   ```

4. **性能测试**
   - 响应时间 < 1秒
   - 并发请求处理正常
   - 内存使用稳定

## 📈 监控和告警

### 关键指标监控

- [ ] **响应时间监控**
  - 平均响应时间 < 500ms
  - 95%响应时间 < 1000ms
  - 超时率 < 1%

- [ ] **错误率监控**
  - 4xx错误率 < 5%
  - 5xx错误率 < 1%
  - 第三方API失败率监控

- [ ] **资源使用监控**
  - CPU使用率 < 80%
  - 内存使用率 < 80%
  - 缓存命中率 > 70%

### 告警配置

- [ ] **响应时间告警**
  - 阈值：1000ms
  - 持续时间：5分钟

- [ ] **错误率告警**
  - 阈值：5%
  - 持续时间：2分钟

- [ ] **第三方服务告警**
  - API调用失败率 > 10%
  - 配额使用率 > 90%

## 🔄 部署后验证

### 立即检查（部署后5分钟内）

- [ ] 健康检查端点响应正常
- [ ] 基础API功能正常
- [ ] 错误日志无异常
- [ ] 监控指标正常

### 短期监控（部署后1小时内）

- [ ] 响应时间稳定
- [ ] 错误率在正常范围
- [ ] 缓存工作正常
- [ ] 第三方API调用成功

### 长期观察（部署后24小时内）

- [ ] 性能指标趋势正常
- [ ] 无内存泄漏
- [ ] 威胁检测准确性
- [ ] 用户反馈正常

## 🚨 回滚计划

### 回滚触发条件

- 错误率 > 10%
- 响应时间 > 2000ms
- 第三方API完全失败
- 安全漏洞发现

### 回滚步骤

1. 立即切换到上一个稳定版本
2. 验证回滚后功能正常
3. 分析问题原因
4. 修复后重新部署

## 📞 紧急联系

- **技术负责人**: [联系方式]
- **运维团队**: [联系方式]
- **第三方服务支持**: 
  - MaxMind: support@maxmind.com
  - IPInfo: support@ipinfo.io

---

**最后更新**: 2024年8月21日
**版本**: 2.0.0
