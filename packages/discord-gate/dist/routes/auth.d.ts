import { RedisClientType } from 'redis';
export declare const redis: RedisClientType;
export declare const newApiSync: import("../services/newApiSync").NewApiSync;
export declare const newApiBridge: import("../services/newApiBridge").NewApiBridge;
import { DiscordMemberRepository } from '../db/repositories/discordMemberRepository';
import { DiscordSessionRepository } from '../db/repositories/discordSessionRepository';
import { DiscordAuditRepository } from '../db/repositories/discordAuditRepository';
import { Pool } from 'pg';
export declare const pgPool: Pool;
export declare const memberRepo: DiscordMemberRepository;
export declare const sessionRepo: DiscordSessionRepository;
export declare const auditRepo: DiscordAuditRepository;
declare const router: import("express-serve-static-core").Router;
export interface SessionData {
    discordId: string;
    discordUsername: string;
    createdAt: number;
}
export declare function createSession(discordId: string, discordUsername: string): Promise<string>;
export declare function validateSession(token: string): Promise<SessionData | null>;
export declare function revokeSession(token: string): Promise<void>;
export declare function revokeAllMemberSessions(discordId: string): Promise<number>;
export declare function verifyGuildMembership(discordId: string): Promise<{
    isMember: boolean;
}>;
export default router;
//# sourceMappingURL=auth.d.ts.map