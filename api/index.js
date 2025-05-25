/**
 * Vercel Serverless Function Entry Point
 * Adapts the Hono application for Vercel's serverless environment
 */

import { handle } from 'hono/vercel'
import app from '../src/app.js'

// Export the Vercel handler
export default handle(app)

// Named exports for Vercel API routes compatibility
export const GET = handle(app)
export const POST = handle(app)
export const PUT = handle(app)
export const DELETE = handle(app)
export const OPTIONS = handle(app)
export const PATCH = handle(app)
export const HEAD = handle(app)

// Vercel configuration
export const config = {
  maxDuration: 30,
  memory: 1024
}
