import type { PipelineWarning } from '../fetch/discover.js'

export type StepStatus = 'pending' | 'running' | 'done' | 'skipped' | 'failed'
export type StepRecord = { name: string; status: StepStatus; ms: number; detail?: string }
export type Progress = { steps: StepRecord[]; current: string | null }
export type ProgressReporter = (progress: Progress) => void | Promise<void>

export type { PipelineWarning }
