#!/usr/bin/env node

/**
 * Production Environment Validation Script
 * 验证生产环境配置和代码质量
 */

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '..');

class ProductionValidator {
  constructor() {
    this.errors = [];
    this.warnings = [];
    this.passed = [];
  }

  log(level, message, details = null) {
    const timestamp = new Date().toISOString();
    const logEntry = { timestamp, level, message, details };
    
    switch (level) {
      case 'ERROR':
        this.errors.push(logEntry);
        console.error(`❌ [${timestamp}] ERROR: ${message}`);
        break;
      case 'WARNING':
        this.warnings.push(logEntry);
        console.warn(`⚠️  [${timestamp}] WARNING: ${message}`);
        break;
      case 'PASS':
        this.passed.push(logEntry);
        console.log(`✅ [${timestamp}] PASS: ${message}`);
        break;
      case 'INFO':
        console.log(`ℹ️  [${timestamp}] INFO: ${message}`);
        break;
    }
    
    if (details) {
      console.log(`   Details: ${JSON.stringify(details, null, 2)}`);
    }
  }

  async validateCodeQuality() {
    this.log('INFO', '开始代码质量检查...');

    // 检查是否存在模拟数据
    await this.checkForMockData();
    
    // 检查错误处理
    await this.checkErrorHandling();
    
    // 检查配置完整性
    await this.checkConfiguration();
    
    // 检查安全实现
    await this.checkSecurity();
    
    // 检查数据验证
    await this.checkDataValidation();
  }

  async checkForMockData() {
    this.log('INFO', '检查模拟数据和不完整实现...');
    
    const filesToCheck = [
      'src/providers/maxmind.js',
      'src/services/threatService.js',
      'src/services/geoService.js'
    ];

    for (const file of filesToCheck) {
      const filePath = join(projectRoot, file);
      if (existsSync(filePath)) {
        const content = readFileSync(filePath, 'utf8');
        
        // 检查模拟数据关键词
        const mockPatterns = [
          /simulate\w*Response/gi,
          /mock\w*Data/gi,
          /fake\w*Data/gi,
          /placeholder\w*Data/gi,
          /\/\/ TODO.*production/gi,
          /\/\/ In production.*would/gi
        ];

        let hasMockData = false;
        for (const pattern of mockPatterns) {
          if (pattern.test(content)) {
            hasMockData = true;
            this.log('ERROR', `发现模拟数据或不完整实现`, { 
              file, 
              pattern: pattern.toString() 
            });
          }
        }

        if (!hasMockData) {
          this.log('PASS', `无模拟数据`, { file });
        }
      }
    }
  }

  async checkErrorHandling() {
    this.log('INFO', '检查错误处理完整性...');
    
    const filesToCheck = [
      'src/middleware/monitoring.js',
      'src/services/ipService.js',
      'src/services/threatService.js',
      'src/utils/performance.js'
    ];

    for (const file of filesToCheck) {
      const filePath = join(projectRoot, file);
      if (existsSync(filePath)) {
        const content = readFileSync(filePath, 'utf8');
        
        // 检查错误变量名问题
        const errorPatterns = [
          /catch\s*\(\s*_error\s*\)[\s\S]*?throw\s+error/g,
          /catch\s*\(\s*_\w+\s*\)[\s\S]*?throw\s+\w+(?!_)/g
        ];

        let hasErrorIssues = false;
        for (const pattern of errorPatterns) {
          if (pattern.test(content)) {
            hasErrorIssues = true;
            this.log('ERROR', `错误处理变量名不一致`, { 
              file, 
              issue: '使用了_error但引用了error' 
            });
          }
        }

        if (!hasErrorIssues) {
          this.log('PASS', `错误处理正确`, { file });
        }
      }
    }
  }

  async checkConfiguration() {
    this.log('INFO', '检查配置完整性...');
    
    try {
      // 动态导入配置模块
      const { validateEnvironment, ENVIRONMENT } = await import('../src/config/environment.js');
      
      const validation = validateEnvironment();
      
      if (validation.valid) {
        this.log('PASS', '环境配置验证通过');
      } else {
        this.log('ERROR', '环境配置验证失败', { 
          errors: validation.errors 
        });
      }

      if (validation.warnings && validation.warnings.length > 0) {
        this.log('WARNING', '环境配置警告', { 
          warnings: validation.warnings 
        });
      }

    } catch (error) {
      this.log('ERROR', '无法验证环境配置', { 
        error: error.message 
      });
    }
  }

  async checkSecurity() {
    this.log('INFO', '检查安全实现...');
    
    try {
      // 检查安全配置
      const securityConfigPath = join(projectRoot, 'src/config/security.js');
      if (existsSync(securityConfigPath)) {
        const content = readFileSync(securityConfigPath, 'utf8');
        
        // 检查是否有硬编码的密钥
        if (content.includes('your-secret-key') || content.includes('changeme')) {
          this.log('ERROR', '发现硬编码的默认密钥');
        } else {
          this.log('PASS', '无硬编码密钥');
        }
      }

      // 检查威胁检测规则
      const threatRulesPath = join(projectRoot, 'src/config/threatRules.js');
      if (existsSync(threatRulesPath)) {
        this.log('PASS', '威胁检测规则文件存在');
      } else {
        this.log('ERROR', '威胁检测规则文件缺失');
      }

    } catch (error) {
      this.log('ERROR', '安全检查失败', { error: error.message });
    }
  }

  async checkDataValidation() {
    this.log('INFO', '检查数据验证实现...');
    
    const validationFiles = [
      'src/utils/ipValidation.js',
      'src/utils/validation.js',
      'src/services/geoService.js'
    ];

    for (const file of validationFiles) {
      const filePath = join(projectRoot, file);
      if (existsSync(filePath)) {
        const content = readFileSync(filePath, 'utf8');
        
        // 检查是否有数据验证函数
        if (content.includes('validate') || content.includes('sanitize')) {
          this.log('PASS', `数据验证实现存在`, { file });
        } else {
          this.log('WARNING', `缺少数据验证函数`, { file });
        }
      } else {
        this.log('WARNING', `验证文件不存在`, { file });
      }
    }
  }

  generateReport() {
    const total = this.errors.length + this.warnings.length + this.passed.length;
    const score = total > 0 ? Math.round((this.passed.length / total) * 100) : 0;
    
    console.log('\n' + '='.repeat(60));
    console.log('🔍 生产环境验证报告');
    console.log('='.repeat(60));
    console.log(`📊 总体评分: ${score}%`);
    console.log(`✅ 通过检查: ${this.passed.length}`);
    console.log(`⚠️  警告: ${this.warnings.length}`);
    console.log(`❌ 错误: ${this.errors.length}`);
    console.log('='.repeat(60));

    if (this.errors.length > 0) {
      console.log('\n❌ 严重问题需要修复:');
      this.errors.forEach((error, index) => {
        console.log(`${index + 1}. ${error.message}`);
        if (error.details) {
          console.log(`   ${JSON.stringify(error.details)}`);
        }
      });
    }

    if (this.warnings.length > 0) {
      console.log('\n⚠️  建议改进:');
      this.warnings.forEach((warning, index) => {
        console.log(`${index + 1}. ${warning.message}`);
      });
    }

    console.log('\n' + '='.repeat(60));
    
    if (this.errors.length === 0) {
      console.log('🎉 恭喜！代码已准备好用于生产环境');
      return true;
    } else {
      console.log('🚫 请修复所有错误后再部署到生产环境');
      return false;
    }
  }
}

// 运行验证
async function main() {
  console.log('🚀 开始生产环境验证...\n');
  
  const validator = new ProductionValidator();
  await validator.validateCodeQuality();
  
  const isReady = validator.generateReport();
  process.exit(isReady ? 0 : 1);
}

main().catch(error => {
  console.error('验证过程发生错误:', error);
  process.exit(1);
});
