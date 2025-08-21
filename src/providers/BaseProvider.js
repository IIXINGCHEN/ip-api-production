/**
 * 基础提供商类
 * 抽象公共逻辑，减少提供商间的重复代码
 */

import { isValidIP, getIPType, getIPVersion, isPrivateIP, isLoopbackIP, isMulticastIP } from "../utils/ipValidation.js";

export class BaseProvider {
  constructor(name, config = {}) {
    this.name = name;
    this.config = config;
    this.priority = config.priority || 1;
  }

  /**
   * 检查提供商是否已配置
   */
  isConfigured() {
    return true; // 基础实现，子类可以重写
  }

  /**
   * 获取基础IP信息
   */
  getBaseIPInfo(ip) {
    if (!isValidIP(ip)) {
      throw new Error(`Invalid IP address: ${ip}`);
    }

    return {
      ip,
      type: getIPType(ip),
      version: getIPVersion(ip),
      isPrivate: isPrivateIP(ip),
      isLoopback: isLoopbackIP(ip),
      isMulticast: isMulticastIP(ip),
      provider: this.name,
    };
  }

  /**
   * 统一的错误处理
   */
  handleError(error, operation) {
    const errorMessage = `${this.name} ${operation} failed`;

    // 记录错误（在生产环境中应该使用适当的日志系统）
    if (process.env.NODE_ENV === 'development') {
      // Development logging would go here
    }

    throw new Error(errorMessage);
  }

  /**
   * 统一的HTTP请求方法
   */
  async makeRequest(url, options = {}) {
    const defaultOptions = {
      method: 'GET',
      headers: {
        'User-Agent': 'IP-API-Service/1.0',
        'Accept': 'application/json',
      },
      signal: AbortSignal.timeout(5000), // 5秒超时
    };

    const requestOptions = { ...defaultOptions, ...options };

    try {
      const response = await fetch(url, requestOptions);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      if (error.name === 'AbortError') {
        throw new Error('Request timeout');
      }
      throw error;
    }
  }

  /**
   * 验证响应数据
   */
  validateResponse(data, requiredFields = []) {
    if (!data || typeof data !== 'object') {
      throw new Error('Invalid response data');
    }

    for (const field of requiredFields) {
      if (!(field in data)) {
        throw new Error(`Missing required field: ${field}`);
      }
    }

    return true;
  }

  /**
   * 抽象方法 - 子类必须实现
   */
  async getIPInfo(ip, request, _options = {}) {
    throw new Error(`${this.name} must implement getIPInfo method`);
  }

  async getGeoInfo(ip, request, _options = {}) {
    throw new Error(`${this.name} must implement getGeoInfo method`);
  }
}