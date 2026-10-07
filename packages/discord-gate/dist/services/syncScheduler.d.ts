export interface SyncResult {
    guildSize: number;
    dbSize: number;
    revoked: number;
}
/**
 * SyncScheduler - Periodic job that reconciles Discord guild members
 * with the discord_gate_members database.
 * Catches cases where the bot was offline during a leave event.
 */
export declare class SyncScheduler {
    private static instance;
    private intervalId;
    private isRunning;
    private constructor();
    static getInstance(): SyncScheduler;
    /**
     * Run a single sync cycle.
     * Fetches guild members, compares with DB, revokes missing members.
     */
    runSync(): Promise<SyncResult>;
    /**
     * Call the sidecar's /internal/revoke-member endpoint directly.
     */
    private callSidecarRevoke;
    /**
     * Fetch all guild members from Discord API.
     * Creates a temporary client for the sync job.
     */
    private fetchGuildMembers;
    /**
     * Start the periodic sync scheduler.
     * Runs on startup (after 30s delay) then every SYNC_INTERVAL_MINUTES.
     */
    start(): void;
    /**
     * Stop the scheduler.
     */
    stop(): void;
}
export declare const syncScheduler: SyncScheduler;
//# sourceMappingURL=syncScheduler.d.ts.map