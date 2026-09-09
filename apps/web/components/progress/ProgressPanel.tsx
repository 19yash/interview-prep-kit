import { formatDuration } from '@/lib/format'
import type { KitStatus, Progress, StepRecord } from '@/lib/types'

/**
 * The step names are the pipeline's own, so the interface shows the real
 * sequence rather than a decorative progress bar. Each label says what the
 * step is responsible for.
 */
export const STEP_LABELS: Record<string, string> = {
  extractRequirements: 'Reading the job description',
  discoverPages: 'Crawling the company site',
  findHiringProcess: 'Looking for how they hire',
  searchPublicDiscussion: 'Searching public accounts of their process',
  buildCompanyBrief: 'Writing the company brief',
  generateQuestions: 'Writing questions, one category at a time',
  generateFlashcards: 'Writing flashcards',
  checkCoverage: 'Checking every requirement has a question',
  fillGaps: 'Filling the gaps found by the check',
  allocateSchedule: 'Allocating the study schedule',
  validateKit: 'Validating the finished kit',
}

const MARKS: Record<StepRecord['status'], { symbol: string; className: string; label: string }> = {
  pending: { symbol: '·', className: 'text-slate-300', label: 'waiting' },
  running: { symbol: '', className: 'text-indigo-600', label: 'in progress' },
  done: { symbol: '✓', className: 'text-emerald-600', label: 'done' },
  skipped: { symbol: '–', className: 'text-slate-400', label: 'skipped' },
  failed: { symbol: '!', className: 'text-red-600', label: 'failed' },
}

export function ProgressPanel({ progress, status }: { progress: Progress; status: KitStatus }) {
  const done = progress.steps.filter((step) => step.status === 'done' || step.status === 'skipped').length
  const total = Math.max(progress.steps.length, 1)

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between text-sm">
        <p className="font-medium text-slate-800">
          {status === 'queued' ? 'Queued' : status === 'running' ? 'Generating your kit' : 'Generation finished'}
        </p>
        <p className="text-xs text-slate-500">
          {done} of {total} steps
        </p>
      </div>

      <div
        className="h-1.5 overflow-hidden rounded-full bg-slate-200"
        role="progressbar"
        aria-valuenow={done}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-label="Generation progress"
      >
        <div className="h-full bg-indigo-600 transition-all duration-500" style={{ width: `${(done / total) * 100}%` }} />
      </div>

      <ol className="space-y-1.5">
        {progress.steps.map((step) => {
          const mark = MARKS[step.status]
          return (
            <li key={step.name} className="flex items-start gap-2.5 text-sm">
              <span aria-hidden="true" className={`mt-0.5 w-3 shrink-0 text-center font-semibold ${mark.className}`}>
                {step.status === 'running' ? (
                  <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-indigo-200 border-t-indigo-600" />
                ) : (
                  mark.symbol
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className={step.status === 'pending' ? 'text-slate-400' : 'text-slate-800'}>
                  {STEP_LABELS[step.name] ?? step.name}
                </span>
                <span className="sr-only"> — {mark.label}</span>
                {step.detail && <span className="mt-0.5 block text-xs text-slate-500">{step.detail}</span>}
              </span>
              {step.ms > 0 && <span className="shrink-0 text-xs tabular-nums text-slate-400">{formatDuration(step.ms)}</span>}
            </li>
          )
        })}
      </ol>
    </div>
  )
}
