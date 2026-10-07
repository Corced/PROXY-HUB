import { z } from "zod"
import { validateEnv } from "./validateEnv"

const DiscordGateEnvSchema = z.object({

  // ── Discord Bot credentials ───────────────────────────────
  DISCORD_BOT_TOKEN: z.string()
    .min(50, "Bot token too short — check Discord Developer Portal"),
  DISCORD_CLIENT_ID: z.string()
    .regex(/^\d{17,19}$/, "Must be a Discord snowflake ID"),
  DISCORD_CLIENT_SECRET: z.string()
    .min(30, "Client secret too short"),
  DISCORD_REDIRECT_URI: z.string()
    .url()
    .includes("/auth/discord/callback"),
  TARGET_GUILD_ID: z.string()
    .regex(/^\d{17,19}$/, "Must be a Discord snowflake ID"),
  DISCORD_INVITE_LINK: z.string()
    .url()
    .includes("discord.gg"),

  // ── DiscordGate service ───────────────────────────────────
  DISCORD_GATE_PORT: z.string()
    .default("3001")
    .transform(Number)
    .pipe(z.number().min(1024).max(65535)),
  BOT_PORT: z.string()
    .default("3002")
    .transform(Number)
    .pipe(z.number().min(1024).max(65535)),
  BOT_INTERNAL_SECRET: z.string()
    .min(32, "Generate: openssl rand -hex 32"),
  DISCORD_GATE_SESSION_SECRET: z.string()
    .min(32, "Generate: openssl rand -hex 64"),
  DISCORD_GATE_INTERNAL_URL: z.string()
    .url()
    .default("http://discord-gate:3001"),

  // ── PROXY-HUB / New API bridge ───────────────────────────
  NEW_API_INTERNAL_URL: z.string()
    .url()
    .default("http://new-api:3000"),
  NEW_API_ADMIN_TOKEN: z.string()
    .min(16, "Generate an admin API key from the New API admin panel"),
  NEW_API_DEFAULT_GROUP: z.string()
    .default("default"),

  // ── Infrastructure ────────────────────────────────────────
  REDIS_URL: z.string()
    .url()
    .startsWith("redis://"),
  SITE_URL: z.string()
    .url(),
  NODE_ENV: z.enum(["development", "staging", "production"])
    .default("development"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"])
    .default("info"),

  // ── Bot mod permissions ───────────────────────────────────
  DISCORD_OWNER_ID: z.string()
    .regex(/^\d{17,19}$/)
    .optional(),
  MOD_ROLE_ID: z.string()
    .regex(/^\d{17,19}$/)
    .optional(),

  // ── Caddy / PROXY-HUB vars from Steps 01-04 ───────────────
  SITE_DOMAIN: z.string()
    .min(1, "Required for Caddy"),
  CADDY_TLS_EMAIL: z.string()
    .email()
    .optional(),
  CADDY_ADMIN_ALLOWLIST: z.string()
    .default("127.0.0.1"),

  // ── PROXY-HUB core vars from Step 01 ──────────────────────
  INITIAL_ADMIN_EMAIL: z.string()
    .email()
    .optional(),
  INITIAL_ADMIN_PASSWORD: z.string()
    .min(32, "Generate: openssl rand -base64 32")
    .optional(),
  SESSION_SECRET: z.string()
    .min(32, "Generate: openssl rand -hex 64"),
  NEW_API_JWT_SECRET: z.string()
    .min(32, "Generate: openssl rand -hex 64"),
  DB_PASSWORD: z.string()
    .min(16, "Generate: openssl rand -base64 24"),
  REDIS_PASSWORD: z.string()
    .min(16, "Generate: openssl rand -base64 24"),
  ROUTER_PASSWORD: z.string()
    .min(16, "Generate: openssl rand -base64 24"),
  DOMAIN: z.string()
    .min(1, "Required for Caddy"),
  CRYPTO_SECRET: z.string()
    .optional(),
})

const config = validateEnv(DiscordGateEnvSchema)

// Production runtime checks
if (config.NODE_ENV === "production" && config.SITE_URL.startsWith("http://")) {
  console.error("❌ FATAL: SITE_URL must use HTTPS in production")
  process.exit(1)
}
if (config.NODE_ENV === "production" && config.DISCORD_GATE_SESSION_SECRET.length < 64) {
  console.warn("⚠️  WARNING: DISCORD_GATE_SESSION_SECRET should be 64+ chars in production")
}
if (config.NODE_ENV === "production" && config.NEW_API_ADMIN_TOKEN.length < 32) {
  console.error("❌ FATAL: NEW_API_ADMIN_TOKEN too short for production")
  process.exit(1)
}
if (config.NODE_ENV === "production" && config.SESSION_SECRET.length < 64) {
  console.error("❌ FATAL: SESSION_SECRET should be 64+ chars (openssl rand -hex 64) in production")
  process.exit(1)
}
if (config.NODE_ENV === "production" && config.NEW_API_JWT_SECRET.length < 64) {
  console.error("❌ FATAL: NEW_API_JWT_SECRET should be 64+ chars (openssl rand -hex 64) in production")
  process.exit(1)
}

export const discordGateConfig = config
export type DiscordGateConfig = typeof discordGateConfig