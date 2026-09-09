import type { PipelineWarning, Progress, ProgressReporter, StepRecord } from './types.js'

export interface Runner {
  run<T>(name: string, fn: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: unknown }>
  skip(name: string, detail: string): void
  progress(): Progress
  warnings(): PipelineWarning[]
}

/**
 * The whole "orchestration framework". It exists to do three things a framework
 * would also do — time each step, isolate its failure, and report progress —
 * without introducing a graph abstraction over what is a mostly linear
 * sequence with one loop.
 */
export function createRunner(names: string[], report?: ProgressReporter): Runner {
  const steps: StepRecord[] = names.map((name) => ({ name, status: 'pending', ms: 0 }))
  const collected: PipelineWarning[] = []
  let current: string | null = null

  const find = (name: string): StepRecord => {
    const existing = steps.find((step) => step.name === name)
    if (existing) return existing
    const created: StepRecord = { name, status: 'pending', ms: 0 }
    steps.push(created)
    return created
  }

  const snapshot = (): Progress => ({ steps: steps.map((step) => ({ ...step })), current })

  // A broken reporter must never fail a generation run.
  const emit = async () => {
    if (!report) return
    try {
      await report(snapshot())
    } catch {
      /* ignored deliberately */
    }
  }

  return {
    async run<T>(name: string, fn: () => Promise<T>) {
      const step = find(name)
      step.status = 'running'
      current = name
      await emit()

      const started = Date.now()
      try {
        const value = await fn()
        step.ms = Date.now() - started
        step.status = 'done'
        current = null
        await emit()
        return { ok: true as const, value }
      } catch (error) {
        step.ms = Date.now() - started
        step.status = 'failed'
        step.detail = error instanceof Error ? error.message : String(error)
        collected.push({ step: name, source: null, reason: step.detail })
        current = null
        await emit()
        return { ok: false as const, error }
      }
    },

    skip(name: string, detail: string) {
      const step = find(name)
      step.status = 'skipped'
      step.detail = detail
      void emit()
    },

    progress: snapshot,
    warnings: () => collected.map((warning) => ({ ...warning })),
  }
}
