// globalSetup.ts - runs BEFORE any test files are loaded
// This sets up environment variables before the config is loaded

export default async function globalSetup() {
  console.log('[globalSetup] Setting up test environment variables...');
  // Set required environment variables BEFORE any config is loaded
  process.env.DISCORD_BOT_TOKEN = 'test_bot_token_with_sufficient_length_for_validation';
  process.env.DISCORD_CLIENT_ID = '123456789012345678';
  process.env.DISCORD_CLIENT_SECRET = 'test_client_secret_with_sufficient_length_for_validation';
  process.env.DISCORD_REDIRECT_URI = 'http://localhost:3001/auth/discord/callback';
  process.env.TARGET_GUILD_ID = '123456789012345678';
  process.env.DISCORD_INVITE_LINK = 'https://discord.gg/test';
  process.env.DISCORD_API_BASE = 'https://discord.com/api/v10';
  process.env.DISCORD_GATE_PORT = '3001';
  process.env.BOT_PORT = '3002';
  process.env.BOT_INTERNAL_SECRET = 'a'.repeat(32);
  process.env.DISCORD_GATE_SESSION_SECRET = 'b'.repeat(64);
  process.env.NEW_API_ADMIN_TOKEN = 'test_admin_token';
  process.env.REDIS_URL = 'redis://:test_redis_password@localhost:6379';
  process.env.SITE_URL = 'https://test.example.com';
  process.env.NODE_ENV = 'development';
  process.env.SITE_DOMAIN = 'test.example.com';
  process.env.SESSION_SECRET = 'c'.repeat(64);
  process.env.NEW_API_JWT_SECRET = 'd'.repeat(64);
  process.env.DB_PASSWORD = 'test_db_password';
  process.env.POSTGRES_HOST = 'localhost';
  process.env.POSTGRES_PORT = '5432';
  process.env.POSTGRES_USER = 'root';
  process.env.POSTGRES_DB = 'new-api';
  process.env.TZ = 'Asia/Jakarta';
  process.env.REDIS_PASSWORD = 'test_redis_password';
  process.env.ROUTER_PASSWORD = 'test_router_password';
  process.env.DOMAIN = 'test.example.com';
  process.env.CRYPTO_SECRET = 'e'.repeat(64);
  process.env.CADDY_TLS_EMAIL = 'admin@test.example.com';
  process.env.CADDY_ADMIN_ALLOWLIST = '127.0.0.1';
  process.env.INITIAL_ADMIN_EMAIL = 'admin@test.example.com';
  process.env.INITIAL_ADMIN_PASSWORD = 'e'.repeat(32);
  process.env.NEW_API_INTERNAL_URL = 'http://localhost:3000';
  process.env.NEW_API_DEFAULT_GROUP = 'default';
  process.env.RATE_LIMIT_RPM = '15';
  process.env.RATE_LIMIT_WINDOW_SECONDS = '60';
  process.env.SYNC_INTERVAL_MINUTES = '30';
  
  console.log('[globalSetup] Environment variables set. NODE_ENV:', process.env.NODE_ENV);
}