import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { getIPInfo } from '../services/ipService.js'
import { formatIPResponse, generateRequestId } from '../utils/response.js'

const app = new Hono()

// Schema for IP validation
const ipSchema = z.object({
  ip: z.string().ip().optional()
})

// Get client IP address in JSON format
app.get('/', async (c) => {
  try {
    const clientIP = c.get('clientIP')

    const ipInfo = await getIPInfo(clientIP, c.req)

    // Get threat information
    const { ThreatService } = await import('../services/threatService.js')
    const threatService = new ThreatService()
    const threatInfo = await threatService.getThreatInfo(clientIP, c.req)

    // Add client IP to response headers and set UTF-8 encoding
    c.header('X-Client-IP', clientIP)
    c.header('Content-Type', 'application/json; charset=utf-8')

    // Format response as JSON
    const response = formatIPResponse(ipInfo, {
      format: 'json',
      includeHeaders: false,
      includeThreatInfo: true,
      threatInfo
    })

    return c.json(response)
  } catch (error) {
    return c.json({
      error: 'Internal Server Error',
      message: 'Failed to retrieve IP information',
      timestamp: new Date().toISOString()
    }, 500)
  }
})

// Get IP information in JSON format (legacy endpoint)
app.get('/json', async (c) => {
  try {
    const clientIP = c.get('clientIP')

    const ipInfo = await getIPInfo(clientIP, c.req)

    // Get threat information
    const { ThreatService } = await import('../services/threatService.js')
    const threatService = new ThreatService()
    const threatInfo = await threatService.getThreatInfo(clientIP, c.req)

    // Add client IP to response headers and set UTF-8 encoding
    c.header('X-Client-IP', clientIP)
    c.header('Content-Type', 'application/json; charset=utf-8')

    // Format response
    const response = formatIPResponse(ipInfo, {
      format: 'json',
      includeHeaders: false,
      includeThreatInfo: true,
      threatInfo
    })

    return c.json(response)
  } catch (error) {
    return c.json({
      error: 'Internal Server Error',
      message: 'Failed to retrieve IP information',
      timestamp: new Date().toISOString()
    }, 500)
  }
})

// Lookup specific IP address
app.get('/lookup/:ip', zValidator('param', ipSchema), async (c) => {
  try {
    const { ip } = c.req.valid('param')

    const ipInfo = await getIPInfo(ip, c.req)

    // Set UTF-8 encoding
    c.header('Content-Type', 'application/json; charset=utf-8')

    // Format response
    const response = formatIPResponse(ipInfo, {
      format: 'json',
      includeHeaders: false,
      includeThreatInfo: false
    })

    return c.json(response)
  } catch (error) {
    return c.json({
      error: 'Internal Server Error',
      message: 'Failed to retrieve IP information',
      timestamp: new Date().toISOString()
    }, 500)
  }
})

// Batch IP lookup
app.post('/batch', zValidator('json', z.object({
  ips: z.array(z.string().ip()).max(10) // Limit to 10 IPs per request
})), async (c) => {
  try {
    const { ips } = c.req.valid('json')

    // Set UTF-8 encoding
    c.header('Content-Type', 'application/json; charset=utf-8')

    const results = await Promise.allSettled(
      ips.map(async (ip) => {
        const ipInfo = await getIPInfo(ip, c.req)
        return formatIPResponse(ipInfo, {
          format: 'json',
          includeHeaders: false,
          includeThreatInfo: false
        })
      })
    )

    const response = results.map((result, index) => ({
      ip: ips[index],
      success: result.status === 'fulfilled',
      data: result.status === 'fulfilled' ? result.value : null,
      error: result.status === 'rejected' ? result.reason.message : null
    }))

    return c.json({
      results: response,
      timestamp: new Date().toISOString(),
      requestId: generateRequestId()
    })
  } catch (error) {
    return c.json({
      error: 'Internal Server Error',
      message: 'Failed to process batch IP lookup',
      timestamp: new Date().toISOString()
    }, 500)
  }
})

export default app
