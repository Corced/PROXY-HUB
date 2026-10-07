import { describe, it, expect, beforeEach, vi } from 'vitest';
import { server } from '../../mocks/handlers';
import { loginAs, setMockMembership, clearMockMemberships, createTestSession, createTestMember, expectAuditLog, clearTestData } from '../helpers';
import { discordGateConfig } from '@proxy-hub/discord-gate/config/discordGateConfig';
import { pool } from '@proxy-hub/discord-gate/db/pool';
import { redis } from '@proxy-hub/discord-gate/db/redis';

describe('Discord OAuth2 → PROXY-HUB access', () => {
  beforeEach(async () => {
    await clearTestData();
  });

  it('full login flow: Discord OAuth → session → /auth/verify → 200', async () => {
    const discordId = '123456789012345678';

    // Setup: user is a guild member
    setMockMembership(discordId, true);

    // Run full login flow
    const { cookie } = await loginAs(discordId);

    // Call /auth/verify with session cookie
    const response = await fetch('http://localhost:3001/auth/verify', {
      headers: {
        Cookie: cookie,
      },
    });

    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.ok).toBe(true);

    // Check headers
    const userIdHeader = response.headers.get('X-Discord-User-ID');
    expect(userIdHeader).toBe(discordId);

    const usernameHeader = response.headers.get('X-Discord-Username');
    expect(usernameHeader).toBeTruthy();
  });

  it('🔐 [SECURITY] No ADMIN role in any issued session', async () => {
    const discordId = '123456789012345678';

    // Setup: user is a guild member
    setMockMembership(discordId, true);

    // Run full login flow
    const { cookie } = await loginAs(discordId);

    // Verify session exists and check role
    const sessionData = await redis.get(`session:${cookie.replace('discord_gate_session=', '')}`);
    expect(sessionData).toBeTruthy();

    const session = JSON.parse(sessionData!);
    expect(session.discordId).toBe(discordId);

    // SECURITY: This test must never be skipped.
    // DiscordGate users are MEMBER only, never ADMIN.
    // The sidecar never assigns ADMIN role.
    const member = await pool.query(
      'SELECT role FROM discord_gate_members WHERE discord_id = $1',
      [discordId]
    );

    expect(member.rows[0].role).toBe('MEMBER');
    expect(member.rows[0].role).not.toBe('ADMIN');
  });

  it('Non-guild-member blocked at /auth/verify', async () => {
    const discordId = '123456789012345678';

    // Setup: user is NOT a guild member
    setMockMembership(discordId, false);

    // Create session anyway (simulating someone who was a member but left)
    const token = await createTestSession(discordId, 'testuser');
    await createTestMember({ discordId, discordUsername: 'testuser' });
    const cookie = `discord_gate_session=${token}`;

    // Attempt to call /auth/verify
    const response = await fetch('http://localhost:3001/auth/verify', {
      headers: {
        Cookie: cookie,
      },
    });

    expect(response.status).toBe(401);
    const data = await response.json();
    expect(data.error).toBe('Guild membership lost');
  });

  it('New API user is provisioned on first login', async () => {
    const discordId = '123456789012345678';

    // Setup: user is a guild member
    setMockMembership(discordId, true);

    // Track New API calls
    const newApiUsers = (global as any).__mockNewApiUsers || new Map();
    const initialSize = newApiUsers.size;

    // Run full login
    await loginAs(discordId);

    // Verify New API user was created
    const users = (global as any).__mockNewApiUsers || new Map();
    const createdUser = Array.from(users.values()).find(u => u.discord_id === discordId);
    expect(createdUser).toBeTruthy();
    expect(createdUser!.role).toBe(1); // common user
    expect(createdUser!.status).toBe(1); // enabled

    // Verify discord_gate_members has new_api_user_id set
    const member = await pool.query(
      'SELECT new_api_user_id FROM discord_gate_members WHERE discord_id = $1',
      [discordId]
    );

    expect(member.rows[0].new_api_user_id).toBeTruthy();
  });
});