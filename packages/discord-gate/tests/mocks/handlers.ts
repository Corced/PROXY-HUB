import { http, HttpResponse } from 'msw';

/**
 * Lazy-loaded config - only loads when first accessed
 * This allows test setup to set environment variables first
 */
let cachedConfig: any = null;

function getConfig() {
  if (!cachedConfig) {
    // Dynamic import to allow env vars to be set first
    const configModule = require('../../src/config/discordGateConfig');
    cachedConfig = configModule.discordGateConfig;
  }
  return cachedConfig;
}

// Lazy-loaded imports
let pool: any = null;
let redis: any = null;

async function getPool() {
  if (!pool) {
    const poolModule = require('../../src/db/pool');
    pool = poolModule.pool;
  }
  return pool;
}

async function getRedis() {
  if (!redis) {
    const redisModule = require('../../src/db/redis');
    redis = redisModule.redis;
  }
  return redis;
}

/**
 * Discord API mock handlers
 */
export const discordApiHandlers = [
  // Get guild member - used by bot and sidecar
  http.get('https://discord.com/api/v10/guilds/:guildId/members/:userId', async ({ params }) => {
    const { userId } = params;
    const isMember = isMockMember(userId);

    if (!isMember) {
      return new HttpResponse(JSON.stringify({ message: 'Unknown Member', code: 10007 }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return HttpResponse.json({
      user: {
        id: userId,
        username: `testuser_${userId.slice(-4)}`,
        discriminator: '0001',
        global_name: `testuser_${userId.slice(-4)}`,
        avatar: null,
      },
      roles: ['1234567890'],
      joined_at: new Date().toISOString(),
      deaf: false,
      mute: false,
      pending: false,
    });
  }),

  // Get user info - used by OAuth callback
  http.get('https://discord.com/api/v10/users/@me', async ({ request }) => {
    const authHeader = request.headers.get('Authorization');
    return HttpResponse.json({
      id: '123456789012345678',
      username: 'testuser',
      discriminator: '0001',
      global_name: 'Test User',
      avatar: null,
      email: 'test@example.com',
      verified: true,
      locale: 'en-US',
    });
  }),

  // Exchange code for token - used by OAuth callback
  http.post('https://discord.com/api/v10/oauth2/token', async ({ request }) => {
    const formData = await request.formData();
    const code = formData.get('code');
    const grantType = formData.get('grant_type');

    if (grantType !== 'authorization_code' || !code) {
      return HttpResponse.json(
        { error: 'invalid_grant', error_description: 'Invalid code' },
        { status: 400 }
      );
    }

    return HttpResponse.json({
      access_token: 'mock_access_token_' + Math.random().toString(36).slice(2),
      token_type: 'Bearer',
      expires_in: 604800,
      refresh_token: 'mock_refresh_token_' + Math.random().toString(36).slice(2),
      scope: 'identify guilds.members.read',
    });
  }),
];

/**
 * Bot internal HTTP server handlers
 */
export const botServerHandlers = [
  // Health check
  http.get(() => {
    const config = getConfig();
    return `http://localhost:${config.BOT_PORT}/internal/health`;
  }, () => {
    return HttpResponse.json({
      status: 'ok',
      service: 'discord-bot',
      uptime: process.uptime(),
    });
  }),

  // Member verification - called by sidecar
  http.get(() => {
    const config = getConfig();
    return `http://localhost:${config.BOT_PORT}/internal/verify/:discordUserId`;
  }, async ({ params, request }) => {
    const { discordUserId } = params;
    const internalSecret = request.headers.get('x-internal-secret');
    const config = getConfig();

    if (internalSecret !== config.BOT_INTERNAL_SECRET) {
      return new HttpResponse(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const isMember = isMockMember(discordUserId);

    if (!isMember) {
      return HttpResponse.json({ isMember: false, roles: [] });
    }

    return HttpResponse.json({
      isMember: true,
      roles: ['1234567890'],
    });
  }),

  // Whitelist endpoints
  http.post(() => {
    const config = getConfig();
    return `http://localhost:${config.BOT_PORT}/internal/whitelist/add`;
  }, async ({ request }) => {
    const internalSecret = request.headers.get('x-internal-secret');
    const config = getConfig();

    if (internalSecret !== config.BOT_INTERNAL_SECRET) {
      return new HttpResponse(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    }
    return HttpResponse.json({ success: true });
  }),

  http.post(() => {
    const config = getConfig();
    return `http://localhost:${config.BOT_PORT}/internal/whitelist/remove`;
  }, async ({ request }) => {
    const internalSecret = request.headers.get('x-internal-secret');
    const config = getConfig();

    if (internalSecret !== config.BOT_INTERNAL_SECRET) {
      return new HttpResponse(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    }
    return HttpResponse.json({ success: true });
  }),
];

/**
 * New API admin endpoints mock handlers
 */
export const newApiHandlers = [
  // List users - supports keyword search
  http.get('http://localhost:3000/api/admin/users', async ({ request }) => {
    const url = new URL(request.url);
    const keyword = url.searchParams.get('keyword') || '';

    const users = (global as any).__mockNewApiUsers || new Map();
    let filteredUsers = Array.from(users.values());

    if (keyword) {
      filteredUsers = filteredUsers.filter(u =>
        u.username.includes(keyword) || u.discord_id?.includes(keyword)
      );
    }

    return HttpResponse.json({
      data: {
        items: filteredUsers,
        total: filteredUsers.length,
      },
    });
  }),

  // Create user
  http.post('http://localhost:3000/api/admin/users', async ({ request }) => {
    const body = await request.json();
    const newUser = {
      id: Math.floor(Math.random() * 1000000),
      username: body.username,
      display_name: body.display_name,
      discord_id: body.discord_id,
      email: body.email || '',
      role: body.role || 1,
      status: body.status || 1,
      group: body.group || 'default',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const users = (global as any).__mockNewApiUsers || new Map();
    if (body.discord_id) {
      users.set(body.discord_id, newUser);
    }
    (global as any).__mockNewApiUsers = users;

    return HttpResponse.json({ data: newUser });
  }),

  // Get user by ID
  http.get('http://localhost:3000/api/admin/users/:id', async ({ params }) => {
    const { id } = params;
    const users = (global as any).__mockNewApiUsers || new Map();
    const user = Array.from(users.values()).find(u => u.id === parseInt(id));

    if (!user) {
      return new HttpResponse(JSON.stringify({ error: 'User not found' }), { status: 404 });
    }

    return HttpResponse.json({ data: user });
  }),

  // Update user (disable, enable, update group)
  http.put('http://localhost:3000/api/admin/users/:id', async ({ params, request }) => {
    const { id } = params;
    const body = await request.json();
    const users = (global as any).__mockNewApiUsers || new Map();
    const userIndex = Array.from(users.values()).findIndex(u => u.id === parseInt(id));

    if (userIndex === -1) {
      return new HttpResponse(JSON.stringify({ error: 'User not found' }), { status: 404 });
    }

    const user = Array.from(users.values())[userIndex];
    const updatedUser = {
      ...user,
      status: body.action === 'disable' ? 0 : body.action === 'enable' ? 1 : user.status,
      group: body.group || user.group,
      updated_at: new Date().toISOString(),
    };

    const discordId = user.discord_id;
    if (discordId) {
      const users = (global as any).__mockNewApiUsers || new Map();
      users.set(discordId, updatedUser);
    }

    return HttpResponse.json({ data: updatedUser });
  }),

  // List user tokens
  http.get('http://localhost:3000/api/user/:userId/tokens', async ({ params }) => {
    const { userId } = params;
    const tokens = (global as any).__mockNewApiTokens || new Map();
    const userTokens = Array.from(tokens.values()).filter(t => t.user_id === parseInt(userId));

    return HttpResponse.json({
      data: {
        items: userTokens,
        total: userTokens.length,
      },
    });
  }),

  // Bulk delete tokens
  http.post('http://localhost:3000/api/user/tokens/batch', async ({ request }) => {
    const { ids } = await request.json();
    const tokens = (global as any).__mockNewApiTokens || new Map();

    let revokedCount = 0;
    for (const id of ids) {
      if (tokens.has(id)) {
        tokens.delete(id);
        revokedCount++;
      }
    }

    return HttpResponse.json({ data: revokedCount });
  }),

  // Delete single token
  http.delete('http://localhost:3000/api/user/tokens/:id', async ({ params }) => {
    const { id } = params;
    const tokens = (global as any).__mockNewApiTokens || new Map();
    tokens.delete(id);
    return HttpResponse.json({ success: true });
  }),

  // Status endpoint for health checks
  http.get('http://localhost:3000/api/status', () => {
    return HttpResponse.json({ status: 'ok' });
  }),
];

// Combine all handlers
export const handlers = [
  ...discordApiHandlers,
  ...botServerHandlers,
  ...newApiHandlers,
];

// Global mock state
function isMockMember(userId: string): boolean {
  const memberships = (global as any).__mockMembership || new Map();
  return memberships.get(userId) ?? false;
}

// Export helpers for test setup
export function setMockMembership(discordId: string, isMember: boolean): void {
  const memberships = (global as any).__mockMembership = (global as any).__mockMembership || new Map();
  memberships.set(discordId, isMember);
}

export function clearMockMemberships(): void {
  (global as any).__mockMembership = new Map();
}

export function setMockNewApiUser(discordId: string, user: any): void {
  const users = (global as any).__mockNewApiUsers = (global as any).__mockNewApiUsers || new Map();
  users.set(discordId, { ...user, discord_id: discordId });
}

export function clearMockNewApiUsers(): void {
  (global as any).__mockNewApiUsers = new Map();
}

export function setMockNewApiToken(token: any): void {
  const tokens = (global as any).__mockNewApiTokens = (global as any).__mockNewApiTokens || new Map();
  tokens.set(token.id, token);
}

export function clearMockNewApiTokens(): void {
  (global as any).__mockNewApiTokens = new Map();
}