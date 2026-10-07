import { describe, it, expect, beforeEach, vi } from 'vitest';
import { server } from '../../mocks/handlers';
import { loginAs, setMockMembership, clearMockMemberships, createTestSession, createTestMember, createTestDBSession, expectAuditLog, clearTestData } from '../helpers';
import { discordGateConfig } from '@proxy-hub/discord-gate/config/discordGateConfig';
import { pool } from '@proxy-hub/discord-gate/db/pool';
import { redis } from '@proxy-hub/discord-gate/db/redis';
import { discordMemberRepository } from '@proxy-hub/discord-gate/db/repositories/discordMemberRepository';

describe('Full revocation chain: member leave → sessions + API keys gone', () => {
  beforeEach(async () => {
    await clearTestData();
  });

  it('Bot guild leave event revokes sessions AND API keys', async () => {
    const discordId = '123456789012345678';

    // Setup: user is a guild member with active session
    setMockMembership(discordId, true);
    const { cookie } = await loginAs(discordId);

    // Create New API user
    const newApiUserId = 'newapi-123';
    (global as any).__mockNewApiUsers.set(discordId, {
      id: 'newapi-123',
      username: 'testuser',
      discord_id: discordId,
      role: 1,
      status: 1,
      group: 'default',
    });

    // Create some mock API keys
    const tokenIds = ['key-1', 'key-2', 'key-3'];
    for (const tokenId of tokenIds) {
      (global as any).__mockNewApiTokens.set(tokenId, {
        id: tokenId,
        user_id: parseInt(newApiUserId.replace('newapi-', ''), 10),
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

    // Verify session works before revocation
    const verifyBefore = await fetch('http://localhost:3001/auth/verify', {
      headers: { Cookie: `discord_gate_session=${cookie.replace('discord_gate_session=', '')}` },
    });
    expect(verifyBefore.status).toBe(200);

    // Simulate: bot calls sidecar /internal/revoke-member
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
    const revokeResult = await revokeResponse.json();
    expect(revokeResult.success).toBe(true);
    expect(revokeResult.sessionsRevoked).toBeGreaterThan(0);
    expect(revokeResult.keysRevoked).toBeGreaterThan(0);

    // Assert: session is gone
    const verifyAfter = await fetch('http://localhost:3001/auth/verify', {
      headers: { Cookie: cookie },
    });
    expect(verifyAfter.status).toBe(401);

    // Assert: New API user is disabled
    // Check that PUT /api/admin/users/newapi-123 with action: 'disable' was called
    // This is verified via the mock handlers

    // Assert: New API keys revoked
    const users = (global as any).__mockNewApiUsers || new Map();
    const user = users.get('123456789012345678');
    expect(user?.status).toBe(0); // disabled

    // Verify keys were revoked
    const tokens = (global as any).__mockNewApiTokens || new Map();
    for (const tokenId of tokenIds) {
      expect(tokens.has(tokenId)).toBe(false);
    }

    // Assert: audit log has MEMBER_LEFT_GUILD
    await expectAuditLog('MEMBER_LEFT_GUILD', discordId);
  });

  it('API keys revoked even if session was already expired', async () => {
    const discordId = '123456789012345678';

    // Setup: user is a guild member
    setMockMembership(discordId, true);

    // Create member with New API user
    await createTestMember({
      discordId,
      discordUsername: 'testuser',
      newApiUserId: 'newapi-456',
    });

    // Create expired session
    const expiredToken = await createTestSession(discordId, 'testuser');
    const member = await pool.query('SELECT id FROM discord_gate_members WHERE discord_id = $1', [discordId]);
    await createTestDBSession(member.rows[0].id, expiredToken, new Date(Date.now() - 86400000)); // expired 1 day ago

    // Create mock New API user
    (global as any).__mockNewApiUsers.set(discordId, {
      id: 'newapi-456',
      username: 'testuser',
      discord_id: discordId,
      role: 1,
      status: 1,
      group: 'default',
    });

    // Create mock API keys
    for (const tokenId of ['key-expired-1', 'key-expired-2']) {
      (global as any).__mockNewApiTokens.set(tokenId, {
        id: tokenId,
        user_id: 456,
        key: `sk-${tokenId}`,
        name: `Expired Key ${tokenId}`,
        status: 1,
        expired_time: -1,
      });
    }

    // Simulate revocation
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
    const revokeResult = await revokeResponse.json();
    expect(revokeResult.success).toBe(true);
    expect(revokeResult.keysRevoked).toBeGreaterThan(0);

    // Verify keys were revoked even though session was expired
    const tokens = (global as any).__mockNewApiTokens || new Map();
    expect(tokens.size).toBe(0);
  });

  it('Revocation is idempotent — second call does not throw', async () => {
    const discordId = '123456789012345678';

    setMockMembership(discordId, true);
    const { cookie } = await loginAs(discordId);

    // Create New API user
    (global as any).__mockNewApiUsers.set(discordId, {
      id: 'newapi-789',
      username: 'testuser',
      discord_id: discordId,
      role: 1,
      status: 1,
      group: 'default',
    });

    await pool.query(
      'UPDATE discord_gate_members SET new_api_user_id = $1 WHERE discord_id = $2',
      ['newapi-789', discordId]
    );

    // First revocation
    const response1 = await fetch('http://localhost:3001/internal/revoke-member', {
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

    expect(response1.status).toBe(200);
    const result1 = await response1.json();
    expect(result1.success).toBe(true);

    // Second revocation (should succeed, not throw)
    const response2 = await fetch('http://localhost:3001/internal/revoke-member', {
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

    expect(response2.status).toBe(200);
    const result2 = await response2.json();
    expect(result2.success).toBe(true);

    // Both should have same result structure
    expect(result1.sessionsRevoked).toBe(result2.sessionsRevoked);
    expect(result1.keysRevoked).toBe(result2.keysRevoked);
  });
});