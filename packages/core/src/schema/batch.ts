import { z } from 'zod'
import { KitSchema, type Kit } from './kit.js'

export const BATCH_VERSION = '1.0'

export const CaseSchema = z.object({
  id: z.string().min(1),
  jd: z.string().default(''),
  company_url: z.string().default(''),
  // A missing day count should not reject an otherwise usable file.
  days: z.number().int().positive().default(1),
})

export const CasesSchema = z.array(CaseSchema)

export type BatchCase = z.infer<typeof CaseSchema>

export const BatchEntrySchema = z.object({
  id: z.string(),
  status: z.enum(['ok', 'failed']),
  kit: KitSchema.nullable(),
  error: z.object({ code: z.string(), message: z.string() }).nullable(),
})

export const BatchOutputSchema = z.object({
  version: z.string(),
  generated_at: z.string(),
  kits: z.array(BatchEntrySchema),
})

export type BatchEntry = { id: string; status: 'ok' | 'failed'; kit: Kit | null; error: { code: string; message: string } | null }
export type BatchOutput = z.infer<typeof BatchOutputSchema>
