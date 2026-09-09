import { createHash } from 'node:crypto'
import { createGeminiClient, runPipeline, type LlmClient, type Progress } from '@ipk/core'
import { env } from '../env.js'
import { KitModel } from '../models/kit.js'

/** Injected by tests so the real job path runs without a real provider. */
let testLlm: LlmClient | null = null
export function setTestLlm(llm: LlmClient | null): void {
  testLlm = llm
}

const inFlight = new Set<string>()
const idleWaiters: (() => void)[] = []

/** Test helper: resolves once no generation is running. */
export function waitForIdle(): Promise<void> {
  if (inFlight.size === 0) return Promise.resolve()
  return new Promise((resolve) => idleWaiters.push(resolve))
}

function settleIfIdle(): void {
  if (inFlight.size > 0) return
  while (idleWaiters.length > 0) idleWaiters.shift()?.()
}

export function dedupeKeyFor(userId: string, jd: string, companyUrl: string): string {
  return createHash('sha256').update(`${userId}\n${jd.trim()}\n${companyUrl.trim()}`).digest('hex')
}

const PROGRESS_WRITE_INTERVAL_MS = 1000

/**
 * Runs one generation in the background. The caller has already responded, so
 * nothing here may throw into a request: every failure ends as a status on the
 * document. A kit that got far enough to exist is kept as "partial" rather
 * than discarded, so a halfway failure is still readable and reopenable.
 */
export function enqueueGeneration(kitId: string, llm?: LlmClient): void {
  inFlight.add(kitId)

  void (async () => {
    try {
      const doc = await KitModel.findById(kitId)
      if (!doc) return

      doc.status = 'running'
      await doc.save()

      let lastWrite = 0
      const onProgress = async (progress: Progress) => {
        const now = Date.now()
        const finished = progress.current === null
        // Throttled, but always write the final state of a step.
        if (!finished && now - lastWrite < PROGRESS_WRITE_INTERVAL_MS) return
        lastWrite = now
        await KitModel.updateOne({ _id: kitId }, { $set: { progress } })
      }

      const result = await runPipeline({
        jd: doc.input.jd,
        companyUrl: doc.input.companyUrl,
        days: doc.input.days,
        llm: llm ?? testLlm ?? createGeminiClient({ apiKey: env.GEMINI_API_KEY || undefined }),
        allowPrivate: process.env.NODE_ENV !== 'production',
        onProgress,
      })

      if (result.ok) {
        const hasWarnings = result.kit.warnings.length > 0
        await KitModel.updateOne(
          { _id: kitId },
          {
            $set: {
              // Warnings mean sources were skipped: honest, but not a clean run.
              status: hasWarnings ? 'partial' : 'ready',
              kit: result.kit,
              progress: result.progress,
              error: null,
            },
          },
        )
      } else {
        await KitModel.updateOne(
          { _id: kitId },
          { $set: { status: 'failed', progress: result.progress, error: { code: result.code, message: result.message } } },
        )
      }
    } catch (error) {
      await KitModel.updateOne(
        { _id: kitId },
        {
          $set: {
            status: 'failed',
            error: { code: 'UNEXPECTED_ERROR', message: error instanceof Error ? error.message : String(error) },
          },
        },
      ).catch(() => {})
    } finally {
      inFlight.delete(kitId)
      settleIfIdle()
    }
  })()
}

export function getTestLlm(): LlmClient | null {
  return testLlm
}
