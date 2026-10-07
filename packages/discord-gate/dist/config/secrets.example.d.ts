export declare const PROXYHUB_GENERATION_COMMANDS: {
    readonly BOT_INTERNAL_SECRET: "openssl rand -hex 32";
    readonly DISCORD_GATE_SESSION_SECRET: "openssl rand -hex 64";
    readonly POSTGRES_PASSWORD: "openssl rand -base64 24";
    readonly REDIS_PASSWORD: "openssl rand -base64 24";
    readonly ALL_AT_ONCE: "sh scripts/generate-secrets.sh >> .env";
    readonly NEW_API_ADMIN_TOKEN: "Create in New API admin panel → API Keys → New Admin Key";
};
//# sourceMappingURL=secrets.example.d.ts.map