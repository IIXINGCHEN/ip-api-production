import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { createAdminAuthMiddleware, createAuthMiddleware } from '../../src/middleware/auth.js';

describe('auth middleware', () => {
  it('accepts API keys from Hono env bindings', async() => {
    const app = new Hono();
    app.use('/private', createAuthMiddleware({ publicEndpoints: [] }));
    app.get('/private', (c) => c.json({ ok: true }));

    const request = new Request('https://example.test/private', {
      headers: { 'X-API-Key': 'user-env-key' }
    });
    const response = await app.fetch(request, { API_KEY_USER: 'user-env-key' });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

  it('accepts admin API keys from Hono env bindings', async() => {
    const app = new Hono();
    app.use('/admin', createAdminAuthMiddleware());
    app.get('/admin', (c) => c.json({ admin: true }));

    const request = new Request('https://example.test/admin', {
      headers: { 'X-API-Key': 'admin-env-key' }
    });
    const response = await app.fetch(request, { API_KEY_ADMIN: 'admin-env-key' });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ admin: true });
  });
});
