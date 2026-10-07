import { ZodSchema, ZodIssue } from "zod"

export function validateEnv<T>(
  schema: ZodSchema<T>,
  env: NodeJS.ProcessEnv = process.env
): T {
  const result = schema.safeParse(env)
  if (!result.success) {
    console.error("❌ DiscordGate env validation failed:")
    result.error.issues.forEach((issue: ZodIssue) => {
      console.error(`   - ${issue.path.join(".")}: ${issue.message}`)
    })
    process.exit(1)
  }
  console.info(
    `✅ DiscordGate env validated (${Object.keys(result.data as object).length} vars)`
  )
  return result.data
}