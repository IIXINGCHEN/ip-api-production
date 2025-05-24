#!/usr/bin/env node

/**
 * 自动化域名配置脚本
 * 帮助快速配置IP-API的自定义域名
 */

import { readFileSync, writeFileSync } from 'fs'
import { execSync } from 'child_process'
import readline from 'readline'

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
})

function question(prompt) {
  return new Promise((resolve) => {
    rl.question(prompt, resolve)
  })
}

async function main() {
  console.log('🌐 IP-API 自定义域名配置工具\n')

  try {
    // 获取用户输入
    const domain = await question('请输入您的域名 (例如: yourdomain.com): ')
    const subdomain = await question('请输入子域名 (例如: api, 留空使用 api): ') || 'api'
    
    const fullDomain = `${subdomain}.${domain}`
    
    console.log(`\n配置信息:`)
    console.log(`- 主域名: ${domain}`)
    console.log(`- 完整API域名: ${fullDomain}`)
    
    const confirm = await question('\n确认配置? (y/N): ')
    if (confirm.toLowerCase() !== 'y') {
      console.log('配置已取消')
      process.exit(0)
    }

    // 更新 wrangler.toml
    console.log('\n📝 更新 wrangler.toml 配置...')
    updateWranglerConfig(domain, subdomain)

    // 显示DNS配置指引
    console.log('\n🔧 DNS 配置指引:')
    showDNSInstructions(domain, subdomain)

    // 显示部署指引
    console.log('\n🚀 部署指引:')
    showDeploymentInstructions()

    // 显示测试指引
    console.log('\n🧪 测试指引:')
    showTestingInstructions(fullDomain)

  } catch (error) {
    console.error('❌ 配置过程中出现错误:', error.message)
    process.exit(1)
  } finally {
    rl.close()
  }
}

function updateWranglerConfig(domain, subdomain) {
  try {
    const configPath = 'wrangler.toml'
    let config = readFileSync(configPath, 'utf8')

    // 查找并替换路由配置
    const routePattern = /# routes = \[\s*#[^#]*#\s*\]/s
    const newRoutes = `routes = [
  { pattern = "${subdomain}.${domain}/*", zone_name = "${domain}" }
]`

    if (routePattern.test(config)) {
      config = config.replace(routePattern, newRoutes)
    } else {
      // 如果没找到注释的路由，在production环境后添加
      const productionPattern = /(\[env\.production\]\s*name = "ip-api-production"\s*workers_dev = false\s*minify = true)/
      if (productionPattern.test(config)) {
        config = config.replace(productionPattern, `$1\n\n${newRoutes}`)
      }
    }

    writeFileSync(configPath, config)
    console.log('✅ wrangler.toml 已更新')
  } catch (error) {
    console.error('❌ 更新 wrangler.toml 失败:', error.message)
    throw error
  }
}

function showDNSInstructions(domain, subdomain) {
  console.log(`
请在 Cloudflare DNS 设置中添加以下记录:

📋 DNS 记录配置:
┌─────────────────────────────────────────────────────────┐
│ 类型: CNAME                                             │
│ 名称: ${subdomain.padEnd(20)}                           │
│ 目标: ip-api-production.axingchen.workers.dev          │
│ 代理状态: 已代理 (🟠 橙色云朵)                          │
└─────────────────────────────────────────────────────────┘

🔗 Cloudflare Dashboard: https://dash.cloudflare.com/
1. 选择域名: ${domain}
2. 进入 DNS 设置
3. 添加上述 CNAME 记录
4. 确保代理状态为"已代理"`)
}

function showDeploymentInstructions() {
  console.log(`
🚀 部署步骤:

1. 部署到生产环境:
   npm run deploy:production
   # 或
   wrangler deploy --env production

2. 验证部署状态:
   wrangler deployments status --env production

3. 检查Worker日志:
   wrangler tail --env production`)
}

function showTestingInstructions(fullDomain) {
  console.log(`
🧪 测试API端点:

1. 基本IP查询:
   curl https://${fullDomain}/

2. 地理位置查询:
   curl https://${fullDomain}/geo

3. 指定IP查询:
   curl https://${fullDomain}/?ip=8.8.8.8

4. 威胁检测查询:
   curl https://${fullDomain}/?ip=8.8.8.8&include_threat=true

5. SSL证书检查:
   curl -I https://${fullDomain}/

📊 预期响应格式:
{
  "ip": "8.8.8.8",
  "country": "United States",
  "countryCode": "US",
  "region": "California",
  "city": "Mountain View",
  "latitude": 37.4056,
  "longitude": -122.0775,
  "timezone": "America/Los_Angeles",
  "isp": "Google LLC",
  "requestId": "uuid-random-timestamp",
  "timestamp": "2024-12-19T...",
  "version": 6,
  "type": "public"
}`)
}

// 检查是否有必要的工具
function checkPrerequisites() {
  try {
    execSync('wrangler --version', { stdio: 'ignore' })
  } catch (error) {
    console.error('❌ 请先安装 Wrangler CLI: npm install -g wrangler')
    process.exit(1)
  }

  try {
    execSync('wrangler whoami', { stdio: 'ignore' })
  } catch (error) {
    console.error('❌ 请先登录 Cloudflare: wrangler login')
    process.exit(1)
  }
}

// 运行脚本
if (import.meta.url === `file://${process.argv[1]}`) {
  checkPrerequisites()
  main().catch(console.error)
}

export { updateWranglerConfig, showDNSInstructions, showDeploymentInstructions, showTestingInstructions }
