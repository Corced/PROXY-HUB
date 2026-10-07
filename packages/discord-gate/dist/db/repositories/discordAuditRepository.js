export class DiscordAuditRepository {
    pool;
    constructor(pool) {
        this.pool = pool;
    }
    /**
     * Log an audit event.
     * Never throws — catches DB errors internally and logs to console.
     * This ensures audit logging never breaks the main flow.
     */
    async log(event) {
        const query = `
      INSERT INTO discord_gate_audit (event_type, discord_id, new_api_user_id, ip_address, metadata)
      VALUES ($1, $2, $3, $4, $5);
    `;
        try {
            await this.pool.query(query, [
                event.eventType,
                event.discordId || null,
                event.newApiUserId || null,
                event.ipAddress || null,
                JSON.stringify(event.metadata || {}),
            ]);
        }
        catch (error) {
            // Never throw — audit logging must not break main flow
            console.error('[DiscordAuditRepository] Failed to log audit event:', {
                eventType: event.eventType,
                discordId: event.discordId,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }
    /**
     * Get recent audit events for a Discord user
     */
    async getRecentByDiscordId(discordId, limit = 100) {
        const query = `
      SELECT * FROM discord_gate_audit
      WHERE discord_id = $1
      ORDER BY created_at DESC
      LIMIT $2;
    `;
        const result = await this.pool.query(query, [discordId, limit]);
        return result.rows;
    }
    /**
     * Get recent audit events by event type
     */
    async getRecentByEventType(eventType, limit = 100) {
        const query = `
      SELECT * FROM discord_gate_audit
      WHERE event_type = $1
      ORDER BY created_at DESC
      LIMIT $2;
    `;
        const result = await this.pool.query(query, [eventType, limit]);
        return result.rows;
    }
    /**
     * Get audit statistics
     */
    async getStats() {
        const totalQuery = `SELECT COUNT(*) as total FROM discord_gate_audit;`;
        const byEventQuery = `
      SELECT event_type, COUNT(*) as count
      FROM discord_gate_audit
      GROUP BY event_type;
    `;
        const last24hQuery = `
      SELECT COUNT(*) as count
      FROM discord_gate_audit
      WHERE created_at > NOW() - INTERVAL '24 hours';
    `;
        const [totalResult, byEventResult, last24hResult] = await Promise.all([
            this.pool.query(totalQuery),
            this.pool.query(byEventQuery),
            this.pool.query(last24hQuery),
        ]);
        const byEventType = {};
        byEventResult.rows.forEach((row) => {
            byEventType[row.event_type] = parseInt(row.count, 10);
        });
        return {
            total: parseInt(totalResult.rows[0].total, 10),
            byEventType,
            last24h: parseInt(last24hResult.rows[0].count, 10),
        };
    }
}
//# sourceMappingURL=discordAuditRepository.js.map