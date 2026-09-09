export type KitStatus = 'queued' | 'running' | 'partial' | 'ready' | 'failed'
export type Origin = 'generated' | 'edited' | 'manual'
export type QuestionCategory = 'technical' | 'behavioural' | 'system-design' | 'company-fit'

export type Requirement = {
  id: string
  text: string
  kind: 'technical' | 'behavioural' | 'domain'
  priority: 'must' | 'nice'
}

export type Question = {
  id: string
  requirement_ids: string[]
  category: QuestionCategory
  prompt: string
  answer_outline: string
  difficulty: 1 | 2 | 3
  origin: Origin
  pinned: boolean
  rev: number
}

export type Flashcard = {
  id: string
  front: string
  back: string
  requirement_ids: string[]
  origin: Origin
  pinned: boolean
  rev: number
}

export type ScheduleDay = { day: number; focus: string; question_ids: string[]; minutes: number }

export type Kit = {
  source: {
    company: string
    company_url: string
    role: string
    location: string
    jd_chars: number
    researched_at: string
    pages_used: string[]
  }
  company_brief: { summary: string; what_they_do: string; sources: string[] }
  role: { title: string; seniority: string; responsibilities: string[]; requirements: Requirement[] }
  questions: Question[]
  flashcards: Flashcard[]
  schedule: { days_available: number; days: ScheduleDay[] }
  coverage: { uncovered_requirement_ids: string[]; passes: number }
  warnings: { step: string; source: string | null; reason: string }[]
}

export type StepRecord = { name: string; status: 'pending' | 'running' | 'done' | 'skipped' | 'failed'; ms: number; detail?: string }
export type Progress = { steps: StepRecord[]; current: string | null }
export type SectionState = { status: 'idle' | 'regenerating' | 'failed'; rev: number; updated_at?: string; error: string | null }

export type KitDoc = {
  id: string
  status: KitStatus
  input: { jd: string; companyUrl: string; days: number }
  progress: Progress
  kit: Kit | null
  sections: Record<string, SectionState>
  practice: { cardId: string; confidence: number; seenAt: string }[]
  error: { code: string; message: string } | null
  createdAt: string
  updatedAt: string
}

export type KitSummary = {
  id: string
  status: KitStatus
  role: string
  company: string
  days: number
  createdAt: string
  warningCount: number
}

export type User = { id: string; email: string }
export type PracticeOrder = { order: string[]; covered: string[]; notCovered: string[] }
