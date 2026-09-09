# Phase 2 — Web Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Next.js application where a user can register, sign in, see only their own kits, start a kit from a pasted job description or an uploaded file of cases, and watch generation progress step by step with clear loading, empty, partial and error states.

**Architecture:** Next.js App Router with Tailwind. Because the API lives on a different origin and sets an httpOnly cookie, every call is a credentialed `fetch` from the browser and authentication state is held in a client context rather than read on the server. One typed API client wraps every endpoint; one polling hook owns kit freshness. Components are presentational and take data as props, so Phase 3 can reuse them inside the builder.

**Tech Stack:** Next.js 15 (App Router), React 19, TypeScript, Tailwind CSS 3, no state library — React context for the session, a polling hook for the kit.

**Spec:** `docs/superpowers/specs/2026-09-08-interview-prep-kit-design.md`

**Depends on:** Phase 1 Tasks 12–14 (the API contract). The API must be running locally on `http://localhost:4000` before Task 17 can be verified.

## Global Constraints

- TypeScript only, `strict: true`.
- Tailwind for styling. No component library — the brief asks to see how components are built.
- **Every API call sends `credentials: 'include'`.** The session cookie is httpOnly and cross-origin; a call without it is anonymous and will 401.
- The API base URL comes from `NEXT_PUBLIC_API_URL` and is never hard-coded.
- Never render an error object. Every failure shows the API's `error.message`, which Phase 1 guarantees is a human sentence.
- Every interactive control is reachable and operable by keyboard, and has a visible focus ring.
- Loading, empty and error states are required for every view that fetches. A spinner with no context is not a loading state.
- Editing must never round-trip per keystroke. Local state first, request on commit.
- No secret is read in client code. `NEXT_PUBLIC_API_URL` is the only environment variable the browser sees.

## Design direction

Decided once here so the phases do not drift. The kit is a working document, so
the interface should read like a well-set document rather than a dashboard:
generous measure, strong typographic hierarchy, one accent colour used only for
actions and state.

- **Type:** system stack. Headings tight (`leading-tight`, `tracking-tight`), body `leading-relaxed`, question prose capped at `max-w-[68ch]`.
- **Scale:** `text-2xl` page titles, `text-lg` section titles, `text-sm` body in dense lists, `text-xs` for metadata.
- **Colour:** neutral slate ground, a single indigo accent for primary actions and the active state, amber for warnings and partial states, red only for destructive actions and errors. Status is never colour alone — always colour plus a word.
- **Surface:** white cards on `slate-50`, `rounded-lg`, `border border-slate-200`, no shadows except on overlays.
- **Density:** `space-y-6` between sections, `space-y-3` inside lists, `p-4` in cards.

## File Structure

```
apps/web/
  package.json
  tsconfig.json
  next.config.ts
  postcss.config.mjs
  tailwind.config.ts
  .env.local.example
  app/
    globals.css              tokens + base layer
    layout.tsx               shell, AuthProvider, nav
    page.tsx                 route by auth state
    login/page.tsx
    register/page.tsx
    kits/page.tsx            list
    kits/new/page.tsx        create: single + batch
    kits/[id]/page.tsx       progress in this phase; reader in Phase 3
  components/
    ui/Button.tsx
    ui/Field.tsx
    ui/Card.tsx
    ui/Spinner.tsx
    ui/StateBlock.tsx        loading / empty / error in one place
    ui/StatusBadge.tsx
    nav/TopBar.tsx
    kits/KitListItem.tsx
    kits/CreateKitForm.tsx
    kits/BatchUpload.tsx
    progress/ProgressPanel.tsx
    progress/WarningList.tsx
  lib/
    api.ts                   typed client, one function per endpoint
    types.ts                 Kit and API response types
    auth-context.tsx         session state
    use-kit.ts               polling hook
    format.ts               small display helpers
  test/
    api.test.ts
    use-kit.test.ts
    format.test.ts
```

---

## Task 1: Scaffold the web workspace and the design layer

**Files:**
- Create: `apps/web/package.json`, `apps/web/tsconfig.json`, `apps/web/next.config.ts`, `apps/web/postcss.config.mjs`, `apps/web/tailwind.config.ts`
- Create: `apps/web/.env.local.example`
- Create: `apps/web/app/globals.css`
- Create: `apps/web/app/layout.tsx`
- Create: `apps/web/components/ui/Button.tsx`, `Field.tsx`, `Card.tsx`, `Spinner.tsx`, `StateBlock.tsx`, `StatusBadge.tsx`
- Create: `apps/web/lib/format.ts`
- Modify: root `package.json` (add the `dev:web` script if absent), `vitest.config.ts`
- Test: `apps/web/test/format.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `Button` — props `{ variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; size?: 'sm' | 'md'; loading?: boolean }` plus all native button props
  - `Field` — props `{ label: string; error?: string; hint?: string; id: string; children: ReactNode }`
  - `Card` — props `{ title?: string; actions?: ReactNode; children: ReactNode; className?: string }`
  - `Spinner` — props `{ label: string; size?: 'sm' | 'md' }`
  - `StateBlock` — props `{ state: 'loading' | 'empty' | 'error'; title: string; detail?: string; action?: ReactNode }`
  - `StatusBadge` — props `{ status: KitStatus }` where `KitStatus = 'queued' | 'running' | 'partial' | 'ready' | 'failed'`
  - `formatDuration(ms: number): string`, `formatRelative(iso: string, now?: Date): string`, `pluralise(n: number, one: string, many?: string): string`

- [ ] **Step 1: Write the workspace files**

`apps/web/package.json`:

```json
{
  "name": "@ipk/web",
  "private": true,
  "scripts": {
    "dev": "next dev -p 3000",
    "build": "next build",
    "start": "next start"
  },
  "dependencies": {
    "next": "^15.1.3",
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@testing-library/dom": "^10.4.0",
    "@testing-library/react": "^16.1.0",
    "@types/react": "^19.0.2",
    "@types/react-dom": "^19.0.2",
    "autoprefixer": "^10.4.20",
    "jsdom": "^25.0.1",
    "postcss": "^8.4.49",
    "tailwindcss": "^3.4.17"
  }
}
```

`apps/web/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "jsx": "preserve",
    "noEmit": true,
    "declaration": false,
    "allowJs": true,
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

`apps/web/next.config.ts`:

```ts
import type { NextConfig } from 'next'

const config: NextConfig = {
  reactStrictMode: true,
  // The API is a separate origin; nothing is proxied, so the browser talks to
  // it directly with credentials and the API allows that origin by CORS.
  env: {},
}

export default config
```

`apps/web/postcss.config.mjs`:

```js
export default { plugins: { tailwindcss: {}, autoprefixer: {} } }
```

`apps/web/tailwind.config.ts`:

```ts
import type { Config } from 'tailwindcss'

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      maxWidth: { prose: '68ch' },
      fontFamily: {
        sans: ['ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'sans-serif'],
      },
    },
  },
  plugins: [],
}

export default config
```

`apps/web/.env.local.example`:

```
# Base URL of the Express API. No trailing slash.
NEXT_PUBLIC_API_URL=http://localhost:4000
```

- [ ] **Step 2: Write the stylesheet**

`apps/web/app/globals.css`:

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  :root {
    color-scheme: light;
  }

  body {
    @apply bg-slate-50 text-slate-900 antialiased;
  }

  /* Keyboard access is a scored requirement, so the focus ring is global and
     never removed per-component. */
  :focus-visible {
    @apply outline-none ring-2 ring-indigo-500 ring-offset-2 ring-offset-slate-50;
  }
}
```

- [ ] **Step 3: Register the web tests with vitest**

In `vitest.config.ts`, extend `include` and add a jsdom environment for the web
workspace:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts', 'apps/api/test/**/*.test.ts', 'apps/web/test/**/*.test.{ts,tsx}'],
    environment: 'node',
    environmentMatchGlobs: [['apps/web/test/**', 'jsdom']],
  },
})
```

Run `npm install` at the root.

- [ ] **Step 4: Write the failing format test**

`apps/web/test/format.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { formatDuration, formatRelative, pluralise } from '../lib/format.js'

describe('formatDuration', () => {
  it('shows sub-second work in milliseconds', () => {
    expect(formatDuration(420)).toBe('420ms')
  })

  it('shows seconds with one decimal under a minute', () => {
    expect(formatDuration(4200)).toBe('4.2s')
  })

  it('shows minutes and seconds above a minute', () => {
    expect(formatDuration(95_000)).toBe('1m 35s')
  })

  it('shows zero rather than an empty string', () => {
    expect(formatDuration(0)).toBe('0ms')
  })
})

describe('formatRelative', () => {
  const now = new Date('2026-09-08T12:00:00Z')

  it('says just now for the last minute', () => {
    expect(formatRelative('2026-09-08T11:59:30Z', now)).toBe('just now')
  })

  it('counts minutes and hours', () => {
    expect(formatRelative('2026-09-08T11:40:00Z', now)).toBe('20 minutes ago')
    expect(formatRelative('2026-09-08T09:00:00Z', now)).toBe('3 hours ago')
  })

  it('counts days', () => {
    expect(formatRelative('2026-09-06T12:00:00Z', now)).toBe('2 days ago')
  })

  it('uses the singular for one', () => {
    expect(formatRelative('2026-09-08T11:00:00Z', now)).toBe('1 hour ago')
  })

  it('returns an empty string for an unparseable date rather than throwing', () => {
    expect(formatRelative('not a date', now)).toBe('')
  })
})

describe('pluralise', () => {
  it('uses the singular for one and an s-plural by default', () => {
    expect(pluralise(1, 'question')).toBe('1 question')
    expect(pluralise(3, 'question')).toBe('3 questions')
  })

  it('accepts an irregular plural', () => {
    expect(pluralise(2, 'day', 'days')).toBe('2 days')
  })

  it('pluralises zero', () => {
    expect(pluralise(0, 'question')).toBe('0 questions')
  })
})
```

- [ ] **Step 5: Run it and confirm it fails**

Run: `npx vitest run apps/web/test/format.test.ts`
Expected: FAIL — cannot resolve `../lib/format.js`.

- [ ] **Step 6: Write the helpers**

`apps/web/lib/format.ts`:

```ts
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 1000) return `${Math.max(0, Math.round(ms))}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  const minutes = Math.floor(ms / 60_000)
  const seconds = Math.round((ms % 60_000) / 1000)
  return `${minutes}m ${seconds}s`
}

export function pluralise(n: number, one: string, many?: string): string {
  return `${n} ${n === 1 ? one : (many ?? `${one}s`)}`
}

export function formatRelative(iso: string, now = new Date()): string {
  const then = new Date(iso)
  if (Number.isNaN(then.getTime())) return ''

  const seconds = Math.round((now.getTime() - then.getTime()) / 1000)
  if (seconds < 60) return 'just now'
  if (seconds < 3600) return `${pluralise(Math.floor(seconds / 60), 'minute')} ago`
  if (seconds < 86_400) return `${pluralise(Math.floor(seconds / 3600), 'hour')} ago`
  return `${pluralise(Math.floor(seconds / 86_400), 'day')} ago`
}
```

- [ ] **Step 7: Run it and confirm it passes**

Run: `npx vitest run apps/web/test/format.test.ts`
Expected: PASS — 13 tests.

- [ ] **Step 8: Write the primitives**

`apps/web/components/ui/Spinner.tsx`:

```tsx
export function Spinner({ label, size = 'md' }: { label: string; size?: 'sm' | 'md' }) {
  const dimension = size === 'sm' ? 'h-4 w-4' : 'h-6 w-6'
  return (
    <span className="inline-flex items-center gap-2 text-sm text-slate-600">
      <span
        className={`${dimension} animate-spin rounded-full border-2 border-slate-300 border-t-indigo-600`}
        aria-hidden="true"
      />
      {/* The label is the accessible name; a bare spinner announces nothing. */}
      <span role="status">{label}</span>
    </span>
  )
}
```

`apps/web/components/ui/Button.tsx`:

```tsx
import type { ButtonHTMLAttributes, ReactNode } from 'react'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-indigo-600 text-white hover:bg-indigo-700 disabled:bg-indigo-300',
  secondary: 'bg-white text-slate-800 border border-slate-300 hover:bg-slate-50 disabled:text-slate-400',
  ghost: 'text-slate-700 hover:bg-slate-100 disabled:text-slate-400',
  danger: 'bg-white text-red-700 border border-red-200 hover:bg-red-50 disabled:text-red-300',
}

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant
  size?: 'sm' | 'md'
  loading?: boolean
  children: ReactNode
}

export function Button({ variant = 'primary', size = 'md', loading = false, children, className = '', ...rest }: Props) {
  const padding = size === 'sm' ? 'px-2.5 py-1.5 text-xs' : 'px-3.5 py-2 text-sm'
  return (
    <button
      {...rest}
      // A button that is busy must not be clickable twice, and must say why.
      disabled={rest.disabled || loading}
      aria-busy={loading || undefined}
      className={`inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors disabled:cursor-not-allowed ${padding} ${VARIANTS[variant]} ${className}`}
    >
      {loading && (
        <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden="true" />
      )}
      {children}
    </button>
  )
}
```

`apps/web/components/ui/Field.tsx`:

```tsx
import type { ReactNode } from 'react'

export function Field({
  label,
  id,
  error,
  hint,
  children,
}: {
  label: string
  id: string
  error?: string
  hint?: string
  children: ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium text-slate-800">
        {label}
      </label>
      {children}
      {hint && !error && (
        <p id={`${id}-hint`} className="text-xs text-slate-500">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} role="alert" className="text-xs font-medium text-red-700">
          {error}
        </p>
      )}
    </div>
  )
}

/** Shared input styling, so every control looks and focuses the same. */
export const inputClass =
  'w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 disabled:bg-slate-50'
```

`apps/web/components/ui/Card.tsx`:

```tsx
import type { ReactNode } from 'react'

export function Card({
  title,
  actions,
  children,
  className = '',
}: {
  title?: string
  actions?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={`rounded-lg border border-slate-200 bg-white ${className}`}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
          {title && <h2 className="text-lg font-semibold tracking-tight text-slate-900">{title}</h2>}
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  )
}
```

`apps/web/components/ui/StateBlock.tsx`:

```tsx
import type { ReactNode } from 'react'
import { Spinner } from './Spinner'

/**
 * One component for the three states every fetching view needs, so no view
 * can quietly ship without an empty or error case.
 */
export function StateBlock({
  state,
  title,
  detail,
  action,
}: {
  state: 'loading' | 'empty' | 'error'
  title: string
  detail?: string
  action?: ReactNode
}) {
  const tone = state === 'error' ? 'border-red-200 bg-red-50' : 'border-slate-200 bg-white'
  return (
    <div className={`rounded-lg border px-4 py-10 text-center ${tone}`}>
      {state === 'loading' ? (
        <div className="flex justify-center">
          <Spinner label={title} />
        </div>
      ) : (
        <p className={`text-sm font-medium ${state === 'error' ? 'text-red-800' : 'text-slate-800'}`}>{title}</p>
      )}
      {detail && <p className={`mx-auto mt-2 max-w-prose text-sm ${state === 'error' ? 'text-red-700' : 'text-slate-600'}`}>{detail}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  )
}
```

`apps/web/components/ui/StatusBadge.tsx`:

```tsx
import type { KitStatus } from '@/lib/types'

// Colour is never the only signal: every badge carries its word.
const LABELS: Record<KitStatus, { text: string; className: string }> = {
  queued: { text: 'Queued', className: 'bg-slate-100 text-slate-700' },
  running: { text: 'Generating', className: 'bg-indigo-50 text-indigo-800' },
  partial: { text: 'Ready with gaps', className: 'bg-amber-50 text-amber-900' },
  ready: { text: 'Ready', className: 'bg-emerald-50 text-emerald-800' },
  failed: { text: 'Failed', className: 'bg-red-50 text-red-800' },
}

export function StatusBadge({ status }: { status: KitStatus }) {
  const { text, className } = LABELS[status]
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${className}`}>{text}</span>
}
```

- [ ] **Step 9: Write the shell**

`apps/web/app/layout.tsx`:

```tsx
import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { TopBar } from '@/components/nav/TopBar'
import { AuthProvider } from '@/lib/auth-context'
import './globals.css'

export const metadata: Metadata = {
  title: 'Interview Prep Kit',
  description: 'Turn a job description and a company website into a preparation kit you can work through.',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh">
        <AuthProvider>
          <a
            href="#main"
            className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-2 focus:text-sm"
          >
            Skip to content
          </a>
          <TopBar />
          <main id="main" className="mx-auto w-full max-w-5xl px-4 py-8">
            {children}
          </main>
        </AuthProvider>
      </body>
    </html>
  )
}
```

`TopBar` and `AuthProvider` are written in Task 2; the app will not compile
until they exist, which is expected at this point in the sequence.

- [ ] **Step 10: Commit** — *present this message to the user; do not run it*

```
feat(web): scaffold next.js app with tailwind design layer and ui primitives
```

---

## Task 2: The API client and the session

Two things that everything else depends on: one typed wrapper around the API,
and a session the whole tree can read.

**Files:**
- Create: `apps/web/lib/types.ts`
- Create: `apps/web/lib/api.ts`
- Create: `apps/web/lib/auth-context.tsx`
- Create: `apps/web/components/nav/TopBar.tsx`
- Test: `apps/web/test/api.test.ts`

**Interfaces:**
- Consumes: nothing at runtime; mirrors Phase 1's response shapes.
- Produces:
  - `type KitStatus`, `type Kit`, `type Question`, `type Flashcard`, `type Requirement`, `type ScheduleDay`, `type StepRecord`, `type Progress`, `type KitDoc`, `type KitSummary`, `type SectionState`, `type PracticeOrder`
  - `class ApiError extends Error { status: number; code: string }`
  - `api` object: `register`, `login`, `logout`, `me`, `listKits`, `createKit`, `createBatch`, `getKit`, `deleteKit`, `patchQuestion`, `addQuestion`, `deleteQuestion`, `moveQuestion`, `reorderQuestions`, `patchFlashcard`, `addFlashcard`, `deleteFlashcard`, `reorderFlashcards`, `patchBrief`, `regenerate`, `recordPractice`, `practiceOrder`
  - `useAuth(): { user: User | null; status: 'loading' | 'signedIn' | 'signedOut'; signIn; register; signOut; error }`
  - `AuthProvider`, `TopBar`

- [ ] **Step 1: Write the types**

`apps/web/lib/types.ts` — mirrors Appendix A plus the state extensions. Kept as
its own file rather than imported from `@ipk/core`, because Next resists
imports from outside the app directory; the trade-off is noted in the README.

```ts
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
```

- [ ] **Step 2: Write the failing client test**

`apps/web/test/api.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api, ApiError } from '../lib/api.js'

const originalFetch = globalThis.fetch

function mockFetch(response: { status?: number; body?: unknown; ok?: boolean }) {
  const fn = vi.fn(async () => ({
    ok: response.ok ?? (response.status ?? 200) < 400,
    status: response.status ?? 200,
    json: async () => response.body ?? {},
  }))
  globalThis.fetch = fn as never
  return fn
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_API_URL = 'http://api.test'
})

afterEach(() => {
  globalThis.fetch = originalFetch
  vi.restoreAllMocks()
})

describe('api client', () => {
  it('sends credentials on every request, so the session cookie travels', async () => {
    const fetchMock = mockFetch({ body: { kits: [] } })
    await api.listKits()
    expect(fetchMock).toHaveBeenCalledWith('http://api.test/api/kits', expect.objectContaining({ credentials: 'include' }))
  })

  it('builds urls from NEXT_PUBLIC_API_URL without doubling slashes', async () => {
    process.env.NEXT_PUBLIC_API_URL = 'http://api.test/'
    const fetchMock = mockFetch({ body: {} })
    await api.getKit('abc')
    expect(fetchMock.mock.calls[0]![0]).toBe('http://api.test/api/kits/abc')
  })

  it('sends json with the right content type on a post', async () => {
    const fetchMock = mockFetch({ status: 202, body: { id: 'k1', status: 'queued' } })
    await api.createKit({ jd: 'text', companyUrl: 'https://x.test/', days: 3 })
    const init = fetchMock.mock.calls[0]![1] as RequestInit
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>)['content-type']).toBe('application/json')
    expect(JSON.parse(init.body as string)).toEqual({ jd: 'text', companyUrl: 'https://x.test/', days: 3 })
  })

  it('returns the parsed body on success', async () => {
    mockFetch({ body: { kits: [{ id: 'k1' }] } })
    await expect(api.listKits()).resolves.toEqual([{ id: 'k1' }])
  })

  it('throws an ApiError carrying the api’s own message', async () => {
    mockFetch({ status: 400, body: { error: { code: 'INVALID_INPUT', message: 'paste the job description' } } })
    await expect(api.createKit({ jd: '', companyUrl: 'x', days: 1 })).rejects.toMatchObject({
      status: 400,
      code: 'INVALID_INPUT',
      message: 'paste the job description',
    })
  })

  it('produces a readable error when the response is not json', async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: false,
      status: 502,
      json: async () => {
        throw new Error('not json')
      },
    })) as never
    await expect(api.listKits()).rejects.toBeInstanceOf(ApiError)
  })

  it('produces a readable error when the network is unreachable', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    }) as never
    await expect(api.listKits()).rejects.toMatchObject({ code: 'NETWORK' })
  })

  it('reports a duplicate creation distinctly rather than as an error', async () => {
    mockFetch({ status: 200, body: { id: 'k1', status: 'running', duplicate: true } })
    await expect(api.createKit({ jd: 'x', companyUrl: 'y', days: 1 })).resolves.toMatchObject({ duplicate: true })
  })

  it('returns nothing for a 204 without trying to parse a body', async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 204,
      json: async () => {
        throw new Error('should not be called')
      },
    })) as never
    await expect(api.deleteKit('k1')).resolves.toBeUndefined()
  })

  it('sends a patch with only the changed fields', async () => {
    const fetchMock = mockFetch({ body: {} })
    await api.patchQuestion('k1', 'q1', { prompt: 'new wording' })
    const init = fetchMock.mock.calls[0]![1] as RequestInit
    expect(init.method).toBe('PATCH')
    expect(JSON.parse(init.body as string)).toEqual({ prompt: 'new wording' })
    expect(fetchMock.mock.calls[0]![0]).toBe('http://api.test/api/kits/k1/questions/q1')
  })

  it('posts a regeneration to the section path', async () => {
    const fetchMock = mockFetch({ body: {} })
    await api.regenerate('k1', 'questions_technical')
    expect(fetchMock.mock.calls[0]![0]).toBe('http://api.test/api/kits/k1/regenerate/questions_technical')
  })
})
```

- [ ] **Step 3: Run it and confirm it fails**

Run: `npx vitest run apps/web/test/api.test.ts`
Expected: FAIL — cannot resolve `../lib/api.js`.

- [ ] **Step 4: Write the client**

`apps/web/lib/api.ts`:

```ts
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
```

- [ ] **Step 5: Run it and confirm it passes**

Run: `npx vitest run apps/web/test/api.test.ts`
Expected: PASS — 11 tests.

- [ ] **Step 6: Write the session context**

`apps/web/lib/auth-context.tsx`:

```tsx
'use client'

import { useRouter } from 'next/navigation'
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api, ApiError } from './api'
import type { User } from './types'

type Status = 'loading' | 'signedIn' | 'signedOut'

type AuthValue = {
  user: User | null
  status: Status
  error: string | null
  signIn: (email: string, password: string) => Promise<void>
  register: (email: string, password: string) => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthValue | null>(null)

/**
 * The session lives in the client because the cookie belongs to another
 * origin: a server component here cannot read it, so there is nothing to be
 * gained by pretending otherwise. The cost is a brief loading state on first
 * paint, which is why every page renders one rather than assuming a user.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [status, setStatus] = useState<Status>('loading')
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  useEffect(() => {
    let cancelled = false
    api
      .me()
      .then((current) => {
        if (cancelled) return
        setUser(current)
        setStatus('signedIn')
      })
      .catch(() => {
        if (cancelled) return
        setUser(null)
        setStatus('signedOut')
      })
    return () => {
      cancelled = true
    }
  }, [])

  const run = useCallback(
    async (action: () => Promise<User>) => {
      setError(null)
      try {
        const current = await action()
        setUser(current)
        setStatus('signedIn')
        router.push('/kits')
      } catch (caught) {
        setError(caught instanceof ApiError ? caught.message : 'something went wrong')
        throw caught
      }
    },
    [router],
  )

  const value = useMemo<AuthValue>(
    () => ({
      user,
      status,
      error,
      signIn: (email, password) => run(() => api.login(email, password)),
      register: (email, password) => run(() => api.register(email, password)),
      signOut: async () => {
        await api.logout().catch(() => {})
        setUser(null)
        setStatus('signedOut')
        router.push('/login')
      },
    }),
    [user, status, error, run, router],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth must be used inside AuthProvider')
  return value
}
```

- [ ] **Step 7: Write the top bar**

`apps/web/components/nav/TopBar.tsx`:

```tsx
'use client'

import Link from 'next/link'
import { Button } from '@/components/ui/Button'
import { useAuth } from '@/lib/auth-context'

export function TopBar() {
  const { user, status, signOut } = useAuth()

  return (
    <header className="border-b border-slate-200 bg-white">
      <nav className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4 px-4 py-3">
        <Link href="/" className="rounded text-sm font-semibold tracking-tight text-slate-900">
          Interview Prep Kit
        </Link>
        <div className="flex items-center gap-3 text-sm">
          {status === 'signedIn' && user ? (
            <>
              <Link href="/kits" className="rounded px-1 text-slate-700 hover:text-slate-900">
                My kits
              </Link>
              <Link href="/kits/new" className="rounded px-1 text-slate-700 hover:text-slate-900">
                New kit
              </Link>
              <span className="hidden text-xs text-slate-500 sm:inline">{user.email}</span>
              <Button variant="ghost" size="sm" onClick={() => void signOut()}>
                Sign out
              </Button>
            </>
          ) : status === 'signedOut' ? (
            <>
              <Link href="/login" className="rounded px-1 text-slate-700 hover:text-slate-900">
                Sign in
              </Link>
              <Link href="/register" className="rounded px-1 font-medium text-indigo-700 hover:text-indigo-800">
                Create account
              </Link>
            </>
          ) : null}
        </div>
      </nav>
    </header>
  )
}
```

- [ ] **Step 8: Commit** — *present this message to the user; do not run it*

```
feat(web): add typed api client, session context and top navigation
```

---

## Task 3: Authentication pages and the route guard

**Files:**
- Create: `apps/web/app/login/page.tsx`
- Create: `apps/web/app/register/page.tsx`
- Create: `apps/web/app/page.tsx`
- Create: `apps/web/components/auth/AuthForm.tsx`
- Create: `apps/web/components/auth/RequireAuth.tsx`

**Interfaces:**
- Consumes: `useAuth`, `Button`, `Field`, `inputClass`, `Card`, `StateBlock`.
- Produces:
  - `AuthForm` — props `{ mode: 'login' | 'register' }`
  - `RequireAuth` — props `{ children: ReactNode }`; renders a loading block while the session resolves, redirects to `/login` when signed out

- [ ] **Step 1: Write the shared form**

One component for both pages: the fields and the failure handling are
identical, and duplicating them would let the two drift.

`apps/web/components/auth/AuthForm.tsx`:

```tsx
'use client'

import Link from 'next/link'
import { useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Field, inputClass } from '@/components/ui/Field'
import { useAuth } from '@/lib/auth-context'

export function AuthForm({ mode }: { mode: 'login' | 'register' }) {
  const { signIn, register, error } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)

  const isRegister = mode === 'register'

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setLocalError(null)

    // Checked here as well as on the server so the user is told before a round trip.
    if (isRegister && password.length < 10) {
      setLocalError('use at least 10 characters')
      return
    }

    setSubmitting(true)
    try {
      await (isRegister ? register(email, password) : signIn(email, password))
    } catch {
      // The context already holds the message; nothing to add here.
    } finally {
      setSubmitting(false)
    }
  }

  const shown = localError ?? error

  return (
    <div className="mx-auto max-w-md">
      <Card title={isRegister ? 'Create an account' : 'Sign in'}>
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <Field label="Email" id="email">
            <input
              id="email"
              type="email"
              autoComplete="email"
              required
              className={inputClass}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </Field>

          <Field
            label="Password"
            id="password"
            hint={isRegister ? 'At least 10 characters.' : undefined}
          >
            <input
              id="password"
              type="password"
              autoComplete={isRegister ? 'new-password' : 'current-password'}
              required
              className={inputClass}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </Field>

          {shown && (
            <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
              {shown}
            </p>
          )}

          <Button type="submit" loading={submitting} className="w-full">
            {isRegister ? 'Create account' : 'Sign in'}
          </Button>

          <p className="text-center text-sm text-slate-600">
            {isRegister ? 'Already have an account? ' : 'No account yet? '}
            <Link href={isRegister ? '/login' : '/register'} className="rounded font-medium text-indigo-700 hover:text-indigo-800">
              {isRegister ? 'Sign in' : 'Create one'}
            </Link>
          </p>
        </form>
      </Card>
    </div>
  )
}
```

- [ ] **Step 2: Write the two pages and the entry redirect**

`apps/web/app/login/page.tsx`:

```tsx
import { AuthForm } from '@/components/auth/AuthForm'

export default function LoginPage() {
  return <AuthForm mode="login" />
}
```

`apps/web/app/register/page.tsx`:

```tsx
import { AuthForm } from '@/components/auth/AuthForm'

export default function RegisterPage() {
  return <AuthForm mode="register" />
}
```

`apps/web/app/page.tsx`:

```tsx
'use client'

import { useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { StateBlock } from '@/components/ui/StateBlock'
import { useAuth } from '@/lib/auth-context'

export default function HomePage() {
  const { status } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (status === 'signedIn') router.replace('/kits')
    if (status === 'signedOut') router.replace('/login')
  }, [status, router])

  return <StateBlock state="loading" title="Loading your session" />
}
```

- [ ] **Step 3: Write the guard**

`apps/web/components/auth/RequireAuth.tsx`:

```tsx
'use client'

import { useRouter } from 'next/navigation'
import { useEffect, type ReactNode } from 'react'
import { StateBlock } from '@/components/ui/StateBlock'
import { useAuth } from '@/lib/auth-context'

/**
 * A client-side guard, because the session cookie belongs to the API's origin
 * and cannot be read here on the server. The API is the real boundary — every
 * protected endpoint refuses an unauthenticated request — so this exists to
 * avoid showing a signed-out visitor a broken page, not to enforce access.
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { status } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (status === 'signedOut') router.replace('/login')
  }, [status, router])

  if (status === 'loading') return <StateBlock state="loading" title="Checking your session" />
  if (status === 'signedOut') return <StateBlock state="loading" title="Redirecting to sign in" />
  return <>{children}</>
}
```

- [ ] **Step 4: Verify by hand**

With the API running (`npm run dev:api`) and `npm run dev:web`:

1. Visit `/` signed out — redirected to `/login`.
2. Register with a nine-character password — the form refuses before any request.
3. Register properly — redirected to `/kits`.
4. Reload — still signed in.
5. Sign out — redirected to `/login`, and `/kits` no longer loads.
6. Tab through both forms — every control reachable, focus ring visible.

- [ ] **Step 5: Commit** — *present this message to the user; do not run it*

```
feat(web): add sign in, registration and the client route guard
```

---

## Task 4: Kit list and creation

Includes the second input path the brief requires: preparing for more than one
role at once by uploading a file of description-and-company pairs.

**Files:**
- Create: `apps/web/app/kits/page.tsx`
- Create: `apps/web/app/kits/new/page.tsx`
- Create: `apps/web/components/kits/KitListItem.tsx`
- Create: `apps/web/components/kits/CreateKitForm.tsx`
- Create: `apps/web/components/kits/BatchUpload.tsx`
- Create: `apps/web/lib/parse-cases.ts`
- Test: `apps/web/test/parse-cases.test.ts`

**Interfaces:**
- Consumes: `api`, `RequireAuth`, `StatusBadge`, `StateBlock`, `Card`, `Button`, `Field`, `inputClass`, `formatRelative`, `pluralise`.
- Produces:
  - `parseCases(raw: string): { cases: ParsedCase[]; errors: string[] }`
  - `type ParsedCase = { jd: string; companyUrl: string; days: number }`
  - `KitListItem` — props `{ kit: KitSummary; onDelete: (id: string) => void }`
  - `CreateKitForm`, `BatchUpload`

`parseCases` accepts both the Appendix B field names (`jd`, `company_url`,
`days`) and the camel-case names the form uses, so a file written for the batch
command can be uploaded directly into the interface.

- [ ] **Step 1: Write the failing parser test**

`apps/web/test/parse-cases.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { parseCases } from '../lib/parse-cases.js'

describe('parseCases', () => {
  it('accepts the Appendix B field names', () => {
    const { cases, errors } = parseCases(
      JSON.stringify([{ id: 'case-01', jd: 'Senior Backend Engineer', company_url: 'https://acme.test/', days: 5 }]),
    )
    expect(errors).toEqual([])
    expect(cases).toEqual([{ jd: 'Senior Backend Engineer', companyUrl: 'https://acme.test/', days: 5 }])
  })

  it('accepts the camel-case names the form uses', () => {
    const { cases } = parseCases(JSON.stringify([{ jd: 'x', companyUrl: 'https://acme.test/', days: 2 }]))
    expect(cases[0]!.companyUrl).toBe('https://acme.test/')
  })

  it('defaults a missing day count to one', () => {
    const { cases } = parseCases(JSON.stringify([{ jd: 'x', company_url: 'https://acme.test/' }]))
    expect(cases[0]!.days).toBe(1)
  })

  it('reports a row with no job description and keeps the others', () => {
    const { cases, errors } = parseCases(
      JSON.stringify([
        { jd: '   ', company_url: 'https://a.test/' },
        { jd: 'good', company_url: 'https://b.test/' },
      ]),
    )
    expect(cases).toHaveLength(1)
    expect(errors[0]).toContain('row 1')
  })

  it('reports a row with no company url', () => {
    const { errors } = parseCases(JSON.stringify([{ jd: 'good' }]))
    expect(errors[0]).toContain('company')
  })

  it('reports a non-integer day count', () => {
    const { errors } = parseCases(JSON.stringify([{ jd: 'x', company_url: 'https://a.test/', days: 2.5 }]))
    expect(errors[0]).toContain('whole number')
  })

  it('rejects a file that is not an array', () => {
    const { cases, errors } = parseCases(JSON.stringify({ jd: 'x' }))
    expect(cases).toEqual([])
    expect(errors[0]).toContain('array')
  })

  it('reports unparseable json without throwing', () => {
    const { errors } = parseCases('{not json')
    expect(errors[0]).toContain('could not be read')
  })

  it('rejects an empty array', () => {
    const { errors } = parseCases('[]')
    expect(errors[0]).toContain('no cases')
  })

  it('caps the number of cases and says so', () => {
    const many = Array.from({ length: 25 }, () => ({ jd: 'x', company_url: 'https://a.test/', days: 1 }))
    const { cases, errors } = parseCases(JSON.stringify(many))
    expect(cases).toHaveLength(20)
    expect(errors.join(' ')).toContain('20')
  })
})
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run apps/web/test/parse-cases.test.ts`
Expected: FAIL — cannot resolve `../lib/parse-cases.js`.

- [ ] **Step 3: Write the parser**

`apps/web/lib/parse-cases.ts`:

```ts
export type ParsedCase = { jd: string; companyUrl: string; days: number }

export const MAX_CASES = 20

/**
 * Accepts the same file the batch command reads, so a set of cases prepared
 * for `npm run evaluate` can be dropped straight into the interface. A bad row
 * is reported and skipped rather than rejecting the whole file — the same
 * posture the pipeline takes towards a bad source.
 */
export function parseCases(raw: string): { cases: ParsedCase[]; errors: string[] } {
  const errors: string[] = []

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { cases: [], errors: ['that file could not be read as JSON'] }
  }

  if (!Array.isArray(parsed)) {
    return { cases: [], errors: ['the file must contain an array of cases'] }
  }
  if (parsed.length === 0) {
    return { cases: [], errors: ['the file contained no cases'] }
  }

  const cases: ParsedCase[] = []
  parsed.forEach((row, index) => {
    if (cases.length >= MAX_CASES) return
    const record = (row ?? {}) as Record<string, unknown>

    const jd = typeof record.jd === 'string' ? record.jd.trim() : ''
    const companyUrl =
      typeof record.company_url === 'string'
        ? record.company_url.trim()
        : typeof record.companyUrl === 'string'
          ? record.companyUrl.trim()
          : ''
    const rawDays = record.days
    const days = rawDays === undefined ? 1 : Number(rawDays)

    if (jd.length === 0) {
      errors.push(`row ${index + 1}: no job description`)
      return
    }
    if (companyUrl.length === 0) {
      errors.push(`row ${index + 1}: no company website address`)
      return
    }
    if (!Number.isInteger(days) || days < 1) {
      errors.push(`row ${index + 1}: days must be a whole number of at least 1`)
      return
    }

    cases.push({ jd, companyUrl, days })
  })

  if (parsed.length > MAX_CASES) {
    errors.push(`only the first ${MAX_CASES} cases were taken from this file`)
  }

  return { cases, errors }
}
```

- [ ] **Step 4: Run it and confirm it passes**

Run: `npx vitest run apps/web/test/parse-cases.test.ts`
Expected: PASS — 10 tests.

- [ ] **Step 5: Write the create form**

`apps/web/components/kits/CreateKitForm.tsx`:

```tsx
'use client'

import { useRouter } from 'next/navigation'
import { useState, type FormEvent } from 'react'
import { api, ApiError } from '@/lib/api'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Field, inputClass } from '@/components/ui/Field'

export function CreateKitForm() {
  const router = useRouter()
  const [jd, setJd] = useState('')
  const [companyUrl, setCompanyUrl] = useState('')
  const [days, setDays] = useState(5)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setNotice(null)
    setSubmitting(true)
    try {
      const created = await api.createKit({ jd, companyUrl, days })
      // The API returns the existing job for a repeat submission rather than
      // starting a second one, so say so instead of pretending it is new.
      if (created.duplicate) setNotice('You have already started this one — opening it.')
      router.push(`/kits/${created.id}`)
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'something went wrong')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Card title="Prepare for one role">
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <Field label="Job description" id="jd" hint="Paste the posting text. Job boards block automated access, so this is not fetched for you.">
          <textarea
            id="jd"
            required
            rows={12}
            className={`${inputClass} font-mono text-xs leading-relaxed`}
            placeholder="Senior Backend Engineer&#10;&#10;We are looking for..."
            value={jd}
            onChange={(event) => setJd(event.target.value)}
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-[2fr,1fr]">
          <Field label="Company website" id="companyUrl" hint="The homepage is enough — the careers page is found by crawling.">
            <input
              id="companyUrl"
              required
              className={inputClass}
              placeholder="https://example.com"
              value={companyUrl}
              onChange={(event) => setCompanyUrl(event.target.value)}
            />
          </Field>

          <Field label="Days until the interview" id="days">
            <input
              id="days"
              type="number"
              min={1}
              max={60}
              required
              className={inputClass}
              value={days}
              onChange={(event) => setDays(Number(event.target.value))}
            />
          </Field>
        </div>

        <p className="text-xs text-slate-500">
          {jd.trim().length < 400
            ? 'Short descriptions produce short kits — the kit will say so rather than padding itself out.'
            : `${jd.trim().length.toLocaleString()} characters of description.`}
        </p>

        {error && (
          <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
            {error}
          </p>
        )}
        {notice && <p className="rounded-md bg-slate-100 px-3 py-2 text-sm text-slate-700">{notice}</p>}

        <Button type="submit" loading={submitting}>
          {submitting ? 'Starting' : 'Build my kit'}
        </Button>
      </form>
    </Card>
  )
}
```

- [ ] **Step 6: Write the batch upload**

`apps/web/components/kits/BatchUpload.tsx`:

```tsx
'use client'

import { useRouter } from 'next/navigation'
import { useState, type ChangeEvent } from 'react'
import { api, ApiError } from '@/lib/api'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { parseCases, type ParsedCase } from '@/lib/parse-cases'
import { pluralise } from '@/lib/format'

export function BatchUpload() {
  const router = useRouter()
  const [cases, setCases] = useState<ParsedCase[]>([])
  const [problems, setProblems] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    setError(null)
    const { cases: parsed, errors } = parseCases(await file.text())
    setCases(parsed)
    setProblems(errors)
  }

  async function onSubmit() {
    setError(null)
    setSubmitting(true)
    try {
      const ids = await api.createBatch(cases)
      // Straight to the list: several kits are now generating at once, and the
      // list is the view that shows all of them advancing.
      router.push(ids.length === 1 ? `/kits/${ids[0]}` : '/kits')
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'something went wrong')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Card title="Prepare for several roles at once">
      <div className="space-y-4">
        <p className="max-w-prose text-sm text-slate-600">
          Upload a JSON array of cases. The same file the batch command reads works here:{' '}
          <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">
            {'[{ "jd": "...", "company_url": "https://...", "days": 5 }]'}
          </code>
        </p>

        <div>
          <label htmlFor="cases" className="block text-sm font-medium text-slate-800">
            Cases file
          </label>
          <input
            id="cases"
            type="file"
            accept="application/json,.json"
            onChange={(event) => void onFile(event)}
            className="mt-1.5 block w-full cursor-pointer rounded-md border border-slate-300 bg-white p-2 text-sm file:mr-3 file:rounded file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-sm"
          />
        </div>

        {problems.length > 0 && (
          <ul className="space-y-1 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
            {problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        )}

        {cases.length > 0 && (
          <div className="space-y-2">
            <p className="text-sm text-slate-700">
              {pluralise(cases.length, 'case')} ready.
            </p>
            <ul className="divide-y divide-slate-200 rounded-md border border-slate-200 text-sm">
              {cases.map((item, index) => (
                <li key={`${item.companyUrl}-${index}`} className="flex flex-wrap items-baseline justify-between gap-2 px-3 py-2">
                  <span className="truncate text-slate-800">{item.companyUrl}</span>
                  <span className="text-xs text-slate-500">
                    {item.jd.trim().length.toLocaleString()} chars · {pluralise(item.days, 'day')}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {error && (
          <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
            {error}
          </p>
        )}

        <Button onClick={() => void onSubmit()} disabled={cases.length === 0} loading={submitting}>
          {submitting ? 'Starting' : `Build ${pluralise(cases.length, 'kit')}`}
        </Button>
      </div>
    </Card>
  )
}
```

- [ ] **Step 7: Write the list item and the two pages**

`apps/web/components/kits/KitListItem.tsx`:

```tsx
'use client'

import Link from 'next/link'
import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { formatRelative, pluralise } from '@/lib/format'
import type { KitSummary } from '@/lib/types'

export function KitListItem({ kit, onDelete }: { kit: KitSummary; onDelete: (id: string) => void }) {
  const [confirming, setConfirming] = useState(false)

  return (
    <li className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 px-4 py-3 last:border-b-0">
      <div className="min-w-0 space-y-1">
        <Link href={`/kits/${kit.id}`} className="block rounded text-sm font-medium text-slate-900 hover:text-indigo-700">
          {kit.role || 'Untitled role'}
        </Link>
        <p className="truncate text-xs text-slate-500">
          {kit.company} · {pluralise(kit.days, 'day')} · {formatRelative(kit.createdAt)}
          {kit.warningCount > 0 && ` · ${pluralise(kit.warningCount, 'gap')} reported`}
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <StatusBadge status={kit.status} />
        {confirming ? (
          <>
            <Button variant="danger" size="sm" onClick={() => onDelete(kit.id)}>
              Delete
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
          </>
        ) : (
          <Button variant="ghost" size="sm" onClick={() => setConfirming(true)} aria-label={`Delete kit for ${kit.role}`}>
            Delete
          </Button>
        )}
      </div>
    </li>
  )
}
```

`apps/web/app/kits/page.tsx`:

```tsx
'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { RequireAuth } from '@/components/auth/RequireAuth'
import { KitListItem } from '@/components/kits/KitListItem'
import { Button } from '@/components/ui/Button'
import { StateBlock } from '@/components/ui/StateBlock'
import { api, ApiError } from '@/lib/api'
import type { KitSummary } from '@/lib/types'

const REFRESH_MS = 4000

function KitList() {
  const [kits, setKits] = useState<KitSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setKits(await api.listKits())
      setError(null)
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'something went wrong')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // Kits generating in the background change status without any user action,
  // so the list refreshes while any of them is unfinished — and stops when
  // none are, rather than polling forever.
  useEffect(() => {
    const unfinished = kits?.some((kit) => kit.status === 'queued' || kit.status === 'running')
    if (!unfinished) return
    const timer = setInterval(() => void load(), REFRESH_MS)
    return () => clearInterval(timer)
  }, [kits, load])

  async function remove(id: string) {
    setKits((current) => current?.filter((kit) => kit.id !== id) ?? null)
    try {
      await api.deleteKit(id)
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'could not delete that kit')
      void load()
    }
  }

  if (error && kits === null) {
    return <StateBlock state="error" title="Could not load your kits" detail={error} action={<Button onClick={() => void load()}>Try again</Button>} />
  }
  if (kits === null) return <StateBlock state="loading" title="Loading your kits" />

  if (kits.length === 0) {
    return (
      <StateBlock
        state="empty"
        title="No kits yet"
        detail="Paste a job description and a company website address, and the first kit takes a minute or two to build."
        action={
          <Link href="/kits/new">
            <Button>Build my first kit</Button>
          </Link>
        }
      />
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">My kits</h1>
        <Link href="/kits/new">
          <Button size="sm">New kit</Button>
        </Link>
      </div>

      {error && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      )}

      <ul className="rounded-lg border border-slate-200 bg-white">
        {kits.map((kit) => (
          <KitListItem key={kit.id} kit={kit} onDelete={(id) => void remove(id)} />
        ))}
      </ul>
    </div>
  )
}

export default function KitsPage() {
  return (
    <RequireAuth>
      <KitList />
    </RequireAuth>
  )
}
```

`apps/web/app/kits/new/page.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { RequireAuth } from '@/components/auth/RequireAuth'
import { BatchUpload } from '@/components/kits/BatchUpload'
import { CreateKitForm } from '@/components/kits/CreateKitForm'

type Tab = 'single' | 'batch'

function NewKit() {
  const [tab, setTab] = useState<Tab>('single')

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight text-slate-900">New kit</h1>

      <div role="tablist" aria-label="How many roles" className="inline-flex rounded-md border border-slate-300 bg-white p-0.5">
        {(['single', 'batch'] as Tab[]).map((value) => (
          <button
            key={value}
            role="tab"
            type="button"
            aria-selected={tab === value}
            onClick={() => setTab(value)}
            className={`rounded px-3 py-1.5 text-sm font-medium ${tab === value ? 'bg-indigo-600 text-white' : 'text-slate-700 hover:bg-slate-50'}`}
          >
            {value === 'single' ? 'One role' : 'Several roles'}
          </button>
        ))}
      </div>

      {tab === 'single' ? <CreateKitForm /> : <BatchUpload />}
    </div>
  )
}

export default function NewKitPage() {
  return (
    <RequireAuth>
      <NewKit />
    </RequireAuth>
  )
}
```

- [ ] **Step 8: Verify by hand**

1. Sign in with no kits — the empty state appears with a working action.
2. Create a kit — redirected to its page; the list shows it as Generating.
3. Submit the same description and company again — the notice appears and the same kit opens.
4. Upload `cases.example.json` from the repo root — both rows are listed, then two kits are created.
5. Upload a file with a bad row — that row is reported, the good rows still load.
6. Delete a kit — it disappears, and a reload confirms it is gone.

- [ ] **Step 9: Commit** — *present this message to the user; do not run it*

```
feat(web): add kit list, single-role creation and batch case upload
```

---

## Task 5: The progress view

The brief calls this out twice: interaction design during a long-running
generation, and visible progress with clear failure states. This is where the
sequencing the pipeline does becomes something a person can watch.

**Files:**
- Create: `apps/web/lib/use-kit.ts`
- Create: `apps/web/components/progress/ProgressPanel.tsx`
- Create: `apps/web/components/progress/WarningList.tsx`
- Create: `apps/web/app/kits/[id]/page.tsx`
- Test: `apps/web/test/use-kit.test.ts`

**Interfaces:**
- Consumes: `api`, `ApiError`, `KitDoc`, `StepRecord`, `formatDuration`.
- Produces:
  - `useKit(id: string, opts?: { intervalMs?: number }): { doc: KitDoc | null; error: string | null; loading: boolean; refresh: () => Promise<void>; setDoc: (doc: KitDoc) => void }`
  - `STEP_LABELS: Record<string, string>` — the human name for each pipeline step
  - `ProgressPanel` — props `{ progress: Progress; status: KitStatus }`
  - `WarningList` — props `{ warnings: Kit['warnings'] }`
  - `isUnfinished(status: KitStatus): boolean`

`useKit` polls only while the kit is unfinished, and exposes `setDoc` so Phase 3
can apply an optimistic edit without waiting for a refetch.

- [ ] **Step 1: Write the failing hook test**

`apps/web/test/use-kit.test.ts`:

```ts
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { isUnfinished, useKit } from '../lib/use-kit.js'
import type { KitDoc } from '../lib/types.js'

function doc(status: KitDoc['status'], current: string | null = null): KitDoc {
  return {
    id: 'k1',
    status,
    input: { jd: 'x', companyUrl: 'https://a.test/', days: 3 },
    progress: { steps: [{ name: 'extractRequirements', status: 'done', ms: 900 }], current },
    kit: null,
    sections: {},
    practice: [],
    error: null,
    createdAt: '2026-09-08T10:00:00Z',
    updatedAt: '2026-09-08T10:00:05Z',
  }
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('isUnfinished', () => {
  it('is true only while work remains', () => {
    expect(isUnfinished('queued')).toBe(true)
    expect(isUnfinished('running')).toBe(true)
    expect(isUnfinished('ready')).toBe(false)
    expect(isUnfinished('partial')).toBe(false)
    expect(isUnfinished('failed')).toBe(false)
  })
})

describe('useKit', () => {
  it('loads the kit and clears the loading flag', async () => {
    const getKit = vi.fn(async () => doc('ready'))
    vi.doMock('../lib/api.js', () => ({ api: { getKit }, ApiError: Error }))
    const { result } = renderHook(() => useKit('k1'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.doc?.status).toBe('ready')
  })

  it('polls while the kit is running', async () => {
    vi.useFakeTimers()
    const getKit = vi.fn(async () => doc('running', 'discoverPages'))
    vi.doMock('../lib/api.js', () => ({ api: { getKit }, ApiError: Error }))
    renderHook(() => useKit('k1', { intervalMs: 50 }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(160)
    })
    expect(getKit.mock.calls.length).toBeGreaterThan(1)
  })

  it('stops polling once the kit is ready', async () => {
    vi.useFakeTimers()
    const getKit = vi.fn(async () => doc('ready'))
    vi.doMock('../lib/api.js', () => ({ api: { getKit }, ApiError: Error }))
    renderHook(() => useKit('k1', { intervalMs: 50 }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200)
    })
    const callsAfterSettle = getKit.mock.calls.length
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400)
    })
    expect(getKit.mock.calls.length).toBe(callsAfterSettle)
  })

  it('surfaces an error message', async () => {
    class Api extends Error {
      constructor(public message: string) {
        super(message)
      }
    }
    const getKit = vi.fn(async () => {
      throw new Api('no such kit')
    })
    vi.doMock('../lib/api.js', () => ({ api: { getKit }, ApiError: Api }))
    const { result } = renderHook(() => useKit('k1'))
    await waitFor(() => expect(result.current.error).toBe('no such kit'))
  })

  it('lets a caller replace the document optimistically', async () => {
    const getKit = vi.fn(async () => doc('ready'))
    vi.doMock('../lib/api.js', () => ({ api: { getKit }, ApiError: Error }))
    const { result } = renderHook(() => useKit('k1'))
    await waitFor(() => expect(result.current.doc).not.toBeNull())
    act(() => {
      result.current.setDoc({ ...doc('ready'), id: 'replaced' })
    })
    expect(result.current.doc?.id).toBe('replaced')
  })
})
```

If mocking the module proves awkward with `vi.doMock` ordering, inject the
fetcher instead: give `useKit` an optional third argument
`fetcher: (id: string) => Promise<KitDoc>` defaulting to `api.getKit`, and pass
a stub in the tests. That is the simpler design and preferable if the mock
fights you — update the interface block above if you take it.

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run apps/web/test/use-kit.test.ts`
Expected: FAIL — cannot resolve `../lib/use-kit.js`.

- [ ] **Step 3: Write the hook**

`apps/web/lib/use-kit.ts`:

```ts
'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { api, ApiError } from './api'
import type { KitDoc, KitStatus } from './types'

export const DEFAULT_POLL_MS = 1500

export function isUnfinished(status: KitStatus): boolean {
  return status === 'queued' || status === 'running'
}

/**
 * Owns kit freshness for a page. Polls only while generation is unfinished, so
 * a finished kit costs nothing to sit on, and exposes setDoc so an edit can be
 * applied locally at once and the server response folded in when it lands.
 */
export function useKit(id: string, opts: { intervalMs?: number; fetcher?: (id: string) => Promise<KitDoc> } = {}) {
  const [doc, setDoc] = useState<KitDoc | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const fetcher = opts.fetcher ?? api.getKit
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const refresh = useCallback(async () => {
    try {
      const next = await fetcher(id)
      if (!mounted.current) return
      setDoc(next)
      setError(null)
    } catch (caught) {
      if (!mounted.current) return
      setError(caught instanceof ApiError ? caught.message : 'could not load this kit')
    } finally {
      if (mounted.current) setLoading(false)
    }
  }, [id, fetcher])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    if (!doc || !isUnfinished(doc.status)) return
    const timer = setInterval(() => void refresh(), opts.intervalMs ?? DEFAULT_POLL_MS)
    return () => clearInterval(timer)
  }, [doc, refresh, opts.intervalMs])

  return { doc, error, loading, refresh, setDoc }
}
```

- [ ] **Step 4: Write the progress components**

`apps/web/components/progress/ProgressPanel.tsx`:

```tsx
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
```

`apps/web/components/progress/WarningList.tsx`:

```tsx
import type { Kit } from '@/lib/types'

/**
 * Warnings are shown rather than hidden. A skipped source or a thin
 * description is information the user needs when reading the kit, and hiding
 * it would make the kit look more authoritative than it is.
 */
export function WarningList({ warnings }: { warnings: Kit['warnings'] }) {
  if (warnings.length === 0) return null

  return (
    <details className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
      <summary className="cursor-pointer text-sm font-medium text-amber-900">
        {warnings.length === 1 ? '1 thing to know about this kit' : `${warnings.length} things to know about this kit`}
      </summary>
      <ul className="mt-2 space-y-1.5 text-sm text-amber-900">
        {warnings.map((warning, index) => (
          <li key={`${warning.step}-${index}`}>
            <span className="font-medium">{warning.step}</span>: {warning.reason}
            {warning.source && <span className="block truncate text-xs text-amber-800">{warning.source}</span>}
          </li>
        ))}
      </ul>
    </details>
  )
}
```

- [ ] **Step 5: Write the kit page**

In this phase the page shows generation and a summary. Phase 3 replaces the
`ready` branch with the reader and builder.

`apps/web/app/kits/[id]/page.tsx`:

```tsx
'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { RequireAuth } from '@/components/auth/RequireAuth'
import { ProgressPanel } from '@/components/progress/ProgressPanel'
import { WarningList } from '@/components/progress/WarningList'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { StateBlock } from '@/components/ui/StateBlock'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { pluralise } from '@/lib/format'
import { useKit } from '@/lib/use-kit'

function KitView({ id }: { id: string }) {
  const { doc, error, loading, refresh } = useKit(id)

  if (loading) return <StateBlock state="loading" title="Loading this kit" />
  if (error || !doc) {
    return (
      <StateBlock
        state="error"
        title="Could not load this kit"
        detail={error ?? 'it may have been deleted'}
        action={
          <Link href="/kits">
            <Button variant="secondary">Back to my kits</Button>
          </Link>
        }
      />
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            {doc.kit?.role.title ?? 'Building your kit'}
          </h1>
          <p className="text-sm text-slate-600">
            {doc.kit?.source.company ?? doc.input.companyUrl} · {pluralise(doc.input.days, 'day')} to prepare
          </p>
        </div>
        <StatusBadge status={doc.status} />
      </div>

      {doc.status === 'failed' && (
        <StateBlock
          state="error"
          title="This kit could not be generated"
          detail={doc.error?.message ?? 'the run failed before a kit could be produced'}
          action={
            <Link href="/kits/new">
              <Button variant="secondary">Start another</Button>
            </Link>
          }
        />
      )}

      {(doc.status === 'queued' || doc.status === 'running') && (
        <Card title="Progress">
          <ProgressPanel progress={doc.progress} status={doc.status} />
          <p className="mt-4 max-w-prose text-xs text-slate-500">
            This usually takes a minute or two. You can leave this page — generation continues, and the kit will be
            waiting in your list.
          </p>
        </Card>
      )}

      {doc.kit && (
        <>
          <WarningList warnings={doc.kit.warnings} />

          <Card
            title="Kit summary"
            actions={
              <Button variant="secondary" size="sm" onClick={() => void refresh()}>
                Refresh
              </Button>
            }
          >
            <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
              <div>
                <dt className="text-xs uppercase tracking-wide text-slate-500">Requirements</dt>
                <dd className="mt-0.5 text-lg font-semibold tabular-nums text-slate-900">{doc.kit.role.requirements.length}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-slate-500">Questions</dt>
                <dd className="mt-0.5 text-lg font-semibold tabular-nums text-slate-900">{doc.kit.questions.length}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-slate-500">Flashcards</dt>
                <dd className="mt-0.5 text-lg font-semibold tabular-nums text-slate-900">{doc.kit.flashcards.length}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-slate-500">Uncovered</dt>
                <dd
                  className={`mt-0.5 text-lg font-semibold tabular-nums ${doc.kit.coverage.uncovered_requirement_ids.length > 0 ? 'text-amber-700' : 'text-emerald-700'}`}
                >
                  {doc.kit.coverage.uncovered_requirement_ids.length}
                </dd>
              </div>
            </dl>
            <p className="mt-4 text-xs text-slate-500">
              Coverage was checked over {pluralise(doc.kit.coverage.passes, 'pass', 'passes')}. The reader and the
              builder arrive in the next phase.
            </p>
          </Card>

          <Card title="Sources used">
            {doc.kit.source.pages_used.length === 0 ? (
              <p className="text-sm text-slate-600">
                Nothing could be retrieved from this company&apos;s site, so the kit was built from the job description
                alone.
              </p>
            ) : (
              <ul className="space-y-1 text-sm">
                {doc.kit.source.pages_used.map((url) => (
                  <li key={url} className="truncate">
                    <a href={url} target="_blank" rel="noreferrer noopener" className="rounded text-indigo-700 hover:underline">
                      {url}
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      )}
    </div>
  )
}

export default function KitPage() {
  const params = useParams<{ id: string }>()
  return (
    <RequireAuth>
      <KitView id={params.id} />
    </RequireAuth>
  )
}
```

- [ ] **Step 6: Run the tests and check types**

Run: `npx vitest run apps/web` then `npx tsc --noEmit -p apps/web`
Expected: PASS; no type errors.

- [ ] **Step 7: Verify by hand — this is the interaction the video shows**

1. Create a kit and stay on the page: steps advance one at a time, each with an elapsed time.
2. Navigate away mid-generation and come back: progress is where it should be, not restarted.
3. Reload mid-generation: same.
4. Use a company URL that 404s: the crawl step reports the failure, the run continues, and the finished kit lists the warning.
5. Use a two-line description: the kit completes and the warning says the description was thin.
6. Stop the API mid-poll: the error state appears with a readable message, not a stack trace.
7. Narrow the window to phone width: the summary grid reflows and nothing overflows horizontally.

- [ ] **Step 8: Commit** — *present this message to the user; do not run it*

```
feat(web): show live generation progress, warnings and kit summary
```

---

## Phase 2 done when

- A new visitor can register, and a signed-out visitor is bounced from `/kits` and `/kits/:id`.
- A kit can be started from a pasted description or an uploaded cases file.
- Generation progress is visible step by step and survives navigation and reload.
- An unreachable company site, a thin description and a hard failure each produce a distinct, readable state.
- `npx vitest run` is green and `npx tsc --noEmit -p apps/web` is clean.

Next: `phase-3-reader-and-builder.md` — the reader, then the builder, where an
edit must survive a regeneration.
