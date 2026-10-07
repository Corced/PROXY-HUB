import { Pool } from 'pg';
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
export declare class DiscordMemberRepository {
    private pool;
    constructor(pool: Pool);
    /**
     * Upsert a Discord member. Never updates role from input —
     * role is a security boundary that only revocation can change.
     */
    upsertMember(data: UpsertMemberData): Promise<DiscordGateMember>;
    /**
     * Find member by Discord ID
     */
    findByDiscordId(discordId: string): Promise<DiscordGateMember | null>;
    /**
     * Find member by internal UUID
     */
    findById(id: string): Promise<DiscordGateMember | null>;
    /**
     * Revoke a member — sets status=REVOKED, role=REVOKED
     * Also logs audit entry
     */
    revokeMember(discordId: string, reason: string): Promise<void>;
    /**
     * Get member statistics
     */
    getStats(): Promise<{
        total: number;
        active: number;
        revoked: number;
    }>;
    /**
     * Update member's new_api_user_id (called after New API provisioning)
     */
    setNewApiUserId(discordId: string, newApiUserId: string): Promise<void>;
    /**
     * List all active members (for admin dashboard)
     */
    listActive(limit?: number, offset?: number): Promise<DiscordGateMember[]>;
    /**
     * Get all ACTIVE members (for sync scheduler)
     * Returns all members with status='ACTIVE'
     */
    getAllActive(): Promise<DiscordGateMember[]>;
}
export declare function getMemberRepo(): DiscordMemberRepository;
export declare function setMemberRepo(repo: DiscordMemberRepository): void;
//# sourceMappingURL=discordMemberRepository.d.ts.map