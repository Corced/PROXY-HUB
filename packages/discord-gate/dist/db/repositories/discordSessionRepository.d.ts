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
export declare class DiscordSessionRepository {
    private pool;
    constructor(pool: Pool);
    /**
     * Create a new session
     */
    createSession(data: CreateSessionData): Promise<DiscordGateSession>;
    /**
     * Find session by token
     */
    findByToken(token: string): Promise<DiscordGateSession | null>;
    /**
     * Find valid (non-revoked, non-expired) session by token
     */
    findValidByToken(token: string): Promise<DiscordGateSession | null>;
    /**
     * Revoke a session by token
     */
    revokeSession(token: string): Promise<void>;
    /**
     * Revoke all sessions for a member
     * Returns count of revoked sessions
     */
    revokeAllMemberSessions(memberId: string): Promise<number>;
    /**
     * Clean up expired sessions (maintenance job)
     * Returns count of cleaned sessions
     */
    cleanExpired(): Promise<number>;
    /**
     * Get session count for a member (for rate limiting / monitoring)
     */
    getActiveSessionCount(memberId: string): Promise<number>;
}
//# sourceMappingURL=discordSessionRepository.d.ts.map