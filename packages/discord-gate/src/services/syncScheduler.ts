import { Client, GatewayIntentBits, GuildMember } from 'discord.js';
import axios from 'axios';
import { discordGateConfig } from '../config/discordGateConfig';
import { logger } from '../utils/logger.js';
import { memberRepo } from '../routes/auth.js';

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
export class SyncScheduler {
  private static instance: SyncScheduler;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private isRunning = false;

  private constructor() {}

  static getInstance(): SyncScheduler {
    if (!SyncScheduler.instance) {
      SyncScheduler.instance = new SyncScheduler();
    }
    return SyncScheduler.instance;
  }

  /**
   * Run a single sync cycle.
   * Fetches guild members, compares with DB, revokes missing members.
   */
  async runSync(): Promise<SyncResult> {
    if (this.isRunning) {
      logger.warn('SyncScheduler: sync already in progress, skipping');
      return { guildSize: 0, dbSize: 0, revoked: 0 };
    }

    this.isRunning = true;
    const startTime = Date.now();

    try {
      logger.info('SyncScheduler: starting sync cycle');

      // Step 1: Fetch all guild members from Discord API
      const { guildSize, inGuildIds } = await this.fetchGuildMembers();

      // Step 2: Get all ACTIVE members from discord_gate_members DB
      const dbMembers = await memberRepo.getAllActive();
      const dbSize = dbMembers.length;

      // Step 3: Find DB members NOT in guild (should be revoked)
      const toRevoke = dbMembers.filter((m) => !inGuildIds.has(m.discord_id));
      const toRevokeCount = toRevoke.length;

      logger.info('SyncScheduler: comparison complete', {
        guildSize,
        dbSize,
        toRevoke: toRevokeCount,
      });

      // Step 4: Revoke each (cap at 10 per sync to avoid overwhelming APIs)
      let revokedCount = 0;
      const maxPerSync = 10;
      const limitedToRevoke = toRevoke.slice(0, maxPerSync);

      for (const member of limitedToRevoke) {
        try {
          await this.callSidecarRevoke(member.discord_id, 'missed_guild_leave');
          revokedCount++;
          logger.info('SyncScheduler: revoked missing member', {
            discordId: member.discord_id,
            username: member.discord_username,
          });
          // Small delay between revocations to avoid overwhelming APIs
          await new Promise((resolve) => setTimeout(resolve, 500));
        } catch (error) {
          logger.error('SyncScheduler: failed to revoke member', {
            discordId: member.discord_id,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      const duration = Date.now() - startTime;
      const result: SyncResult = {
        guildSize,
        dbSize,
        revoked: revokedCount,
      };

      logger.info('SyncScheduler: sync cycle complete', {
        ...result,
        durationMs: duration,
        skipped: toRevokeCount - revokedCount,
      });

      return result;
    } catch (error) {
      logger.error('SyncScheduler: sync cycle failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      return { guildSize: 0, dbSize: 0, revoked: 0 };
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Call the sidecar's /internal/revoke-member endpoint directly.
   */
  private async callSidecarRevoke(discordId: string, reason: string): Promise<void> {
    const url = `${discordGateConfig.DISCORD_GATE_INTERNAL_URL}/internal/revoke-member`;

    const response = await axios.post(url, {
      discordId,
      reason,
    }, {
      headers: {
        'Content-Type': 'application/json',
        'x-internal-secret': discordGateConfig.BOT_INTERNAL_SECRET,
      },
      timeout: 10000,
    });

    if (!response.data.success) {
      throw new Error(`Sidecar revoke failed: ${JSON.stringify(response.data)}`);
    }
  }

  /**
   * Fetch all guild members from Discord API.
   * Creates a temporary client for the sync job.
   */
  private async fetchGuildMembers(): Promise<{ guildSize: number; inGuildIds: Set<string> }> {
    // Create a temporary client for fetching guild members
    const { Client, GatewayIntentBits, GuildMember } = await import('discord.js');
    
    const tempClient = new Client({
      intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
    });

    try {
      await tempClient.login(discordGateConfig.DISCORD_BOT_TOKEN);

      const guild = tempClient.guilds.cache.get(discordGateConfig.TARGET_GUILD_ID);
      if (!guild) {
        throw new Error(`Target guild ${discordGateConfig.TARGET_GUILD_ID} not found`);
      }

      const members = await guild.members.fetch();
      const inGuildIds: Set<string> = new Set<string>();
      members.forEach((member: GuildMember) => {
        inGuildIds.add(member.id);
      });

      logger.info('SyncScheduler: fetched guild members', {
        guildId: guild.id,
        memberCount: members.size,
      });

      return {
        guildSize: members.size,
        inGuildIds,
      };
    } finally {
      tempClient.destroy();
    }
  }

  /**
   * Start the periodic sync scheduler.
   * Runs on startup (after 30s delay) then every SYNC_INTERVAL_MINUTES.
   */
  start(): void {
    if (this.intervalId) {
      logger.warn('SyncScheduler: already started');
      return;
    }

    const intervalMinutes = parseInt(process.env.SYNC_INTERVAL_MINUTES ?? '30', 10);
    const intervalMs = intervalMinutes * 60 * 1000;

    // Run initial sync after 30 seconds (give services time to start)
    setTimeout(() => {
      logger.info('SyncScheduler: running initial sync');
      this.runSync().catch((err) => {
        logger.error('SyncScheduler: initial sync failed', { error: err });
      });
    }, 30000);

    // Then run periodically
    this.intervalId = setInterval(() => {
      logger.info('SyncScheduler: running scheduled sync');
      this.runSync().catch((err) => {
        logger.error('SyncScheduler: scheduled sync failed', { error: err });
      });
    }, intervalMs);

    logger.info('SyncScheduler: started', { intervalMinutes });
  }

  /**
   * Stop the scheduler.
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      logger.info('SyncScheduler: stopped');
    }
  }
}

// Singleton export
export const syncScheduler = SyncScheduler.getInstance();