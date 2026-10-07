import axios, { AxiosInstance, AxiosError, InternalAxiosRequestConfig } from 'axios';
import { v4 as uuidv4 } from 'uuid';
import { discordGateConfig } from '@proxy-hub/discord-gate/config/discordGateConfig';
import { logger } from '../utils/logger';

export interface RevokeResult {
  success: boolean;
  sessionsRevoked: number;
  keysRevoked: number;
}

export interface MemberStatus {
  id: string;
  discord_id: string;
  discord_username: string;
  new_api_user_id: string | null;
  role: 'MEMBER' | 'REVOKED';
  status: 'ACTIVE' | 'REVOKED' | 'BANNED';
  last_login: string | null;
  created_at: string;
  updated_at: string;
}

export interface HealthCheckResult {
  status: 'ok' | 'degraded' | 'down';
  service: string;
  uptime?: number;
  checks?: {
    redis: boolean;
    database: boolean;
  };
  error?: string;
}

export interface RateLimitUsage {
  count: number;
  limit: number;
  windowSeconds: number;
  resetInSeconds: number;
}

/**
 * SidecarClient — Centralized HTTP client for bot → DiscordGate sidecar communication.
 * Handles retries, logging, request IDs, and consistent error handling.
 */
export class SidecarClient {
  private static instance: SidecarClient;
  private client: AxiosInstance;
  // Store request metadata in a Map keyed by request ID
  private requestMetadata = new Map<string, { startTime: number; requestId: string }>();

  private constructor() {
    this.client = axios.create({
      baseURL: discordGateConfig.DISCORD_GATE_INTERNAL_URL,
      timeout: 5000,
      headers: {
        'Content-Type': 'application/json',
        'x-internal-secret': discordGateConfig.BOT_INTERNAL_SECRET,
      },
    });

    // Request interceptor: add request ID and log
    this.client.interceptors.request.use((config: InternalAxiosRequestConfig) => {
      const requestId = uuidv4();
      config.headers['x-request-id'] = requestId;
      this.requestMetadata.set(requestId, { startTime: Date.now(), requestId });
      logger.debug('SidecarClient request', {
        requestId,
        method: config.method?.toUpperCase(),
        url: config.url,
      });
      return config;
    });

    // Response interceptor: log duration and status
    this.client.interceptors.response.use(
      (response) => {
        const requestId = response.config.headers?.['x-request-id'] as string | undefined;
        const meta = requestId ? this.requestMetadata.get(requestId) : undefined;
        const duration = meta ? Date.now() - meta.startTime : 0;
        if (requestId) this.requestMetadata.delete(requestId);

        logger.debug('SidecarClient response', {
          requestId,
          status: response.status,
          duration,
          url: response.config.url,
        });
        return response;
      },
      (error: AxiosError) => {
        const requestId = error.config?.headers?.['x-request-id'] as string | undefined;
        const meta = requestId ? this.requestMetadata.get(requestId) : undefined;
        const duration = meta ? Date.now() - meta.startTime : 0;
        if (requestId) this.requestMetadata.delete(requestId);

        logger.warn('SidecarClient error response', {
          requestId,
          status: error.response?.status,
          duration,
          url: error.config?.url,
          message: error.message,
        });
        return Promise.reject(error);
      }
    );
  }

  static getInstance(): SidecarClient {
    if (!SidecarClient.instance) {
      SidecarClient.instance = new SidecarClient();
    }
    return SidecarClient.instance;
  }

  /**
   * Generic retry logic with exponential backoff.
   * Retries on: network error, 500, 503
   * No retry on: 400, 401, 404
   * Returns null on all failures (never throws)
   */
  private async retryWithBackoff<T>(
    fn: () => Promise<T>,
    context: { operation: string; params: unknown }
  ): Promise<T | null> {
    const backoff = [1000, 2000, 4000];

    for (let attempt = 0; attempt < backoff.length; attempt++) {
      try {
        return await fn();
      } catch (error) {
        const axiosError = error as AxiosError;
        const status = axiosError.response?.status;

        // Don't retry on client errors (4xx)
        if (status && status >= 400 && status < 500) {
          logger.error('SidecarClient: client error, no retry', {
            operation: context.operation,
            params: context.params,
            status,
            response: axiosError.response?.data,
          });
          return null;
        }

        // Last attempt - log and return null
        if (attempt >= backoff.length - 1) {
          logger.error('SidecarClient: all retries exhausted', {
            operation: context.operation,
            params: context.params,
            error: error instanceof Error ? error.message : String(error),
            status,
          });
          return null;
        }

        // Retry on server errors (5xx) or network issues
        logger.warn('SidecarClient: retrying', {
          operation: context.operation,
          params: context.params,
          attempt: attempt + 1,
          status,
          error: error instanceof Error ? error.message : String(error),
          backoffMs: backoff[attempt],
        });
        await new Promise((resolve) => setTimeout(resolve, backoff[attempt]));
      }
    }

    return null;
  }

  /**
   * Revoke a member's sessions and API keys via the sidecar.
   * Calls POST /internal/revoke-member
   */
  async revokeMember(params: {
    discordId: string;
    reason: 'member_left' | 'member_banned' | 'manual';
  }): Promise<{ success: boolean; sessionsRevoked: number; keysRevoked: number } | null> {
    return this.retryWithBackoff(
      async () => {
        const response = await this.client.post<{ success: boolean; sessionsRevoked: number; keysRevoked: number }>(
          '/internal/revoke-member',
          {
            discordId: params.discordId,
            reason: params.reason,
          }
        );

        if (!response.data.success) {
          throw new Error('Sidecar returned success: false');
        }

        return response.data;
      },
      { operation: 'revokeMember', params }
    );
  }

  /**
   * Get member status from sidecar.
   * Calls GET /internal/member/:discordId
   * Returns null on 404 or failure.
   */
  async getMemberStatus(discordId: string): Promise<MemberStatus | null> {
    return this.retryWithBackoff(
      async () => {
        const response = await this.client.get<MemberStatus>(`/internal/member/${discordId}`);
        return response.data;
      },
      { operation: 'getMemberStatus', params: { discordId } }
    );
  }

  /**
   * Check sidecar health.
   * Calls GET /health (no x-internal-secret header).
   */
  async checkHealth(): Promise<HealthCheckResult | null> {
    try {
      // Create a temporary client without the internal secret header
      const healthClient = axios.create({
        baseURL: discordGateConfig.DISCORD_GATE_INTERNAL_URL,
        timeout: 3000,
      });

      const response = await healthClient.get<HealthCheckResult>('/health');
      return response.data;
    } catch (error) {
      logger.error('SidecarClient: health check failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Get rate limit usage for a Discord user.
   * Calls GET /internal/ratelimit/:discordId
   */
  async getRateLimitUsage(discordId: string): Promise<RateLimitUsage | null> {
    return this.retryWithBackoff(
      async () => {
        const response = await this.client.get<RateLimitUsage>(`/internal/ratelimit/${discordId}`);
        return response.data;
      },
      { operation: 'getRateLimitUsage', params: { discordId } }
    );
  }

  /**
   * Reset rate limit for a Discord user.
   * Calls POST /internal/ratelimit/reset/:discordId
   */
  async resetRateLimit(discordId: string): Promise<{ success: boolean } | null> {
    return this.retryWithBackoff(
      async () => {
        const response = await this.client.post<{ success: boolean }>(`/internal/ratelimit/reset/${discordId}`);
        return response.data;
      },
      { operation: 'resetRateLimit', params: { discordId } }
    );
  }

  /**
   * Generic POST method for custom endpoints
   */
  async post<T>(path: string, data: unknown): Promise<T | null> {
    return this.retryWithBackoff(
      async () => {
        const response = await this.client.post<T>(path, data);
        return response.data;
      },
      { operation: `POST ${path}`, params: data }
    );
  }

  /**
   * Generic GET method for custom endpoints
   */
  async get<T>(path: string): Promise<T | null> {
    return this.retryWithBackoff(
      async () => {
        const response = await this.client.get<T>(path);
        return response.data;
      },
      { operation: `GET ${path}`, params: { path } }
    );
  }
}

// Singleton export
export const sidecarClient = SidecarClient.getInstance();