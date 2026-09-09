import 'dotenv/config'
import { z } from 'zod'

const EnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(4000),
  MONGODB_URI: z.string().default('mongodb://127.0.0.1:27017/ipk'),
  JWT_SECRET: z.string().min(8, 'JWT_SECRET must be set to at least 8 characters'),
  WEB_ORIGIN: z.string().default('http://localhost:3000'),
  NODE_ENV: z.string().default('development'),
  GEMINI_API_KEY: z.string().default(''),
})

/** Fails fast at boot rather than at the first request. */
export const env = EnvSchema.parse({
  PORT: process.env.PORT,
  MONGODB_URI: process.env.MONGODB_URI,
  JWT_SECRET: process.env.JWT_SECRET ?? 'dev-secret-change-me',
  WEB_ORIGIN: process.env.WEB_ORIGIN,
  NODE_ENV: process.env.NODE_ENV,
  GEMINI_API_KEY: process.env.GEMINI_API_KEY,
})

export const isProduction = env.NODE_ENV === 'production'
