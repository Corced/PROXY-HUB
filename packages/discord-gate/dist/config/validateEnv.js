export function validateEnv(schema, env = process.env) {
    const result = schema.safeParse(env);
    if (!result.success) {
        console.error("❌ DiscordGate env validation failed:");
        result.error.issues.forEach((issue) => {
            console.error(`   - ${issue.path.join(".")}: ${issue.message}`);
        });
        process.exit(1);
    }
    console.info(`✅ DiscordGate env validated (${Object.keys(result.data).length} vars)`);
    return result.data;
}
//# sourceMappingURL=validateEnv.js.map