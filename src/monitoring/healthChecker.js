/**
 * 🏥 健康检查器（从 monitoringService.js 拆分）
 * 注册并执行命名健康检查，支持超时与 critical 标记。
 */

export class HealthChecker {
  constructor() {
    this.checks = new Map();
    this.lastResults = new Map();
  }

  register(name, checkFn, options = {}) {
    this.checks.set(name, {
      fn: checkFn,
      timeout: options.timeout || 5000,
      critical: options.critical || false,
      enabled: options.enabled !== false
    });
  }

  async check(name) {
    const check = this.checks.get(name);
    if (!check || !check.enabled) {
      return { name, status: 'skipped', message: 'Check not enabled' };
    }

    const startTime = Date.now();
    let timeoutId = null;

    try {
      let timeoutPromise;
      if (typeof setTimeout !== 'undefined') {
        timeoutPromise = new Promise((_, reject) => {
          timeoutId = setTimeout(() => reject(new Error('Health check timeout')), check.timeout);
        });
      } else {
        // Cloudflare Workers：无 setTimeout，直接运行检查
        timeoutPromise = new Promise(() => {});
      }

      const result = await Promise.race([check.fn(), timeoutPromise]);

      const duration = Math.max(1, Date.now() - startTime);
      const healthResult = {
        name,
        status: result.healthy ? 'healthy' : 'unhealthy',
        message: result.message || (result.healthy ? 'OK' : 'Check failed'),
        duration,
        critical: check.critical,
        timestamp: new Date().toISOString(),
        details: result.details || {}
      };

      this.lastResults.set(name, healthResult);
      return healthResult;
    } catch (error) {
      const duration = Math.max(1, Date.now() - startTime);
      const healthResult = {
        name,
        status: 'unhealthy',
        message: 'Health check failed',
        duration,
        critical: check.critical,
        timestamp: new Date().toISOString(),
        error: error.stack
      };
      this.lastResults.set(name, healthResult);
      return healthResult;
    } finally {
      // race 结束后清理超时定时器，避免每次检查泄漏一个未取消的 timer
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
      }
    }
  }

  async checkAll() {
    const results = {};
    const promises = [];

    for (const name of this.checks.keys()) {
      promises.push(
        this.check(name).then((result) => {
          results[name] = result;
        }).catch((error) => {
          results[name] = {
            status: 'error',
            message: error.message,
            timestamp: new Date().toISOString()
          };
        })
      );
    }

    await Promise.all(promises);
    return results;
  }

  getOverallHealth(results) {
    const checks = Object.values(results);

    if (checks.length === 0) {
      return { status: 'unknown', message: 'No health checks configured' };
    }

    const criticalFailures = checks.filter((c) => c.status === 'unhealthy' && c.critical);
    const failures = checks.filter((c) => c.status === 'unhealthy');
    const healthy = checks.filter((c) => c.status === 'healthy');

    if (criticalFailures.length > 0) {
      return {
        status: 'critical',
        message: `${criticalFailures.length} critical health check(s) failed`,
        failedChecks: criticalFailures.map((c) => c.name)
      };
    }

    if (failures.length > 0) {
      return {
        status: 'unhealthy',
        message: `${failures.length} health check(s) failed`,
        failedChecks: failures.map((c) => c.name)
      };
    }

    return {
      status: 'healthy',
      message: `All ${healthy.length} health checks passed`
    };
  }

  getLastResult(name) {
    return this.lastResults.get(name);
  }

  getAllLastResults() {
    return Object.fromEntries(this.lastResults);
  }
}

export default HealthChecker;
