import { describe, it, expect, beforeEach } from 'vitest';
import { pool } from '@proxy-hub/discord-gate/db/pool';
import { redis } from '@proxy-hub/discord-gate/db/redis';
import { clearTestData, setMockMembership, loginAs, createTestSession } from '../helpers';
import { discordGateConfig } from '@proxy-hub/discord-gate/config/discordGateConfig';

describe('Middleware - rate limiting, CORS, security headers', () => {
  beforeEach(async () => {
    await clearTestData();
  });

  it('Rate limiter blocks after limit exceeded', async () => {
    const discordId = '123456789012345678';
    setMockMembership(discordId, true);
    const { cookie } = await loginAs(discordId);

    // Make 16 requests (limit is 15)
    let blocked = false;

    for (let i = 0; i < 16; i++) {
      const response = await fetch('http://localhost:3001/auth/verify', {
        headers: { Cookie: cookie },
      });

      if (response.status === 429) {
        blocked = true;
        // Check Retry-After header
        const retryAfter = response.headers.get('Retry-After');
        expect(retryAfter).toBeTruthy();
        expect(parseInt(retryAfter!)).toBeGreaterThan(0);
        break;
      }
    }

    expect(blocked).toBe(true);
  });

  it('Rate limit headers present on successful requests', async () => {
    const discordId = '123456789012345678';
    setMockMembership(discordId, true);
    const { cookie } = await loginAs(discordId);

    const response = await fetch('http://localhost:3001/auth/verify', {
      headers: { Cookie: cookie },
    });

    expect(response.status).toBe(200);

    // Check rate limit headers
    expect(response.headers.get('X-RateLimit-Limit')).toBeTruthy();
    expect(response.headers.get('X-RateLimit-Remaining')).toBeTruthy();
    expect(response.headers.get('X-RateLimit-Reset')).toBeTruthy();
  });

  it('Security headers present on all responses', async () => {
    const response = await fetch('http://localhost:3001/health');

    // Check security headers
    expect(response.headers.get('Strict-Transport-Security')).toContain('max-age=31536000');
    expect(response.headers.get('X-Frame-Options')).toBe('DENY');
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(response.headers.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
    expect(response.headers.get('Content-Security-Policy')).toContain("default-src 'self'");
    expect(response.headers.get('Permissions-Policy')).toContain('camera=()');
    // Server headers should be removed
    expect(response.headers.get('Server')).toBeNull();
    expect(response.headers.get('X-Powered-By')).toBeNull();
  });

  it('CORS headers allow credentials', async () => {
    const response = await fetch('http://localhost:3001/health', {
      headers: {
        Origin: 'https://test.example.com',
        'Access-Control-Request-Method': 'GET',
      },
    });

    expect(response.headers.get('Access-Control-Allow-Origin')).toBeTruthy();
    expect(response.headers.get('Access-Control-Allow-Credentials')).toBe('true');
  });

  it('Admin panel blocked for non-allowlisted IP', async () => {
    const response = await fetch('http://localhost:3001/admin', {
      headers: { 'X-Forwarded-For': '192.168.1.100' }, // not in allowlist
    });

    // Should be 403 or redirect
    expect([403, 302]).toContain(response.status);
  });

  it('Admin panel allowed for allowlisted IP', async () => {
    const response = await fetch('http://localhost:3001/admin', {
      headers: { 'X-Forwarded-For': '127.0.0.1' }, // in allowlist
    });

    // Should allow through to New API
    expect([200, 302, 401, 404]).toContain(response.status);
  });

  it('X-Discord-User-ID header forwarded to New API', async () => {
    const discordId = '123456789012345678';
    setMockMembership(discordId, true);
    const { cookie } = await loginAs(discordId);

    const response = await fetch('http://localhost:3001/auth/verify', {
      headers: { Cookie: cookie },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('X-Discord-User-ID')).toBe(discordId);
    expect(response.headers.get('X-Discord-Username')).toBeTruthy();
  });
});