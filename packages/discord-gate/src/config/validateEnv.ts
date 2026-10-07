import { ZodSchema, ZodIssue } from "zod"

export function validateEnv<T>(
  schema: ZodSchema<T>,
  env: NodeJS.ProcessEnv = process.env
): T {
  console.log('[validateEnv] NODE_ENV from env:', env.NODE_ENV);
  const result = schema.safeParse(env)
  if (!result.success) {
    console.error("❌ DiscordGate env validation failed:")
    result.error.issues.forEach((issue: ZodIssue) => {
      console.error(`   - ${issue.path.join(".")}: ${issue.message}`)
    })
    // Don't exit during tests - throw instead so vitest can catch it
    if (process.env.VITEST || process.env.NODE_ENV === 'test') {
      throw new Error('Environment validation failed')
    }
    process.exit(1)
  }
  console.info(
    `✅ DiscordGate env validated (${Object.keys(result.data as object).length} vars)`
  )
  return result.data
}