/**
 * 🔒 SecureLogger — transport 注入测试（候选 2 最小切片）
 *
 * 验证构造器 transport seam：
 * - 不传 transport → 行为完全不变（console 路径，由既有套件覆盖）
 * - 注入 { sink } → 每个 logEntry 写入 sink，测试可断言
 * - 注入 { level } → 覆盖默认 level 来源，过滤行为可注入
 *
 * 本测试不依赖 tests/setup.js 的 global.console patch——sink 是干净的 seam。
 */

import { describe, it, expect } from 'vitest';
import { SecureLogger } from '../../src/utils/secureLogger.js';

describe('SecureLogger — transport 注入', () => {
  it('不传 transport 时 sink 字段为 null（默认行为不变）', () => {
    const logger = new SecureLogger();
    expect(logger.transport).toBeNull();
  });

  it('注入 sink 后 log() 把 logEntry 写入 sink（不依赖 console patch）', () => {
    const records = [];
    const logger = new SecureLogger({ sink: (entry) => records.push(entry) });

    logger.info('hello', { ip: '1.2.3.4' });
    logger.error('boom');

    expect(records).toHaveLength(2);
    expect(records[0].level).toBe('INFO');
    expect(records[0].message).toBe('hello');
    // IP 脱敏仍走 sanitize：'1.2.3.4' → '1.2.3.***'
    expect(records[0].data.ip).toBe('1.2.3.***');
    expect(records[1].level).toBe('ERROR');
    expect(records[1].message).toBe('boom');
  });

  it('注入 level 覆盖默认 level 来源（debug 默认开发环境会记，注入 error 后只记 error）', () => {
    const records = [];
    // 默认（无 transport）在 vitest 跑（NODE_ENV=test，但 getCurrentConfig 用 ENVIRONMENT.current，
    // 测试环境通常是 'development' → level 'debug' → info 会记）。
    const logger = new SecureLogger({ level: 'error', sink: (entry) => records.push(entry) });

    logger.info('should be filtered out');
    logger.error('should pass');

    expect(records).toHaveLength(1);
    expect(records[0].message).toBe('should pass');
  });

  it('debug 级别被注入 error level 过滤时不写入 sink', () => {
    const records = [];
    const logger = new SecureLogger({ level: 'error', sink: (entry) => records.push(entry) });

    logger.debug('hidden');

    expect(records).toHaveLength(0);
  });

  it('security() 在 transport 注入时也写 sink（除 console.error 外加一条 SECURITY_EVENT）', () => {
    const records = [];
    const logger = new SecureLogger({ sink: (entry) => records.push(entry) });

    logger.security('auth_failure', { ip: '9.9.9.9' });

    // security() 在非生产走 this.error → this.log → sink
    // 生产走 console.error(JSON.stringify(...))，不走 sink
    // vitest 是非生产环境，应走 sink
    expect(records.length).toBeGreaterThanOrEqual(1);
  });

  it('performance() 在 configManager 未初始化时不抛错，默认启用记录', () => {
    // m1 回归：config.get 在未初始化时 throw，performance 必须 try/catch 兜底为默认启用。
    // 本测试文件不调 configManager.initialize()，故 configManager.isInitialized===false，
    // config.get 必然抛错——正好触发 try/catch 路径。
    const records = [];
    const logger = new SecureLogger({ sink: (entry) => records.push(entry) });

    expect(() => {
      logger.performance('test_op', 42);
    }).not.toThrow();

    // 默认启用 → 应写入 sink
    expect(records.length).toBeGreaterThanOrEqual(1);
    expect(records[0].message).toBe('Performance: test_op');
  });
});
