import app from '../../src/app.js'

export const config = { path: "/*" };

export default async (req, ctx) => {
  // Add Netlify-specific context to the request
  const request = new Request(req.url, {
    method: req.method,
    headers: req.headers,
    body: req.body
  })

  // Add Netlify geo data to cf object for compatibility
  request.cf = {
    country: ctx.geo?.country?.code,
    region: ctx.geo?.subdivision?.code,
    city: ctx.geo?.city,
    latitude: ctx.geo?.latitude,
    longitude: ctx.geo?.longitude,
    colo: ctx.server?.region || 'netlify'
  }

  // Set client IP from Netlify context
  request.headers.set('cf-connecting-ip', ctx.ip)

  return app.fetch(request)
}
