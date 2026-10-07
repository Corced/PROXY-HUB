// Documentation only — not imported by any service
export const PROXYHUB_GENERATION_COMMANDS = {
  BOT_INTERNAL_SECRET:
    'openssl rand -hex 32',
  DISCORD_GATE_SESSION_SECRET:
    'openssl rand -hex 64',
  POSTGRES_PASSWORD:
    'openssl rand -base64 24',
  REDIS_PASSWORD:
    'openssl rand -base64 24',
  ALL_AT_ONCE:
    'sh scripts/generate-secrets.sh >> .env',
  NEW_API_ADMIN_TOKEN:
    'Create in New API admin panel → API Keys → New Admin Key',
} as const