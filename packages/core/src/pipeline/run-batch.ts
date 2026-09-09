import type { LlmClient } from '../llm/client.js'
import { BATCH_VERSION, type BatchCase, type BatchEntry, type BatchOutput } from '../schema/batch.js'
import { runPipeline } from './run-pipeline.js'

export const DEFAULT_CONCURRENCY = 2

export type RunBatchInput = {
  cases: BatchCase[]
  concurrency?: number
  llm?: LlmClient
  allowPrivate?: boolean
  now?: () => Date
  onCaseDone?: (entry: BatchEntry, index: number) => void
}

/**
 * The same pipeline the application uses, run over a file of cases. Each case
 * is isolated: a thrown error becomes a failed entry and the run continues,
 * because the brief requires the batch to complete rather than abort. Only a
 * case that produced no kit at all is "failed" — partial research is "ok" with
 * the gaps recorded honestly inside the kit.
 */
export async function runBatch(input: RunBatchInput): Promise<BatchOutput> {
  const concurrency = Math.max(1, input.concurrency ?? DEFAULT_CONCURRENCY)
  const now = input.now ?? (() => new Date())
  const entries: BatchEntry[] = new Array(input.cases.length)

  let cursor = 0
  const workers = Array.from({ length: Math.min(concurrency, input.cases.length) }, async () => {
    for (;;) {
      const index = cursor
      cursor += 1
      const batchCase = input.cases[index]
      if (!batchCase) return

      let entry: BatchEntry
      try {
        const result = await runPipeline({
          jd: batchCase.jd,
          companyUrl: batchCase.company_url,
          days: batchCase.days,
          llm: input.llm,
          // The brief says evaluation sites may be served from a local address.
          allowPrivate: input.allowPrivate ?? true,
          now,
        })
        entry = result.ok
          ? { id: batchCase.id, status: 'ok', kit: result.kit, error: null }
          : { id: batchCase.id, status: 'failed', kit: null, error: { code: result.code, message: result.message } }
      } catch (error) {
        entry = {
          id: batchCase.id,
          status: 'failed',
          kit: null,
          error: { code: 'UNEXPECTED_ERROR', message: error instanceof Error ? error.message : String(error) },
        }
      }

      entries[index] = entry
      input.onCaseDone?.(entry, index)
    }
  })

  await Promise.all(workers)

  return {
    version: BATCH_VERSION,
    generated_at: now().toISOString(),
    kits: entries.filter((entry): entry is BatchEntry => entry !== undefined),
  }
}
