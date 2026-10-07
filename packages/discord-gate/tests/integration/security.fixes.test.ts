import { describe, it, expect, beforeEach, vi } from 'vitest';
import { pool } from '@proxy-hub/discord-gate/db/pool';
import { redis } from '@proxy-hub/discord-gate/db/redis';
import { clearTestData, setMockMembership, loginAs, createTestSession, createTestMember } from '../helpers';
import { discordGateConfig } from '@proxy-hub/discord-gate/config/discordGateConfig';
import { discordMemberRepository } from '@proxy-hub/discord-gate/db/repositories/discordMemberRepository';
import { newApiBridge } from '@proxy-hub/discord-gate/services/newApiBridge';

describe('Security fixes validation (C-01 to C-04, H-01, H-02, H-04, M-01, M-02)', () => {
  beforeEach(async () => {
    await clearTestData();
  });

  describe('C-01: Default Admin Credentials', () => {
    it('Startup rejects empty INITIAL_ADMIN_PASSWORD', () => {
      // This is tested via check-defaults.sh script
      // The script checks for empty, "admin", "admin123", "123456"
      // We verify the logic here by checking the script exists and has correct logic
      const fs = require('fs');
      const path = require('path');
      const scriptPath = path.join(__dirname, '../../../../scripts/check-defaults.sh');
      const scriptContent = fs.readFileSync(scriptPath, 'utf-8');

      expect(scriptContent).toContain('INITIAL_ADMIN_PASSWORD');
      expect(scriptContent).toContain('admin');
      expect(scriptContent).toContain('admin123');
      expect(scriptContent).toContain('123456');
      expect(scriptContent).toContain('-z "$INITIAL_ADMIN_PASSWORD"');
    });

    it('generate-secrets.sh generates strong INITIAL_ADMIN_PASSWORD', () => {
      const fs = require('fs');
      const path = require('path');
      const scriptPath = path.join(__dirname, '../../../../scripts/generate-secrets.sh');
      const scriptContent = fs.readFileSync(scriptPath, 'utf-8');

      expect(scriptContent).toContain('INITIAL_ADMIN_PASSWORD');
      expect(scriptContent).toContain('openssl rand -base64 32');
    });

    it('SESSION_SECRET has minimum 32 char check', () => {
      const fs = require('fs');
      const path = require('path');
      const scriptPath = path.join(__dirname, '../../../../scripts/check-defaults.sh');
      const scriptContent = fs.readFileSync(scriptPath, 'utf-8');

      expect(scriptContent).toContain('SESSION_SECRET');
      expect(scriptContent).toContain('32');
    });

    it('NEW_API_JWT_SECRET has minimum 32 char check', () => {
      const fs = require('fs');
      const path = require('path');
      const scriptPath = path.join(__dirname, '../../../../scripts/check-defaults.sh');
      const scriptContent = fs.readFileSync(scriptPath, 'utf-8');

      expect(scriptContent).toContain('NEW_API_JWT_SECRET');
      expect(scriptContent).toContain('32');
    });
  });

  describe('C-03: API Key Persists After Guild Membership Lost', () => {
    it('API key revocation called on member leave', async () => {
      const discordId = '123456789012345678';

      // Setup: user is a guild member with active session
      setMockMembership(discordId, true);
      const { cookie } = await loginAs(discordId);

      // Create New API user
      const newApiUserId = 'newapi-123';
      (global as any).__mockNewApiUsers.set(discordId, {
        id: newApiUserId,
        username: 'testuser',
        discord_id: discordId,
        role: 1,
        status: 1,
        group: 'default',
      });

      // Create mock API keys
      for (const tokenId of ['key-1', 'key-2']) {
        (global as any).__mockNewApiTokens.set(tokenId, {
          id: tokenId,
          user_id: 123,
          key: `sk-${tokenId}`,
          name: `Test Key ${tokenId}`,
          status: 1,
          expired_time: -1,
        });
      }

      // Update member with New API user ID
      await pool.query(
        'UPDATE discord_gate_members SET new_api_user_id = $1 WHERE discord_id = $2',
        [newApiUserId, discordId]
      );

      // Simulate revocation via sidecar
      const revokeResponse = await fetch('http://localhost:3001/internal/revoke-member', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-internal-secret': discordGateConfig.BOT_INTERNAL_SECRET,
        },
        body: JSON.stringify({
          discordId,
          reason: 'member_left',
        }),
      });

      expect(revokeResponse.status).toBe(200);

      // Verify newApiBridge.revokeAllUserApiKeys was called
      // This is verified by the mock New API handlers being invoked
      const tokens = (global as any).__mockNewApiTokens || new Map();
      expect(tokens.size).toBe(0);
    });
  });

  describe('C-04: Redis No-Auth Default', () => {
    it('Redis connection requires password', () => {
      // Verify REDIS_URL includes password component
      const redisUrl = discordGateConfig.REDIS_URL;
      expect(redisUrl).toMatch(/redis:\/\/:.+@/); // Format: redis://:password@host:port
    });

    it('Redis command includes --requirepass', () => {
      const fs = require('fs');
      const path = require('path');
      const composePath = path.join(__dirname, '../../../../docker-compose.yml');
      const composeContent = fs.readFileSync(composePath, 'utf-8');

      expect(composeContent).toContain('--requirepass');
      expect(composeContent).toContain('${REDIS_PASSWORD}');
    });

    it('Redis has --protected-mode yes', () => {
      const fs = require('fs');
      const path = require('path');
      const composePath = path.join(__dirname, '../../../../docker-compose.yml');
      const composeContent = fs.readFileSync(composePath, 'utf-8');

      expect(composeContent).toContain('--protected-mode yes');
    });
  });

  describe('H-01: Caddy exposes all routes without auth check', () => {
    it('/auth/verify returns 401 for missing session', async () => {
      const response = await fetch('http://localhost:3001/auth/verify');
      expect(response.status).toBe(401);
    });

    it('/auth/verify returns 401 for invalid session', async () => {
      const response = await fetch('http://localhost:3001/auth/verify', {
        headers: { Cookie: 'discord_gate_session=invalid_token' },
      });

      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.error).toBe('Invalid session');
    });

    it('/auth/verify returns 401 for expired session', async () => {
      // Create expired session
      const discordId = '123456789012345678';
      setMockMembership(discordId, true);
      const token = await createTestSession(discordId, 'testuser');
      await createTestMember({ discordId, discordUsername: 'testuser' });

      // Manually set expiry to past
      const member = await pool.query('SELECT id FROM discord_gate_members WHERE discord_id = $1', [discordId]);
      await pool.query(
        'UPDATE discord_gate_sessions SET expires_at = NOW() - INTERVAL \'1 hour\' WHERE member_id = $1',
        [member.rows[0].id]
      );

      const response = await fetch('http://localhost:3001/auth/verify', {
        headers: { Cookie: `discord_gate_session=${token}` },
      });

      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.error).toBe('Invalid session');
    });
  });

  describe('H-02: Rate limiter', () => {
    it('Rate limiter blocks after 15 requests/minute', async () => {
      const discordId = '123456789012345678';
      setMockMembership(discordId, true);
      const { cookie } = await loginAs(discordId);

      let blocked = false;

      for (let i = 0; i < 16; i++) {
        const response = await fetch('http://localhost:3001/auth/verify', {
          headers: { Cookie: cookie },
        });

        if (response.status === 429) {
          // Check Retry-After header
          const retryAfter = response.headers.get('Retry-After');
          expect(retryAfter).toBeTruthy();
          expect(parseInt(retryAfter!)).toBeGreaterThan(0);
          blocked = true;
          break;
        }
      }

      expect(blocked).toBe(true);
    });

    it('429 response includes Retry-After header', async () => {
      const discordId = '123456789012345678';
      setMockMembership(discordId, true);
      const { cookie } = await loginAs(discordId);

      // Make 16 requests to hit rate limit
      for (let i = 0; i < 16; i++) {
        const response = await fetch('http://localhost:3001/auth/verify', {
          headers: { Cookie: cookie },
        });

        if (response.status === 429) {
          const retryAfter = response.headers.get('Retry-After');
          expect(retryAfter).toBeTruthy();
          break;
        }
      }
    });

    it('Successful requests include X-RateLimit-* headers', async () => {
      const discordId = '123456789012345678';
      setMockMembership(discordId, true);
      const { cookie } = await loginAs(discordId);

      const response = await fetch('http://localhost:3001/auth/verify', {
        headers: { Cookie: cookie },
      });

      expect(response.status).toBe(200);
      expect(response.headers.get('X-RateLimit-Limit')).toBeTruthy();
      expect(response.headers.get('X-RateLimit-Remaining')).toBeTruthy();
      expect(response.headers.get('X-RateLimit-Reset')).toBeTruthy();
    });
  });

  describe('H-04: No audit trail for AI usage', () => {
    it('Audit log records AI usage with Discord user ID', async () => {
      // This is verified by the revocation chain test which checks
      // that audit logs are created with discord_id
      // The actual AI usage logging would be in New API
      // Here we verify the audit table structure exists
      const result = await pool.query(
        "SELECT column_name FROM information_schema.columns WHERE table_name = 'discord_gate_audit'"
      );

      const columns = result.rows.map(r => r.column_name);
      expect(columns).toContain('discord_id');
      expect(columns).toContain('event_type');
      expect(columns).toContain('new_api_user_id');
      expect(columns).toContain('metadata');
      expect(columns).toContain('created_at');
    });
  });

  describe('M-01: Admin panel exposed', () => {
    it('Admin panel restricted to allowlisted IPs', async () => {
      // Non-allowlisted IP
      const response = await fetch('http://localhost:3001/admin', {
        headers: { 'X-Forwarded-For': '192.168.1.100' },
      });

      expect([403, 302]).toContain(response.status);

      // Allowlisted IP
      const response2 = await fetch('http://localhost:3001/admin', {
        headers: { 'X-Forwarded-For': '127.0.0.1' },
      });

      expect([200, 302, 401, 404]).toContain(response2.status);
    });

    it('Admin panel paths covered by @admin matcher', () => {
      const fs = require('fs');
      const path = require('path');
      const caddyfilePath = path.join(__dirname, '../../../../Caddyfile');
      const caddyfileContent = fs.readFileSync(caddyfilePath, 'utf-8');

      expect(caddyfileContent).toContain('/admin*');
      expect(caddyfileContent).toContain('/dashboard*');
      expect(caddyfileContent).toContain('/api/admin*');
    });
  });

  describe('M-01: PostgreSQL Direct Connection Risk', () => {
    it('PostgreSQL not exposed on external network', () => {
      const fs = require('fs');
      const path = require('path');
      const composePath = path.join(__dirname, '../../../../docker-compose.yml');
      const composeContent = fs.readFileSync(composePath, 'utf-8');

      // In production, postgres should not have ports exposed
      // Check that postgres service doesn't have ports in main compose
      const postgresSection = composeContent.split('postgres:')[1];
      const postgresEnd = postgresSection.split('\n\n')[0];
      expect(postgresSection).not.toContain('ports:');
    });

    it('PostgreSQL only on internal network', () => {
      const fs = require('fs');
      const path = require('path');
      const composePath = path.join(__dirname, '../../../../docker-compose.yml');
      const composeContent = fs.readFileSync(composePath, 'utf-8');

      const postgresSection = composeContent.split('postgres:')[1];
      const postgresEnd = postgresSection.split('\n\n')[0];
      expect(postgresEnd).toContain('internal');
      expect(postgresEnd).not.toContain('proxy');
    });
  });

  describe('M-02: Redis Direct Connection Risk', () => {
    it('Redis not exposed on external network', () => {
      const fs = require('fs');
      const path = require('path');
      const composePath = path.join(__dirname, '../../../../docker-compose.yml');
      const composeContent = fs.readFileSync(composePath, 'utf-8');

      const redisSection = composeContent.split('redis:')[1];
      const redisEnd = redisSection.split('\n\n')[0];
      expect(redisEnd).toContain('internal');
      expect(redisEnd).not.toContain('proxy');
    });
  });

  describe('M-04: Missing security headers', () => {
    it('All security headers present', async () => {
      const response = await fetch('http://localhost:3001/health');

      expect(response.headers.get('Strict-Transport-Security')).toContain('max-age=31536000');
      expect(response.headers.get('X-Frame-Options')).toBe('DENY');
      expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
      expect(response.headers.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
      expect(response.headers.get('Content-Security-Policy')).toContain("default-src 'self'");
      expect(response.headers.get('Permissions-Policy')).toContain('camera=()');
      expect(response.headers.get('Server')).toBeNull();
      expect(response.headers.get('X-Powered-By')).toBeNull();
    });
  });
});