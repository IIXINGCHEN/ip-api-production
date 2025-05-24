/**
 * Universal Entry Point for IP-API
 * Supports multiple deployment platforms: Cloudflare Workers, Vercel, Netlify
 */

import app from './src/app.js'

// Platform detection
const isVercel = typeof process !== 'undefined' && process.env?.VERCEL
const isNetlify = typeof process !== 'undefined' && process.env?.NETLIFY

// Default export for Cloudflare Workers
export default app

// Create platform-specific handlers
let vercelHandlerInstance = null
let netlifyHandlerInstance = null

// Initialize platform handlers
async function initializePlatformHandlers() {
    if (isVercel && !vercelHandlerInstance) {
        const { handle } = await import('hono/vercel')
        vercelHandlerInstance = handle(app)
    }

    if (isNetlify && !netlifyHandlerInstance) {
        const { handle } = await import('hono/netlify')
        netlifyHandlerInstance = handle(app)
    }
}

// Universal handler that works across platforms
async function createHandler() {
    await initializePlatformHandlers()

    if (isVercel && vercelHandlerInstance) {
        return vercelHandlerInstance
    }

    if (isNetlify && netlifyHandlerInstance) {
        return netlifyHandlerInstance
    }

    // Default to app for Cloudflare Workers
    return app
}

// Vercel serverless function exports
export const GET = async (req, res) => {
    const handler = await createHandler()
    return handler(req, res)
}

export const POST = async (req, res) => {
    const handler = await createHandler()
    return handler(req, res)
}

export const PUT = async (req, res) => {
    const handler = await createHandler()
    return handler(req, res)
}

export const DELETE = async (req, res) => {
    const handler = await createHandler()
    return handler(req, res)
}

export const OPTIONS = async (req, res) => {
    const handler = await createHandler()
    return handler(req, res)
}

export const PATCH = async (req, res) => {
    const handler = await createHandler()
    return handler(req, res)
}

export const HEAD = async (req, res) => {
    const handler = await createHandler()
    return handler(req, res)
}

// Netlify Edge Function export
export const netlifyHandler = async (req, context) => {
    await initializePlatformHandlers()
    if (netlifyHandlerInstance) {
        return netlifyHandlerInstance(req, context)
    }
    return app.fetch(req)
}

// Platform-specific configuration
export const config = {
    runtime: 'nodejs20.x',
    maxDuration: 30,
    memory: 1024,
    regions: ['all']
}
