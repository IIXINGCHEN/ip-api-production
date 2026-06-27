# 🧪 测试文档

这个项目使用 Vitest 作为测试框架，提供了全面的测试套件来确保代码质量和安全性。

## 📋 测试结构

```
tests/
├── setup.js                 # 测试环境设置和工具函数
├── unit/                    # 单元测试
│   └── ipService.test.js    # IP服务单元测试
├── integration/             # 集成测试
│   └── api.test.js          # API端点集成测试
├── security/                # 安全测试
│   ├── threatService.test.js # 威胁检测安全测试
│   └── secureCache.test.js  # 安全缓存测试
└── README.md               # 本文档
```

## 🚀 运行测试

### 基础测试命令

```bash
# 运行所有测试
npm test

# 运行测试（单次）
npm run test:run

# 监视模式运行测试
npm run test:watch

# 生成覆盖率报告
npm run test:coverage

# 运行安全相关测试
npm run test:security
```

### Vitest 直接命令

```bash
# 运行所有测试
npx vitest

# 运行特定测试文件
npx vitest tests/unit/ipService.test.js

# 运行匹配模式的测试
npx vitest --grep "IPService"

# 生成覆盖率报告
npx vitest run --coverage
```

## 📊 测试类型

### 1. 单元测试 (`tests/unit/`)
- **IP服务测试**: 测试IP地址解析、验证和分类功能
- **工具函数测试**: 测试各种辅助函数的正确性

### 2. 集成测试 (`tests/integration/`)
- **API端点测试**: 测试完整的HTTP请求/响应流程
- **路由测试**: 验证所有API端点的功能
- **错误处理测试**: 测试各种错误情况的处理

### 3. 安全测试 (`tests/security/`)
- **威胁检测测试**: 验证威胁检测系统的准确性
- **白名单测试**: 确保合法服务不被误报
- **缓存安全测试**: 测试加密和完整性验证
- **边界情况测试**: 测试各种安全边界情况

## 🔧 测试配置

### Vitest 配置 (`vitest.config.js`)

```javascript
export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    coverage: {
      provider: 'v8',
      thresholds: {
        global: {
          branches: 70,
          functions: 70,
          lines: 70,
          statements: 70
        }
      }
    }
  }
});
```

### 环境设置 (`tests/setup.js`)

- **模拟对象**: 模拟 Cloudflare Workers 环境
- **测试工具**: 提供创建模拟请求和响应的函数
- **测试数据**: 预定义的测试IP地址和威胁检测用例
- **清理函数**: 确保测试间的隔离

## 📈 覆盖率报告

运行 `npm run test:coverage` 后，覆盖率报告将生成在：

- **终端输出**: 简要的覆盖率统计
- **HTML报告**: `coverage/index.html` - 详细的交互式报告
- **JSON报告**: `coverage/coverage-final.json` - 机器可读格式

### 覆盖率目标

- **分支覆盖率**: ≥ 70%
- **函数覆盖率**: ≥ 70%
- **行覆盖率**: ≥ 70%
- **语句覆盖率**: ≥ 70%

## 🛡️ 安全测试重点

### 威胁检测测试
- **误报减少**: 验证白名单功能正确减少误报
- **检测准确性**: 确保真正的威胁能被检测到
- **边界情况**: 测试各种边缘和特殊情况

### 缓存安全测试
- **数据加密**: 验证生产环境中的数据加密
- **完整性验证**: 确保数据篡改能被检测到
- **内存安全**: 防止内存泄漏和溢出

### API安全测试
- **输入验证**: 测试各种恶意输入的处理
- **头部安全**: 验证安全头部的设置
- **错误处理**: 确保错误信息不泄露敏感信息

## 📝 测试用例示例

### 基础单元测试
```javascript
it('应该正确解析有效的IPv4地址', async () => {
  const ip = '192.168.1.100';
  const result = await ipService.getIPInfo(ip, mockRequest);

  expect(result.ip).toBe(ip);
  expect(result.type).toBe('ipv4');
  expect(result.isPrivate).toBe(true);
});
```

### 安全测试用例
```javascript
it('应该正确排除合法ISP的VPN检测', async () => {
  const result = await threatService.checkVPN(testIPs.legitimateISP, request);
  expect(result.detected).toBe(false);
  expect(result.riskScore).toBe(0);
  expect(result.indicators).toContain('legitimate_isp');
});
```

### 集成测试用例
```javascript
it('应该返回客户端IP信息', async () => {
  const request = createMockRequest('/', {
    headers: { 'x-forwarded-for': testIPs.legitimateISP }
  });

  const response = await app.fetch(request);
  expect(response.status).toBe(200);

  const data = await response.json();
  expect(data.ip).toBe(testIPs.legitimateISP);
});
```

## 🔍 调试测试

### 调试模式
```bash
# 启用调试输出
npx vitest --reporter=verbose

# 调试特定测试
npx vitest --grep "特定测试名称" --reporter=verbose
```

### 测试断点
在 VS Code 中，可以在 `.vscode/launch.json` 中添加：

```json
{
  "type": "node",
  "request": "launch",
  "name": "Debug Vitest",
  "skipFiles": ["<node_internals>/**"],
  "program": "${workspaceFolder}/node_modules/vitest/vitest.mjs",
  "args": ["run", "--reporter=verbose", "tests/unit/ipService.test.js"],
  "console": "integratedTerminal"
}
```

## 🚨 CI/CD 集成

### GitHub Actions 示例
```yaml
- name: Run Tests
  run: npm run test:coverage

- name: Upload Coverage
  uses: codecov/codecov-action@v3
  with:
    file: ./coverage/lcov.info
```

## 📋 测试清单

在提交代码前，确保：

- [ ] 所有单元测试通过
- [ ] 所有集成测试通过
- [ ] 所有安全测试通过
- [ ] 覆盖率达到目标阈值
- [ ] 没有内存泄漏
- [ ] 边界情况都被测试
- [ ] 错误处理完整

## 🔧 故障排除

### 常见问题

1. **测试环境变量缺失**
   ```bash
   export NODE_ENV=test
   ```

2. **端口冲突**
   ```bash
   npx vitest --port 3001
   ```

3. **内存不足**
   ```bash
   node --max-old-space-size=4096 node_modules/vitest/vitest.mjs
   ```

4. **权限问题**
   ```bash
   chmod +x node_modules/.bin/vitest
   ```

## 📚 相关资源

- [Vitest 官方文档](https://vitest.dev/)
- [JavaScript 测试最佳实践](https://github.com/goldbergyoni/javascript-testing-best-practices)
- [安全测试指南](https://owasp.org/www-project-web-security-testing-guide/)

---

🧪 **持续测试，持续改进！**