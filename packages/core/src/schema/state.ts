import { z } from 'zod'

export const ORIGINS = ['generated', 'edited', 'manual'] as const
export const OriginSchema = z.enum(ORIGINS)
export type Origin = z.infer<typeof OriginSchema>

/**
 * Editing state carried by every user-editable item. These are extensions to
 * Appendix A, permitted by the brief. Defaults make them optional on input so
 * that a model response — which never sets them — still validates.
 */
export const ItemStateSchema = z.object({
  origin: OriginSchema.default('generated'),
  pinned: z.boolean().default(false),
  rev: z.number().int().nonnegative().default(0),
})

export const SECTION_KEYS = [
  'company_brief',
  'role',
  'questions_technical',
  'questions_behavioural',
  'questions_system-design',
  'questions_company-fit',
  'flashcards',
  'schedule',
] as const
export const SectionKeySchema = z.enum(SECTION_KEYS)
export type SectionKey = z.infer<typeof SectionKeySchema>

export const SECTION_STATUSES = ['idle', 'regenerating', 'failed'] as const

export const SectionStateSchema = z.object({
  status: z.enum(SECTION_STATUSES).default('idle'),
  rev: z.number().int().nonnegative().default(0),
  updated_at: z.string().datetime().optional(),
  error: z.string().nullable().default(null),
})
export type SectionState = z.infer<typeof SectionStateSchema>
