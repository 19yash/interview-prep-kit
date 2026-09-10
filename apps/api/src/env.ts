import dotenv from 'dotenv'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'

const rootEnvPath = fileURLToPath(new URL('../../../.env', import.meta.url))
const localEnvPath = resolve(process.cwd(), '.env')

if (existsSync(rootEnvPath)) {
  dotenv.config({ path: rootEnvPath })
}
if (existsSync(localEnvPath) && localEnvPath !== rootEnvPath) {
  dotenv.config({ path: localEnvPath, override: true })
}


import { GeminiKeyPool } from '@ipk/core'

const EnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(4000),
  MONGODB_URI: z.string().default('mongodb://127.0.0.1:27017/ipk'),
  JWT_SECRET: z.string().min(8, 'JWT_SECRET must be set to at least 8 characters'),
  WEB_ORIGIN: z.string().default('http://localhost:3000'),
  NODE_ENV: z.string().default('development'),
  GEMINI_API_KEY: z.string().default(''),
  GEMINI_API_KEYS: z.string().default(''),
})

/** Fails fast at boot rather than at the first request. */
export const env = EnvSchema.parse({
  PORT: process.env.PORT,
  MONGODB_URI: process.env.MONGODB_URI,
  JWT_SECRET: process.env.JWT_SECRET ?? 'dev-secret-change-me',
  WEB_ORIGIN: process.env.WEB_ORIGIN,
  NODE_ENV: process.env.NODE_ENV,
  GEMINI_API_KEY: process.env.GEMINI_API_KEY,
  GEMINI_API_KEYS: process.env.GEMINI_API_KEYS,
})

export function parseGeminiApiKeys(envKeys?: string, envKey?: string): string[] {
  const combined = [envKeys ?? '', envKey ?? ''].join(',')
  return combined
    .split(',')
    .map((k) => k.trim())
    .filter((k) => k.length > 0)
}

export const sharedGeminiKeyPool = new GeminiKeyPool(
  parseGeminiApiKeys(env.GEMINI_API_KEYS, env.GEMINI_API_KEY)
)

export const isProduction = env.NODE_ENV === 'production'

/**
 * A single origin cannot cover production and a preview deployment, so this
 * accepts a comma-separated list. Trailing slashes are stripped because the
 * Origin header never carries one and a mismatch is invisible in logs.
 */
export function parseOrigins(value: string): string[] {
  return value
    .split(',')
    .map((origin) => origin.trim().replace(/\/+$/, ''))
    .filter((origin) => origin.length > 0)
}

export const allowedOrigins = parseOrigins(env.WEB_ORIGIN)
