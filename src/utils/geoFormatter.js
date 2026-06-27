/**
 * 🌍 地理位置资源格式化工具
 *
 * 职责分离：
 * - buildGeoResource(): 将 provider 合并结果净化、标准化为 RESTful 资源对象
 * - serializeByFormat(): 按 query.format 在 JSON/XML/CSV 间序列化整个响应信封
 * - filterFields(): 字段投影（点路径 + 通配符）
 *
 * 响应信封由 responseBuilder 负责；本模块只产出资源与序列化文本。
 */

import secureLogger from './secureLogger.js';

/**
 * 由 ISO 国家代码生成国旗 emoji（regional indicator symbols）。
 */
function flagFromCode(countryCode) {
  if (!countryCode || countryCode.length !== 2) {
    return null;
  }
  const codePoints = countryCode
    .toUpperCase()
    .split('')
    .map((char) => 127397 + char.charCodeAt(0));
  return String.fromCodePoint(...codePoints);
}

/**
 * 构造标准化的地理位置资源对象（RESTful 资源，非信封）
 * 输入为规范 GeoData（provider 经 createGeoData 净化 + 优先级合并的结果）——近恒等投影。
 * @param {object} geoInfo - 合并后的规范 GeoData
 * @param {string} ip - 目标 IP
 * @param {object} query - 已校验查询参数（includeThreat, fields）
 * @returns {object} 标准化资源（包含 ip/country/location/network/security 子对象）
 */
export function buildGeoResource(geoInfo, ip, query = {}) {
  const g = geoInfo || {};
  const country = g.country || {};
  const location = g.location || { coordinates: {} };
  const coords = location.coordinates || {};
  const network = g.network || {};
  const address = g.ip || ip;
  const isV6 = address.includes(':');

  const resource = {
    ip: address,
    type: isV6 ? 'ipv6' : 'ipv4',
    version: isV6 ? 6 : 4,
    flag: flagFromCode(country.code),
    country: {
      name: country.name ?? null,
      code: country.code ?? null,
      region: country.region ?? null,
      city: country.city ?? null,
      continent: country.continent ?? null,
      continentCode: country.continentCode ?? null
    },
    location: {
      coordinates: {
        latitude: typeof coords.latitude === 'number' ? coords.latitude : null,
        longitude: typeof coords.longitude === 'number' ? coords.longitude : null,
        accuracy: typeof coords.accuracy === 'number' ? coords.accuracy : null
      },
      timezone: location.timezone ?? null,
      postalCode: location.postalCode ?? null
    },
    network: {
      asn: typeof network.asn === 'number' ? network.asn : null,
      organization: network.organization ?? null,
      isp: network.isp ?? null,
      domain: network.domain ?? null
    },
    provider: g.provider || 'unknown'
  };

  if (query.includeThreat && g.threat) {
    resource.security = {
      riskScore: Math.max(0, Math.min(100, g.threat.riskScore || 0)),
      riskLevel: ['minimal', 'low', 'medium', 'high', 'critical'].includes(g.threat.riskLevel)
        ? g.threat.riskLevel
        : 'minimal',
      threats: {
        isVPN: Boolean(g.threat.isVPN),
        isProxy: Boolean(g.threat.isProxy),
        isTor: Boolean(g.threat.isTor),
        isBot: Boolean(g.threat.isBot),
        isMalicious: Boolean(g.threat.isMalicious)
      },
      reputation: ['good', 'neutral', 'suspicious', 'malicious'].includes(g.threat.reputation)
        ? g.threat.reputation
        : 'good'
    };
  }

  if (query.fields) {
    const requestedFields = query.fields.split(',').map((f) => f.trim()).filter(Boolean);
    if (requestedFields.length > 0) {
      return filterFields(resource, requestedFields);
    }
  }

  return resource;
}

/**
 * 字段投影：支持点路径嵌套与 * 通配符
 */
export function filterFields(data, fields, requestId = null) {
  if (!fields || fields.length === 0) return data;

  const filtered = {};

  fields.forEach((field) => {
    try {
      if (field.includes('.')) {
        const parts = field.split('.');
        let source = data;
        let target = filtered;

        for (let i = 0; i < parts.length - 1; i++) {
          const part = parts[i];

          if (part === '*') {
            if (typeof source === 'object' && source !== null) {
              for (const key of Object.keys(source)) {
                if (!target[key]) target[key] = {};
                const remainingPath = parts.slice(i + 1).join('.');
                const subResult = filterFields(source[key], [remainingPath], requestId);
                Object.assign(target[key], subResult);
              }
            }
            return;
          }

          if (source && source[part] !== undefined) {
            if (!target[part]) target[part] = {};
            source = source[part];
            target = target[part];
          } else {
            return;
          }
        }

        const lastPart = parts[parts.length - 1];
        if (lastPart === '*') {
          if (typeof source === 'object' && source !== null) {
            Object.assign(target, source);
          }
        } else if (source && source[lastPart] !== undefined) {
          target[lastPart] = source[lastPart];
        }
      } else if (data[field] !== undefined) {
        filtered[field] = data[field];
      }
    } catch (error) {
      secureLogger.warn('Field filtering error', { field, error: error.message, requestId });
    }
  });

  return filtered;
}

/**
 * 按目标格式序列化整个响应信封
 * @param {object} body - 已构造的响应信封（含 data/meta/links）
 * @param {object} query - { format, pretty, callback }
 * @returns {{ content: string, contentType: string, disposition?: string }}
 */
export function serializeByFormat(body, query = {}) {
  const format = (query.format || 'json').toLowerCase();
  const pretty = query.pretty === true || query.pretty === 'true';

  switch (format) {
  case 'xml':
    return {
      content: convertToXML(body),
      contentType: 'application/xml; charset=utf-8'
    };

  case 'csv': {
    const result = convertToCSV(body);
    return {
      content: result.content,
      contentType: 'text/csv; charset=utf-8',
      disposition: `attachment; filename="${result.filename}"`
    };
  }

  case 'json':
  default: {
    let content = JSON.stringify(body, null, pretty ? 2 : 0);
    let contentType = 'application/json; charset=utf-8';
    if (query.callback) {
      content = `${query.callback}(${content});`;
      contentType = 'application/javascript; charset=utf-8';
    }
    return { content, contentType };
  }
  }
}

/**
 * 生产级 XML 转换器（XML 1.0）
 */
export function convertToXML(data) {
  const xmlHeader = '<?xml version="1.0" encoding="UTF-8"?>\n';

  function escapeXML(str) {
    if (typeof str !== 'string') return str;
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  function objectToXML(obj, rootName = 'root', indent = 0) {
    const spaces = '  '.repeat(indent);

    if (obj === null || obj === undefined) {
      return `${spaces}<${rootName} xsi:nil="true" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"/>`;
    }

    if (typeof obj !== 'object') {
      return `${spaces}<${rootName}>${escapeXML(String(obj))}</${rootName}>`;
    }

    if (Array.isArray(obj)) {
      const items = obj.map((item) => objectToXML(item, 'item', indent + 1)).join('\n');
      return `${spaces}<${rootName}>\n${items}\n${spaces}</${rootName}>`;
    }

    const entries = Object.entries(obj).map(([key, value]) => {
      const sanitizedKey = key.replace(/[^a-zA-Z0-9_-]/g, '_');
      return objectToXML(value, sanitizedKey, indent + 1);
    }).join('\n');

    return `${spaces}<${rootName}>\n${entries}\n${spaces}</${rootName}>`;
  }

  try {
    return xmlHeader + objectToXML(data, 'response');
  } catch (error) {
    secureLogger.error('XML conversion failed', { error: error.message });
    return `${xmlHeader}<response><error>XML conversion failed</error></response>`;
  }
}

/**
 * 生产级 CSV 转换器：嵌套对象扁平化 + 正确转义
 * @returns {{ content: string, filename: string }}
 */
export function convertToCSV(body) {
  try {
    function flattenObject(obj, prefix = '') {
      const flattened = {};
      for (const key in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, key)) {
          const value = obj[key];
          const newKey = prefix ? `${prefix}.${key}` : key;
          if (value === null || value === undefined) {
            flattened[newKey] = '';
          } else if (typeof value === 'object' && !Array.isArray(value)) {
            Object.assign(flattened, flattenObject(value, newKey));
          } else if (Array.isArray(value)) {
            flattened[newKey] = value.join(';');
          } else {
            flattened[newKey] = String(value);
          }
        }
      }
      return flattened;
    }

    function escapeCSV(str) {
      if (typeof str !== 'string') return str;
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    }

    const csvData = body.data || body;
    const flattened = flattenObject(csvData);
    const headers = Object.keys(flattened);
    const values = Object.values(flattened).map(escapeCSV);

    return {
      content: [headers.join(','), values.join(',')].join('\n'),
      filename: 'geolocation.csv'
    };
  } catch (error) {
    secureLogger.error('CSV conversion failed', { error: error.message });
    return {
      content: 'error,message\ntrue,"CSV conversion failed"',
      filename: 'geolocation.csv'
    };
  }
}
