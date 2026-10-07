import { randomBytes } from 'crypto';
import { pool } from '../src/db/pool';
import { discordGateConfig } from '../src/config/discordGateConfig';
import { discordAuditRepository } from '../src/db/repositories/discordAuditRepository';
import type { DiscordGateEventType } from '../src/db/repositories/discordAuditRepository';

/**
 * Generate a random session token
 */
export function generateSessionToken(): string {
  return randomBytes(32).toString('hex');
}

/**
 * Create a test Discord user ID (snowflake format)
 */
export function generateDiscordId(): string {
  // Discord snowflakes are 17-19 digit numbers
  const timestamp = Date.now() - 1420070400000; // Discord epoch
  const randomPart = Math.floor(Math.random() * 4096);
  return BigInt(timestamp) << 22n | BigInt(randomPart) << 17n | BigInt(Math.floor(Math.random() * 131072)).toString();
}

/**
 * Create a mock Discord user profile
 */
export function createMockDiscordUser(overrides: Partial<{
  id: string;
  username: string;
  discriminator: string;
  global_name: string;
  avatar: string;
}> = {}) {
  const id = overrides.id || generateDiscordId();
  return {
    id,
    username: overrides.username || `testuser_${id.slice(-4)}`,
    discriminator: overrides.discriminator || '0001',
    global_name: overrides.global_name || overrides.username,
    avatar: overrides.avatar || null,
    email: `${overrides.username || 'test'}@example.com`,
    verified: true,
    locale: 'en-US',
  };
}

/**
 * Set guild membership for a user in MSW mock
 */
export function setMockMembership(discordId: string, isMember: boolean): void {
  // This will be handled by the MSW handlers
  // We store it in a global that the handlers can access
  (global as any).__mockMembership = (global as any).__mockMembership || new Map();
  (global as any).__mockMembership.set(discordId, isMember);
}

/**
 * Clear all mock memberships
 */
export function clearMockMemberships(): void {
  (global as any).__mockMembership = new Map();
}

/**
 * Check if a user is a mock guild member
 */
export function isMockMember(discordId: string): boolean {
  return (global as any).__mockMembership?.get(discordId) ?? false;
}

/**
 * Create a session in Redis for testing
 */
export async function createTestSession(discordId: string, discordUsername: string): Promise<string> {
  const token = generateSessionToken();
  const sessionData = {
    discordId,
    discordUsername,
    createdAt: Date.now(),
  };
  await redis.setEx(`session:${token}`, 604800, JSON.stringify(sessionData));
  return token;
}

/**
 * Create a test member in the database
 */
export async function createTestMember(data: {
  discordId: string;
  discordUsername: string;
  newApiUserId?: string;
  role?: 'MEMBER' | 'REVOKED';
  status?: 'ACTIVE' | 'REVOKED' | 'BANNED';
}): Promise<void> {
  await pool.query(
    `INSERT INTO discord_gate_members (discord_id, discord_username, new_api_user_id, role, status, last_login)
     VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT (discord_id) DO UPDATE SET
       discord_username = EXCLUDED.discord_username,
       new_api_user_id = COALESCE(EXCLUDED.new_api_user_id, discord_gate_members.new_api_user_id),
       role = EXCLUDED.role,
       status = EXCLUDED.status,
       updated_at = NOW()`,
    [data.discordId, data.discordUsername, data.newApiUserId || null, data.role || 'MEMBER', data.status || 'ACTIVE']
  );
}

/**
 * Create a test session in the database
 */
export async function createTestDBSession(memberId: string, token: string, expiresAt: Date): Promise<void> {
  await pool.query(
    `INSERT INTO discord_gate_sessions (member_id, session_token, expires_at) VALUES ($1, $2, $3)`,
    [memberId, token, expiresAt]
  );
}

/**
 * Login as a test user (full OAuth flow simulation)
 */
export async function loginAs(discordId: string): Promise<{ accessToken: string; cookie: string }> {
  // Set membership to true
  setMockMembership(discordId, true);

  // Create session
  const token = await createTestSession(discordId, `testuser_${discordId.slice(-4)}`);

  // Create member in DB
  await createTestMember({ discordId, discordUsername: `testuser_${discordId.slice(-4)}` });

  return {
    accessToken: token,
    cookie: `discord_gate_session=${token}`,
  };
}

/**
 * Expect an audit log entry to exist
 */
export async function expectAuditLog(
  eventType: string,
  discordId: string
): Promise<void> {
  const result = await pool.query(
    'SELECT * FROM discord_gate_audit WHERE event_type = $1 AND discord_id = $2 ORDER BY created_at DESC LIMIT 1',
    [eventType, discordId]
  );

  if (result.rows.length === 0) {
    throw new Error(`Missing audit log: ${eventType} for ${discordId}`);
  }
}

/**
 * Get audit logs for a user
 */
export async function getAuditLogs(discordId: string, limit = 10) {
  const result = await pool.query(
    'SELECT * FROM discord_gate_audit WHERE discord_id = $1 ORDER BY created_at DESC LIMIT $2',
    [discordId, limit]
  );
  return result.rows;
}

/**
 * Clear all test data
 */
export async function clearTestData(): Promise<void> {
  await pool.query('DELETE FROM discord_gate_audit');
  await pool.query('DELETE FROM discord_gate_sessions');
  await pool.query('DELETE FROM discord_gate_members');
  await redis.flushdb();
  clearMockMemberships();
}