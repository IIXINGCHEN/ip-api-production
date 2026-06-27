/**
 * 🚨 告警管理器（从 monitoringService.js 拆分）
 * 规则评估、告警生命周期、历史与通知。
 */

export class AlertManager {
  constructor() {
    this.alerts = [];
    this.alertRules = new Map();
    this.alertHistory = [];
    this.maxHistory = 1000;
    this.enabled = true; // MonitoringService.start() 会按配置覆盖
  }

  addRule(name, rule) {
    this.alertRules.set(name, rule);
  }

  checkAlerts(metrics) {
    if (!this.enabled) return [];

    const alerts = [];

    for (const [name, rule] of this.alertRules) {
      try {
        const shouldAlert = this.evaluateRule(rule, metrics);

        if (shouldAlert) {
          const alert = {
            id: this.generateAlertId(),
            name,
            level: rule.level || 'warning',
            message: rule.message || `Alert triggered for ${name}`,
            timestamp: new Date().toISOString(),
            details: rule.getDetails ? rule.getDetails(metrics) : {},
            acknowledged: false
          };

          // 去重：同一规则的活跃告警只保留最新一条，避免 this.alerts 按周期无界累积
          this.alerts = this.alerts.filter((a) => a.name !== name);

          alerts.push(alert);
          this.alerts.push(alert);
          this.recordAlert(alert);
          this.sendNotification(alert);
        }
      } catch (error) {
        console.error(`Error evaluating alert rule ${name}:`, error);
      }
    }

    return alerts;
  }

  evaluateRule(rule, metrics) {
    if (typeof rule.condition === 'function') {
      return rule.condition(metrics);
    }

    // 默认基于阈值的评估
    const metricPath = rule.metric;
    const threshold = rule.threshold;
    const operator = rule.operator || '>';
    const value = this.getNestedValue(metrics, metricPath);

    if (value === undefined || value === null) {
      return false;
    }

    switch (operator) {
    case '>': return value > threshold;
    case '<': return value < threshold;
    case '>=': return value >= threshold;
    case '<=': return value <= threshold;
    case '==': return value === threshold;
    case '!=': return value !== threshold;
    default: return false;
    }
  }

  getNestedValue(obj, path) {
    return path.split('.').reduce((current, key) => {
      return current && current[key] !== undefined ? current[key] : undefined;
    }, obj);
  }

  generateAlertId() {
    // Workers 中避免随机值问题，使用简单 ID 生成
    const timestamp = Date.now();
    const randomPart = typeof Math !== 'undefined' && Math.random
      ? Math.random().toString(36).substr(2, 9)
      : 'cloudflare';
    return `alert_${timestamp}_${randomPart}`;
  }

  recordAlert(alert) {
    this.alertHistory.push(alert);
    if (this.alertHistory.length > this.maxHistory) {
      this.alertHistory.shift();
    }
  }

  async sendNotification(alert) {
    console.warn(`🚨 ALERT [${alert.level.toUpperCase()}]: ${alert.message}`, {
      alertId: alert.id,
      timestamp: alert.timestamp,
      details: alert.details
    });
    // 可集成外部通知服务（邮件/短信/Slack/Webhook）
  }

  acknowledgeAlert(alertId) {
    const alert = this.alerts.find((a) => a.id === alertId);
    if (alert) {
      alert.acknowledged = true;
      alert.acknowledgedAt = new Date().toISOString();
    }
  }

  getActiveAlerts() {
    return this.alerts.filter((alert) => !alert.acknowledged);
  }

  getAlertHistory(limit = 100) {
    return this.alertHistory.slice(-limit);
  }

  cleanupAcknowledged() {
    this.alerts = this.alerts.filter((alert) => !alert.acknowledged);
  }
}

export default AlertManager;
