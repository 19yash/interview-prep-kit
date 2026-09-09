import { z } from 'zod'
import { ItemStateSchema } from './state.js'

export const REQUIREMENT_KINDS = ['technical', 'behavioural', 'domain'] as const
export const QUESTION_CATEGORIES = ['technical', 'behavioural', 'system-design', 'company-fit'] as const

export const SourceSchema = z.object({
  company: z.string(),
  company_url: z.string(),
  role: z.string(),
  location: z.string(),
  jd_chars: z.number().int().nonnegative(),
  researched_at: z.string(),
  pages_used: z.array(z.string()),
})

export const CompanyBriefSchema = z.object({
  summary: z.string(),
  what_they_do: z.string(),
  sources: z.array(z.string()),
})

export const RequirementSchema = z.object({
  id: z.string().regex(/^r\d+$/, 'requirement id must look like r1'),
  text: z.string().min(1),
  kind: z.enum(REQUIREMENT_KINDS),
  priority: z.enum(['must', 'nice']),
})

export const RoleSchema = z.object({
  title: z.string(),
  seniority: z.string(),
  responsibilities: z.array(z.string()),
  requirements: z.array(RequirementSchema),
})

export const QuestionSchema = z
  .object({
    id: z.string().regex(/^q\d+$/, 'question id must look like q1'),
    requirement_ids: z.array(z.string()),
    category: z.enum(QUESTION_CATEGORIES),
    prompt: z.string().min(1),
    answer_outline: z.string(),
    difficulty: z.number().int().min(1).max(3),
  })
  .merge(ItemStateSchema)

export const FlashcardSchema = z
  .object({
    id: z.string().regex(/^f\d+$/, 'flashcard id must look like f1'),
    front: z.string().min(1),
    back: z.string(),
    requirement_ids: z.array(z.string()),
  })
  .merge(ItemStateSchema)

export const ScheduleDaySchema = z.object({
  day: z.number().int().positive(),
  focus: z.string(),
  question_ids: z.array(z.string()),
  minutes: z.number().int().nonnegative(),
})

export const ScheduleSchema = z.object({
  days_available: z.number().int().positive(),
  days: z.array(ScheduleDaySchema),
})

export const CoverageSchema = z.object({
  uncovered_requirement_ids: z.array(z.string()),
  passes: z.number().int().nonnegative(),
})

const KitShape = z.object({
  source: SourceSchema,
  company_brief: CompanyBriefSchema,
  role: RoleSchema,
  questions: z.array(QuestionSchema),
  flashcards: z.array(FlashcardSchema),
  schedule: ScheduleSchema,
  coverage: CoverageSchema,
  /** Extension: sources we could not retrieve, reported rather than hidden. */
  warnings: z
    .array(z.object({ step: z.string(), source: z.string().nullable(), reason: z.string() }))
    .default([]),
})

/**
 * Referential integrity is checked here rather than in the field schemas
 * because it spans sections. Every failure names the offending id so the
 * message is actionable.
 */
export const KitSchema = KitShape.superRefine((kit, ctx) => {
  const requirementIds = new Set(kit.role.requirements.map((r) => r.id))
  const questionIds = new Set(kit.questions.map((q) => q.id))

  for (const q of kit.questions) {
    for (const rid of q.requirement_ids) {
      if (!requirementIds.has(rid)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['questions'],
          message: `question ${q.id} references unknown requirement ${rid}`,
        })
      }
    }
  }

  for (const f of kit.flashcards) {
    for (const rid of f.requirement_ids) {
      if (!requirementIds.has(rid)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['flashcards'],
          message: `flashcard ${f.id} references unknown requirement ${rid}`,
        })
      }
    }
  }

  for (const day of kit.schedule.days) {
    for (const qid of day.question_ids) {
      if (!questionIds.has(qid)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['schedule', 'days'],
          message: `schedule day ${day.day} references unknown question ${qid}`,
        })
      }
    }
  }

  if (kit.schedule.days.length !== kit.schedule.days_available) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['schedule', 'days'],
      message: `schedule has ${kit.schedule.days.length} days but days_available is ${kit.schedule.days_available}`,
    })
  }

  for (const rid of kit.coverage.uncovered_requirement_ids) {
    if (!requirementIds.has(rid)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['coverage'],
        message: `coverage names unknown requirement ${rid}`,
      })
    }
  }
})

export type Kit = z.infer<typeof KitSchema>
export type Requirement = z.infer<typeof RequirementSchema>
export type Question = z.infer<typeof QuestionSchema>
export type Flashcard = z.infer<typeof FlashcardSchema>
export type ScheduleDay = z.infer<typeof ScheduleDaySchema>
export type Schedule = z.infer<typeof ScheduleSchema>
export type Coverage = z.infer<typeof CoverageSchema>
export type CompanyBrief = z.infer<typeof CompanyBriefSchema>
export type Role = z.infer<typeof RoleSchema>
export type Source = z.infer<typeof SourceSchema>

export type ValidateResult =
  | { ok: true; kit: Kit }
  | { ok: false; errors: string[] }

/** The gate every kit passes before it is persisted or written to a batch file. */
export function validateKit(input: unknown): ValidateResult {
  const parsed = KitSchema.safeParse(input)
  if (parsed.success) return { ok: true, kit: parsed.data }
  return {
    ok: false,
    errors: parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
  }
}
