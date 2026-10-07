import { Pool } from 'pg';

export interface DiscordGateSession {
  id: string;
  member_id: string;
  session_token: string;
  ip_address: string | null;
  user_agent: string | null;
  created_at: Date;
  expires_at: Date;
  revoked_at: Date | null;
}

export interface CreateSessionData {
  memberId: string;
  sessionToken: string;
  ipAddress?: string;
  userAgent?: string;
  expiresAt: Date;
}

export class DiscordSessionRepository {
  constructor(private pool: Pool) {}

  /**
   * Create a new session
   */
  async createSession(data: CreateSessionData): Promise<DiscordGateSession> {
    const query = `
      INSERT INTO discord_gate_sessions (member_id, session_token, ip_address, user_agent, expires_at)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *;
    `;
    const result = await this.pool.query<DiscordGateSession>(query, [
      data.memberId,
      data.sessionToken,
      data.ipAddress || null,
      data.userAgent || null,
      data.expiresAt,
    ]);
    return result.rows[0];
  }

  /**
   * Find session by token
   */
  async findByToken(token: string): Promise<DiscordGateSession | null> {
    const query = `SELECT * FROM discord_gate_sessions WHERE session_token = $1;`;
    const result = await this.pool.query<DiscordGateSession>(query, [token]);
    return result.rows[0] || null;
  }

  /**
   * Find valid (non-revoked, non-expired) session by token
   */
  async findValidByToken(token: string): Promise<DiscordGateSession | null> {
    const query = `
      SELECT * FROM discord_gate_sessions
      WHERE session_token = $1
        AND revoked_at IS NULL
        AND expires_at > NOW();
    `;
    const result = await this.pool.query<DiscordGateSession>(query, [token]);
    return result.rows[0] || null;
  }

  /**
   * Revoke a session by token
   */
  async revokeSession(token: string): Promise<void> {
    const query = `
      UPDATE discord_gate_sessions
      SET revoked_at = NOW()
      WHERE session_token = $1;
    `;
    await this.pool.query(query, [token]);
  }

  /**
   * Revoke all sessions for a member
   * Returns count of revoked sessions
   */
  async revokeAllMemberSessions(memberId: string): Promise<number> {
    const query = `
      UPDATE discord_gate_sessions
      SET revoked_at = NOW()
      WHERE member_id = $1
        AND revoked_at IS NULL;
    `;
    const result = await this.pool.query(query, [memberId]);
    return result.rowCount || 0;
  }

  /**
   * Clean up expired sessions (maintenance job)
   * Returns count of cleaned sessions
   */
  async cleanExpired(): Promise<number> {
    const query = `
      DELETE FROM discord_gate_sessions
      WHERE expires_at < NOW()
        AND revoked_at IS NULL;
    `;
    const result = await this.pool.query(query);
    return result.rowCount || 0;
  }

  /**
   * Get session count for a member (for rate limiting / monitoring)
   */
  async getActiveSessionCount(memberId: string): Promise<number> {
    const query = `
      SELECT COUNT(*) FROM discord_gate_sessions
      WHERE member_id = $1
        AND revoked_at IS NULL
        AND expires_at > NOW();
    `;
    const result = await this.pool.query(query, [memberId]);
    return parseInt(result.rows[0].count, 10);
  }
}