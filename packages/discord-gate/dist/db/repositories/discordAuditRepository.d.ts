import { Pool } from 'pg';
export type DiscordGateEventType = 'LOGIN_SUCCESS' | 'LOGIN_DENIED_NOT_MEMBER' | 'SESSION_REVOKED' | 'MEMBER_LEFT_GUILD' | 'MEMBER_BANNED' | 'MANUAL_REVOKE' | 'API_KEY_REVOKED' | 'USER_PROVISIONED' | 'USER_DISABLED';
export interface DiscordAuditLog {
    id: number;
    event_type: DiscordGateEventType;
    discord_id: string | null;
    new_api_user_id: string | null;
    ip_address: string | null;
    metadata: Record<string, unknown>;
    created_at: Date;
}
export interface AuditEventData {
    eventType: DiscordGateEventType;
    discordId?: string;
    newApiUserId?: string;
    ipAddress?: string;
    metadata?: Record<string, unknown>;
}
export declare class DiscordAuditRepository {
    private pool;
    constructor(pool: Pool);
    /**
     * Log an audit event.
     * Never throws — catches DB errors internally and logs to console.
     * This ensures audit logging never breaks the main flow.
     */
    log(event: AuditEventData): Promise<void>;
    /**
     * Get recent audit events for a Discord user
     */
    getRecentByDiscordId(discordId: string, limit?: number): Promise<DiscordAuditLog[]>;
    /**
     * Get recent audit events by event type
     */
    getRecentByEventType(eventType: DiscordGateEventType, limit?: number): Promise<DiscordAuditLog[]>;
    /**
     * Get audit statistics
     */
    getStats(): Promise<{
        total: number;
        byEventType: Record<string, number>;
        last24h: number;
    }>;
}
//# sourceMappingURL=discordAuditRepository.d.ts.map