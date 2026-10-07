import { describe, it, expect, beforeEach, vi } from 'vitest';
import { syncScheduler } from '@proxy-hub/discord-gate/services/syncScheduler';
import { pool } from '@proxy-hub/discord-gate/db/pool';
import { discordGateConfig } from '@proxy-hub/discord-gate/config/discordGateConfig';
import { clearTestData, setMockMembership, createTestMember } from '../helpers';

describe('SyncScheduler - periodic guild member reconciliation', () => {
  beforeEach(async () => {
    await clearTestData();
    // Stop any running scheduler
    syncScheduler.stop();
  });

  it('syncScheduler revokes members no longer in guild', async () => {
    // Insert 3 active members in discord_gate_members
    await createTestMember({
      discordId: '111111111111111111',
      discordUsername: 'member1',
    });
    await createTestMember({
      discordId: '222222222222222222',
      discordUsername: 'member2',
    });
    await createTestMember({
      discordId: '333333333333333333',
      discordUsername: 'member3',
    });

    // Mock: only 2 are still in guild
    setMockMembership('111111111111111111', true);
    setMockMembership('222222222222222222', true);
    setMockMembership('333333333333333333', false); // left guild

    // Run sync
    const result = await syncScheduler.runSync();

    // Verify results
    expect(result.guildSize).toBe(2);
    expect(result.dbSize).toBe(3);
    expect(result.revoked).toBe(1);

    // Verify departed member was revoked
    const member = await pool.query(
      'SELECT status FROM discord_gate_members WHERE discord_id = $1',
      ['333333333333333333']
    );
    expect(member.rows[0].status).toBe('REVOKED');
  });

  it('syncScheduler skips already-revoked members', async () => {
    // Insert 1 REVOKED member not in guild
    await createTestMember({
      discordId: '444444444444444444',
      discordUsername: 'revoked_member',
      status: 'REVOKED',
    });

    setMockMembership('444444444444444444', false);

    // Run sync
    const result = await syncScheduler.runSync();

    // Should not try to revoke again (revoked count should be 0)
    expect(result.revoked).toBe(0);
    expect(result.guildSize).toBe(0);
    expect(result.dbSize).toBe(0); // No ACTIVE members
  });

  it('syncScheduler caps revocations per cycle', async () => {
    // Insert 15 active members, all "left guild"
    for (let i = 0; i < 15; i++) {
      const id = `5${i.toString().padStart(17, '0')}`;
      await createTestMember({
        discordId: id,
        discordUsername: `member${i}`,
      });
      setMockMembership(id, false);
    }

    const result = await syncScheduler.runSync();

    // Should only revoke max 10 per sync
    expect(result.revoked).toBeLessThanOrEqual(10);
  });
});