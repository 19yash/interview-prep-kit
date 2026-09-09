import type {
  Flashcard,
  KitDoc,
  KitSummary,
  PracticeOrder,
  Question,
  QuestionCategory,
  User,
} from './types'

export class ApiError extends Error {
  status: number
  code: string
  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

function baseUrl(): string {
  return (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000').replace(/\/+$/, '')
}

/**
 * One place that knows how to talk to the API. Credentials are always
 * included, because the session is an httpOnly cookie on another origin and a
 * request without it is anonymous. Every failure arrives as an ApiError whose
 * message is the sentence the API wrote, so views never invent their own.
 */
async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${baseUrl()}${path}`, {
      ...init,
      credentials: 'include',
      headers: init.body ? { 'content-type': 'application/json', ...(init.headers ?? {}) } : init.headers,
    })
  } catch {
    throw new ApiError(0, 'NETWORK', 'could not reach the server — check your connection and try again')
  }

  if (response.status === 204) return undefined as T

  let body: unknown
  try {
    body = await response.json()
  } catch {
    if (response.ok) return undefined as T
    throw new ApiError(response.status, 'BAD_RESPONSE', `the server returned an unexpected response (${response.status})`)
  }

  if (!response.ok) {
    const error = (body as { error?: { code?: string; message?: string } }).error
    if (response.status === 401 && path !== '/api/auth/me') {
      if (typeof window !== 'undefined') window.dispatchEvent(new Event('ipk:signed-out'))
    }
    throw new ApiError(response.status, error?.code ?? 'UNKNOWN', error?.message ?? 'something went wrong')
  }

  return body as T
}

const json = (value: unknown): RequestInit => ({ body: JSON.stringify(value) })

export const api = {
  // --- auth ---
  register: (email: string, password: string) =>
    call<{ user: User }>('/api/auth/register', { method: 'POST', ...json({ email, password }) }).then((r) => r.user),
  login: (email: string, password: string) =>
    call<{ user: User }>('/api/auth/login', { method: 'POST', ...json({ email, password }) }).then((r) => r.user),
  logout: () => call<void>('/api/auth/logout', { method: 'POST' }),
  me: () => call<{ user: User }>('/api/auth/me').then((r) => r.user),

  // --- kits ---
  listKits: () => call<{ kits: KitSummary[] }>('/api/kits').then((r) => r.kits),
  createKit: (input: { jd: string; companyUrl: string; days: number }) =>
    call<{ id: string; status: string; duplicate?: boolean }>('/api/kits', { method: 'POST', ...json(input) }),
  createBatch: (cases: { jd: string; companyUrl: string; days: number }[]) =>
    call<{ ids: string[] }>('/api/kits/batch', { method: 'POST', ...json({ cases }) }).then((r) => r.ids),
  getKit: (id: string) => call<KitDoc>(`/api/kits/${id}`),
  deleteKit: (id: string) => call<void>(`/api/kits/${id}`, { method: 'DELETE' }),

  // --- builder ---
  patchQuestion: (
    kitId: string,
    questionId: string,
    patch: Partial<Pick<Question, 'prompt' | 'answer_outline' | 'difficulty' | 'pinned'>>,
  ) => call<KitDoc>(`/api/kits/${kitId}/questions/${questionId}`, { method: 'PATCH', ...json(patch) }),
  addQuestion: (
    kitId: string,
    input: { category: QuestionCategory; prompt: string; answer_outline?: string; requirement_ids?: string[]; difficulty?: number },
  ) => call<{ question: Question; kit: KitDoc }>(`/api/kits/${kitId}/questions`, { method: 'POST', ...json(input) }),
  deleteQuestion: (kitId: string, questionId: string) =>
    call<void>(`/api/kits/${kitId}/questions/${questionId}`, { method: 'DELETE' }),
  moveQuestion: (kitId: string, questionId: string, category: QuestionCategory) =>
    call<KitDoc>(`/api/kits/${kitId}/questions/${questionId}/category`, { method: 'PATCH', ...json({ category }) }),
  reorderQuestions: (kitId: string, ids: string[]) =>
    call<KitDoc>(`/api/kits/${kitId}/questions/order`, { method: 'PUT', ...json({ ids }) }),

  patchFlashcard: (kitId: string, cardId: string, patch: Partial<Pick<Flashcard, 'front' | 'back' | 'pinned'>>) =>
    call<KitDoc>(`/api/kits/${kitId}/flashcards/${cardId}`, { method: 'PATCH', ...json(patch) }),
  addFlashcard: (kitId: string, input: { front: string; back?: string; requirement_ids?: string[] }) =>
    call<{ flashcard: Flashcard; kit: KitDoc }>(`/api/kits/${kitId}/flashcards`, { method: 'POST', ...json(input) }),
  deleteFlashcard: (kitId: string, cardId: string) => call<void>(`/api/kits/${kitId}/flashcards/${cardId}`, { method: 'DELETE' }),
  reorderFlashcards: (kitId: string, ids: string[]) =>
    call<KitDoc>(`/api/kits/${kitId}/flashcards/order`, { method: 'PUT', ...json({ ids }) }),

  patchBrief: (kitId: string, patch: { summary?: string; what_they_do?: string }) =>
    call<KitDoc>(`/api/kits/${kitId}/brief`, { method: 'PATCH', ...json(patch) }),
  regenerate: (kitId: string, section: string) => call<KitDoc>(`/api/kits/${kitId}/regenerate/${section}`, { method: 'POST' }),

  // --- practice ---
  recordPractice: (kitId: string, cardId: string, confidence: 1 | 2 | 3) =>
    call<PracticeOrder>(`/api/kits/${kitId}/practice`, { method: 'POST', ...json({ cardId, confidence }) }),
  practiceOrder: (kitId: string) => call<PracticeOrder>(`/api/kits/${kitId}/practice/next`),
}
