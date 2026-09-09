import { SECTION_KEYS } from '@ipk/core'
import { model, Schema, type InferSchemaType } from 'mongoose'

const SectionStateSchema = new Schema(
  {
    status: { type: String, enum: ['idle', 'regenerating', 'failed'], default: 'idle' },
    rev: { type: Number, default: 0 },
    updated_at: { type: Date, default: null },
    error: { type: String, default: null },
  },
  { _id: false },
)

/**
 * A subschema rather than an inline nested path: an inline path is inferred as
 * optional even when every field inside it is required, which makes every read
 * of `doc.input` need a non-null assertion.
 */
const InputSchema = new Schema(
  {
    jd: { type: String, required: true },
    companyUrl: { type: String, required: true },
    days: { type: Number, required: true },
  },
  { _id: false },
)

function defaultSections(): Record<string, unknown> {
  return Object.fromEntries(SECTION_KEYS.map((key) => [key, { status: 'idle', rev: 0, error: null }]))
}

const KitDocSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, required: true, index: true },
    // sha256(userId + jd + companyUrl): a second submission of the same posting
    // returns the existing job instead of starting another.
    dedupeKey: { type: String, required: true },
    status: { type: String, enum: ['queued', 'running', 'partial', 'ready', 'failed'], default: 'queued', index: true },
    input: { type: InputSchema, required: true },
    progress: {
      steps: { type: [{ name: String, status: String, ms: Number, detail: String }], default: [] },
      current: { type: String, default: null },
    },
    // Stored loosely: Appendix A conformance is enforced by zod in @ipk/core
    // before anything is written, so duplicating the shape here would only
    // create two places to keep in step.
    kit: { type: Schema.Types.Mixed, default: null },
    sections: { type: Map, of: SectionStateSchema, default: defaultSections },
    practice: {
      type: [{ cardId: String, confidence: Number, seenAt: Date }],
      default: [],
    },
    error: { type: Schema.Types.Mixed, default: null },
  },
  { timestamps: true },
)

KitDocSchema.index({ userId: 1, dedupeKey: 1 }, { unique: true })

export type KitDoc = InferSchemaType<typeof KitDocSchema>
export const KitModel = model('Kit', KitDocSchema)
