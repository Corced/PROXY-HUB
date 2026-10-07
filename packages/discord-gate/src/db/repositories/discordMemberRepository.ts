import { Pool, PoolClient } from 'pg';

export interface DiscordGateMember {
  id: string;
  discord_id: string;
  discord_username: string;
  new_api_user_id: string | null;
  role: 'MEMBER' | 'REVOKED';
  status: 'ACTIVE' | 'REVOKED' | 'BANNED';
  last_login: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface UpsertMemberData {
  discordId: string;
  discordUsername: string;
  newApiUserId?: string;
}

export class DiscordMemberRepository {
  constructor(private pool: Pool) {}

  /**
   * Upsert a Discord member. Never updates role from input —
   * role is a security boundary that only revocation can change.
   */
  async upsertMember(data: UpsertMemberData): Promise<DiscordGateMember> {
    const { discordId, discordUsername, newApiUserId } = data;

    const query = `
      INSERT INTO discord_gate_members (discord_id, discord_username, new_api_user_id, last_login)
      VALUES ($1, $2, $3, NOW())
      ON CONFLICT (discord_id) DO UPDATE SET
        discord_username = EXCLUDED.discord_username,
        new_api_user_id  = COALESCE(EXCLUDED.new_api_user_id, discord_gate_members.new_api_user_id),
        last_login       = NOW(),
        updated_at       = NOW()
        -- role is never updated via upsert — security boundary
      RETURNING *;
    `;

    const result = await this.pool.query<DiscordGateMember>(query, [
      discordId,
      discordUsername,
      newApiUserId || null,
    ]);

    return result.rows[0];
  }

  /**
   * Find member by Discord ID
   */
  async findByDiscordId(discordId: string): Promise<DiscordGateMember | null> {
    const query = `SELECT * FROM discord_gate_members WHERE discord_id = $1;`;
    const result = await this.pool.query<DiscordGateMember>(query, [discordId]);
    return result.rows[0] || null;
  }

  /**
   * Find member by internal UUID
   */
  async findById(id: string): Promise<DiscordGateMember | null> {
    const query = `SELECT * FROM discord_gate_members WHERE id = $1;`;
    const result = await this.pool.query<DiscordGateMember>(query, [id]);
    return result.rows[0] || null;
  }

  /**
   * Revoke a member — sets status=REVOKED, role=REVOKED
   * Also logs audit entry
   */
  async revokeMember(discordId: string, reason: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // Revoke member
      await client.query(
        `UPDATE discord_gate_members SET status = 'REVOKED', role = 'REVOKED', updated_at = NOW() WHERE discord_id = $1;`,
        [discordId]
      );

      // Log audit entry
      await client.query(
        `INSERT INTO discord_gate_audit (event_type, discord_id, metadata)
         VALUES ($1, $2, $3);`,
        ['MANUAL_REVOKE', discordId, JSON.stringify({ reason })]
      );

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Get member statistics
   */
  async getStats(): Promise<{ total: number; active: number; revoked: number }> {
    const query = `
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status = 'ACTIVE') as active,
        COUNT(*) FILTER (WHERE status IN ('REVOKED', 'BANNED')) as revoked
      FROM discord_gate_members;
    `;
    const result = await this.pool.query(query);
    const row = result.rows[0];
    return {
      total: parseInt(row.total, 10),
      active: parseInt(row.active, 10),
      revoked: parseInt(row.revoked, 10),
    };
  }

  /**
   * Update member's new_api_user_id (called after New API provisioning)
   */
  async setNewApiUserId(discordId: string, newApiUserId: string): Promise<void> {
    const query = `
      UPDATE discord_gate_members
      SET new_api_user_id = $2, updated_at = NOW()
      WHERE discord_id = $1;
    `;
    await this.pool.query(query, [discordId, newApiUserId]);
  }

  /**
   * List all active members (for admin dashboard)
   */
  async listActive(limit = 100, offset = 0): Promise<DiscordGateMember[]> {
    const query = `
      SELECT * FROM discord_gate_members
      WHERE status = 'ACTIVE'
      ORDER BY created_at DESC
      LIMIT $1 OFFSET $2;
    `;
    const result = await this.pool.query<DiscordGateMember>(query, [limit, offset]);
    return result.rows;
  }
}