import { Router } from 'express';
import { createClient } from 'redis';
import { discordGateConfig } from '../config/discordGateConfig';
import { initNewApiSync } from '../services/newApiSync';
import { initNewApiBridge } from '../services/newApiBridge';
import { logger } from '../utils/logger';
import { randomBytes, createHash } from 'crypto';
// Redis client
export const redis = createClient({ url: discordGateConfig.REDIS_URL });
redis.on('error', (err) => logger.error('Redis error', { error: err }));
// Initialize New API bridge/sync services
export const newApiSync = initNewApiSync({
    NEW_API_INTERNAL_URL: discordGateConfig.NEW_API_INTERNAL_URL,
    NEW_API_ADMIN_TOKEN: discordGateConfig.NEW_API_ADMIN_TOKEN,
    NEW_API_DEFAULT_GROUP: discordGateConfig.NEW_API_DEFAULT_GROUP,
});
export const newApiBridge = initNewApiBridge({
    NEW_API_INTERNAL_URL: discordGateConfig.NEW_API_INTERNAL_URL,
    NEW_API_ADMIN_TOKEN: discordGateConfig.NEW_API_ADMIN_TOKEN,
});
// Import repositories
import { DiscordMemberRepository } from '../db/repositories/discordMemberRepository';
import { DiscordSessionRepository } from '../db/repositories/discordSessionRepository';
import { DiscordAuditRepository } from '../db/repositories/discordAuditRepository';
import { Pool } from 'pg';
// PostgreSQL pool - use a separate POSTGRES_URL env var or construct from parts
const postgresUrl = process.env.POSTGRES_URL ||
    `postgresql://root:${discordGateConfig.DB_PASSWORD}@postgres:5432/new-api`;
export const pgPool = new Pool({ connectionString: postgresUrl });
// Repositories
export const memberRepo = new DiscordMemberRepository(pgPool);
export const sessionRepo = new DiscordSessionRepository(pgPool);
export const auditRepo = new DiscordAuditRepository(pgPool);
const router = Router();
// Session cookie name
const SESSION_COOKIE = 'discord_gate_session';
const OAUTH_STATE_COOKIE = 'oauth_state';
// ─── OAuth PKCE ───
function generateCodeVerifier() {
    const bytes = randomBytes(32);
    return bytes.toString('base64url');
}
function generateCodeChallenge(verifier) {
    const hash = createHash('sha256').update(verifier).digest();
    return Buffer.from(hash).toString('base64url');
}
// ─── Session Service ───
const SESSION_TTL = 604800; // 7 days
const GUILD_CHECK_TTL = 300; // 5 minutes
export async function createSession(discordId, discordUsername) {
    const token = randomBytes(32).toString('hex');
    const sessionData = { discordId, discordUsername, createdAt: Date.now() };
    // Store in Redis
    await redis.setEx(`session:${token}`, SESSION_TTL, JSON.stringify(sessionData));
    // Store in DB
    const member = await memberRepo.findByDiscordId(discordId);
    if (member) {
        const expiresAt = new Date(Date.now() + SESSION_TTL * 1000);
        await sessionRepo.createSession({
            memberId: member.id,
            sessionToken: token,
            expiresAt,
        });
    }
    return token;
}
export async function validateSession(token) {
    const data = await redis.get(`session:${token}`);
    if (!data)
        return null;
    try {
        return JSON.parse(data);
    }
    catch {
        return null;
    }
}
export async function revokeSession(token) {
    await redis.del(`session:${token}`);
    // DB cleanup can be a background job; Redis TTL handles expiry
}
export async function revokeAllMemberSessions(discordId) {
    const member = await memberRepo.findByDiscordId(discordId);
    if (!member)
        return 0;
    const count = await sessionRepo.revokeAllMemberSessions(member.id);
    return count;
}
// ─── Guild Verification ───
export async function verifyGuildMembership(discordId) {
    try {
        const response = await fetch(`https://discord.com/api/v10/guilds/${discordGateConfig.TARGET_GUILD_ID}/members/${discordId}`, {
            headers: {
                Authorization: `Bot ${discordGateConfig.DISCORD_BOT_TOKEN}`,
            },
        });
        if (response.status === 404) {
            return { isMember: false };
        }
        if (!response.ok) {
            throw new Error(`Discord API error: ${response.status}`);
        }
        return { isMember: true };
    }
    catch (error) {
        logger.error('Guild membership check failed', { discordId, error });
        // On error, assume member to avoid false lockouts
        return { isMember: true };
    }
}
async function exchangeCodeForToken(code, codeVerifier) {
    const params = new URLSearchParams({
        client_id: discordGateConfig.DISCORD_CLIENT_ID,
        client_secret: discordGateConfig.DISCORD_CLIENT_SECRET,
        grant_type: 'authorization_code',
        code,
        redirect_uri: discordGateConfig.DISCORD_REDIRECT_URI,
        code_verifier: codeVerifier,
    });
    const response = await fetch('https://discord.com/api/v10/oauth2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params,
    });
    if (!response.ok) {
        throw new Error(`Token exchange failed: ${response.status}`);
    }
    const data = await response.json();
    return data.access_token;
}
async function fetchDiscordUser(accessToken) {
    const response = await fetch('https://discord.com/api/v10/users/@me', {
        headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) {
        throw new Error(`Fetch user failed: ${response.status}`);
    }
    return response.json();
}
// ─── /auth/verify - Caddy forward_auth endpoint ───
router.get('/verify', async (req, res) => {
    try {
        // Extract session token from cookie or Authorization header
        const token = req.cookies?.[SESSION_COOKIE] || req.headers.authorization?.replace('Bearer ', '');
        if (!token) {
            logger.debug('No session token in verify request');
            return res.status(401).json({ error: 'No session' });
        }
        // Validate session in Redis (fast path)
        const session = await validateSession(token);
        if (!session) {
            logger.debug('Invalid session token');
            return res.status(401).json({ error: 'Invalid session' });
        }
        // Check guild membership (cached in Redis for 5 minutes)
        const cacheKey = `guild_check:${session.discordId}`;
        const cached = await redis.get(cacheKey);
        if (!cached) {
            const { isMember } = await verifyGuildMembership(session.discordId);
            if (!isMember) {
                logger.info('Guild membership lost, revoking session', { discordId: session.discordId });
                await revokeSession(token);
                await newApiBridge.fullRevoke(session.discordId, 'guild_membership_lost');
                await auditRepo.log({
                    eventType: 'MEMBER_LEFT_GUILD',
                    discordId: session.discordId,
                    metadata: { reason: 'guild_membership_lost' },
                });
                return res.status(401).json({ error: 'Guild membership lost' });
            }
            await redis.setEx(cacheKey, GUILD_CHECK_TTL, '1');
        }
        // Return 200 with Discord identity headers
        // Caddy copies these to the proxied request
        // New API can read X-Discord-User-ID to log AI usage
        res.setHeader('X-Discord-User-ID', session.discordId);
        res.setHeader('X-Discord-Username', session.discordUsername);
        res.status(200).json({ ok: true });
    }
    catch (error) {
        logger.error('Verify endpoint error', { error });
        return res.status(500).json({ error: 'Internal error' });
    }
});
// ─── /auth/discord - Start OAuth flow ───
router.get('/discord', async (req, res) => {
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = generateCodeChallenge(codeVerifier);
    // Store PKCE verifier in Redis with state
    const state = randomBytes(16).toString('hex');
    await redis.setEx(`oauth_pkce:${state}`, 300, codeVerifier);
    // Set state cookie
    res.cookie(OAUTH_STATE_COOKIE, state, {
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
        maxAge: 300000, // 5 minutes
    });
    const params = new URLSearchParams({
        client_id: discordGateConfig.DISCORD_CLIENT_ID,
        redirect_uri: discordGateConfig.DISCORD_REDIRECT_URI,
        response_type: 'code',
        scope: 'identify guilds.members.read',
        state,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
    });
    res.redirect(`https://discord.com/api/oauth2/authorize?${params.toString()}`);
});
// ─── /auth/discord/callback - OAuth callback ───
router.get('/discord/callback', async (req, res) => {
    try {
        const { code, state, error: oauthError } = req.query;
        if (oauthError) {
            logger.warn('OAuth error from Discord', { error: oauthError });
            return res.redirect(`${discordGateConfig.SITE_URL}/auth/denied?reason=server_error`);
        }
        if (!code || !state) {
            return res.redirect(`${discordGateConfig.SITE_URL}/auth/denied?reason=invalid_state`);
        }
        // Validate state cookie (CSRF protection)
        const cookieState = req.cookies?.[OAUTH_STATE_COOKIE];
        if (!cookieState || cookieState !== state) {
            return res.redirect(`${discordGateConfig.SITE_URL}/auth/denied?reason=invalid_state`);
        }
        // Consume PKCE verifier from Redis (atomic: get + del)
        const codeVerifier = await redis.get(`oauth_pkce:${state}`);
        if (!codeVerifier) {
            return res.redirect(`${discordGateConfig.SITE_URL}/auth/denied?reason=invalid_state`);
        }
        await redis.del(`oauth_pkce:${state}`);
        // Clear state cookie
        res.clearCookie(OAUTH_STATE_COOKIE);
        // Exchange code for Discord access token
        const accessToken = await exchangeCodeForToken(code, codeVerifier);
        // Get Discord user profile
        const discordUser = await fetchDiscordUser(accessToken);
        // Verify guild membership
        const { isMember } = await verifyGuildMembership(discordUser.id);
        if (!isMember) {
            return res.redirect(`${discordGateConfig.SITE_URL}/auth/denied?reason=not_member`);
        }
        // Provision New API user
        const newApiUser = await newApiSync.provisionUser({
            id: discordUser.id,
            username: discordUser.username,
            discriminator: discordUser.discriminator,
            avatar: discordUser.avatar,
            global_name: discordUser.global_name,
        });
        // Upsert discord_gate_members record
        await memberRepo.upsertMember({
            discordId: discordUser.id,
            discordUsername: discordUser.global_name || discordUser.username,
            newApiUserId: String(newApiUser.id),
        });
        // Create session
        const token = await createSession(discordUser.id, discordUser.global_name || discordUser.username);
        // Set guild membership cache
        await redis.setEx(`guild_check:${discordUser.id}`, GUILD_CHECK_TTL, '1');
        // Set session cookie
        res.cookie(SESSION_COOKIE, token, {
            httpOnly: true,
            secure: true,
            sameSite: 'strict',
            maxAge: SESSION_TTL * 1000,
        });
        // Audit log
        await auditRepo.log({
            eventType: 'LOGIN_SUCCESS',
            discordId: discordUser.id,
            newApiUserId: String(newApiUser.id),
            metadata: { username: discordUser.username },
        });
        // Redirect back to PROXY-HUB
        res.redirect(discordGateConfig.SITE_URL);
    }
    catch (error) {
        logger.error('OAuth callback error', { error });
        res.redirect(`${discordGateConfig.SITE_URL}/auth/denied?reason=server_error`);
    }
});
// ─── /auth/denied - Login denied page ───
router.get('/denied', (req, res) => {
    const { reason } = req.query;
    const messages = {
        not_member: {
            error: 'Not a guild member',
            inviteLink: discordGateConfig.DISCORD_INVITE_LINK,
        },
        invalid_state: {
            error: 'Invalid login session',
        },
        server_error: {
            error: 'Server error during login',
        },
    };
    const message = messages[reason] || messages.server_error;
    res.status(403).json(message);
});
// ─── /auth/logout ───
router.get('/logout', async (req, res) => {
    const token = req.cookies?.[SESSION_COOKIE];
    if (token) {
        await revokeSession(token);
    }
    res.clearCookie(SESSION_COOKIE, {
        httpOnly: true,
        secure: true,
        sameSite: 'strict',
    });
    res.redirect(discordGateConfig.SITE_URL);
});
export default router;
//# sourceMappingURL=auth.js.map