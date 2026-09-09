# AI Interview Prep Kit — Design

Date: 2026-09-08
Assessment: Trao FS-AI-INTERVIEW-01
Timebox: one working day

## 1. Purpose

A web application that turns a pasted job description plus a company website
address into a structured, editable interview preparation kit: a company brief,
a role breakdown, a categorised question bank, flashcards, and a day-by-day
study schedule sized to the number of days the user has left.

Two parts of the brief are fixed and everything is built around them:

- The kit JSON must match Appendix A exactly, field for field.
- `npm run evaluate -- --input <cases.json> --output <kits.json>` must run the
  full pipeline from a clean clone and write Appendix B.

Everything else is a design decision recorded here and justified in the README.

## 2. Stack

| Layer | Choice | Note |
|---|---|---|
| Frontend | Next.js (App Router) + Tailwind CSS | as preferred |
| Backend | Node.js + Express | as preferred |
| Database | MongoDB Atlas | as preferred |
| Language | TypeScript | zod schemas double as kit types |
| Scraping | undici + cheerio + robots-parser | no browser engine needed |
| LLM | Google Gemini `gemini-2.5-flash` | free tier, native `responseSchema` |
| Search | Gemini `google_search` grounding, DuckDuckGo HTML fallback | no second API key |

### Why not LangGraph

The pipeline is a mostly-linear sequence of named steps with exactly one loop
(coverage check → fill gaps → recheck). Two of its steps must be deterministic
code rather than model calls. A state-graph framework adds channel and
checkpointer concepts that buy nothing here, costs unfamiliar-framework
debugging time on a one-day clock, and makes the sequencing *harder* for a
reviewer to read. An explicit step runner over pure functions gives the same
structure in about eighty lines, with per-step timing and failure isolation.

### Why Express on its own host rather than Next route handlers

Generation takes sixty to a hundred and twenty seconds. Serverless function
timeouts would force the pipeline into chunked invocations — an architecture
with no time budget today. A long-lived Node process on Render has no request
cap and can run the job in-process while the client polls.

## 3. Repository layout

```
interview-prep-kit/
  apps/
    web/                 Next.js + Tailwind
    api/                 Express: auth, kits, jobs
  packages/
    core/                the pipeline — the only place generation logic lives
      src/
        llm/             Gemini client, rate limiter, retry, JSON repair
        fetch/           robots, url guard, fetcher, html cleaner
        steps/           one file per pipeline step
        pipeline.ts      the step runner
        schema/          zod schemas for Appendix A and Appendix B
        schedule/        deterministic allocator
        coverage/        deterministic coverage check
  scripts/
    evaluate.ts          batch entry point, imports packages/core
  docs/
```

npm workspaces. `apps/api` and `scripts/evaluate.ts` both import
`packages/core` — the batch command runs the same code as the application, not
a parallel implementation.

## 4. Pipeline

Each step is a function with a declared input and output, individually
testable, and individually able to fail without killing the run. The runner
records `{ step, status, ms, warning? }` into the kit document as it goes, so
progress is observable in the UI and the sequencing is visible in the logs.

| # | Step | Model? | Responsibility |
|---|---|---|---|
| 1 | `extractRequirements` | yes | JD text → requirements with stable ids `r1..rN`, `kind`, `priority` |
| 2 | `discoverPages` | no | fetch root, parse links, score and rank candidates |
| 3 | `fetchAndClean` | no | one URL → clean text, capped |
| 4 | `findHiringProcess` | yes | read best hiring candidates → hiring signals |
| 5 | `searchPublicDiscussion` | yes | grounded search → public account of their process + sources |
| 6 | `buildCompanyBrief` | yes | pages → `summary`, `what_they_do`, `sources` |
| 7 | `generateQuestions` | yes | one call per category, conditioned on hiring signals |
| 8 | `checkCoverage` | **no** | set difference: requirement ids without a question |
| 9 | `fillGaps` | yes | questions for uncovered requirements, then back to step 8 |
| 10 | `allocateSchedule` | **no** | arithmetic: distribute topics across exactly `days` |
| 11 | `validateKit` | no | zod against Appendix A; reject before persisting |

### Genuine sequencing

Pasted text needs no retrieval, so extraction runs first and alone. The
company homepage is useless until crawled, so discovery precedes any use of it.
Hiring signals found in step 4 or 5 are inputs to step 7 — a company that
publishes a take-home followed by a system design round produces different
questions from one that publishes nothing. Question categories are separate
calls because a "five years with React" requirement and a "mentoring juniors"
requirement should not be answered by the same call with the same instructions.

### Link ranking (step 2)

No hard-coded path list. Fetch the root, collect same-origin links, and score
each on: keyword hits in the URL slug and anchor text (`careers`, `jobs`,
`hiring`, `interview`, `process`, `handbook`, `engineering`, `about`, `culture`,
`life-at`, `join`), path depth, and whether the anchor sits in a nav or footer.
Take the top N by score, fetch them, and optionally follow one level deeper from
a careers page. Respect `robots.txt` throughout. Every URL actually fetched is
recorded in `source.pages_used`.

### Coverage passes

Two passes maximum. Pass one drafts the bank; the deterministic check finds
must-have requirements with no question against them; pass two generates
questions for exactly those gaps and the check runs again. A third pass is not
worth the tokens: if a requirement is still uncovered after a targeted call
naming it directly, the requirement is usually degenerate text rather than a
generation failure, and the honest move is to record it in
`coverage.uncovered_requirement_ids` rather than spend more of a rate-limited
budget. `coverage.passes` reports the real number of passes run.

### Schedule allocation

Deterministic, in code. Sort topics by priority (`must` before `nice`) then by
difficulty descending, so harder and higher-priority material lands earlier.
Distribute across exactly `days_available` days — `days` array length equals
the number requested, no more and no fewer. Every must-have requirement appears
in at least one day. Minutes are integers, computed by dividing a per-day
budget across that day's items with the remainder given to the first item.
Edge cases: one day means everything on day one; sixty days means light days
rather than invented material, with an explicit note in the day focus.

## 5. Kit state: generated, edited and pinned

The hardest requirement in the brief. Regenerating one section must not discard
edits made elsewhere, and a hand-written or hand-edited question must survive a
regeneration of its own category.

Every editable item — question, flashcard, brief field, schedule day — carries:

```
origin:  "generated" | "edited" | "manual"
pinned:  boolean
rev:     number
```

Rules:

1. Regenerating a section replaces **only** items where
   `origin === "generated"` and `pinned === false`.
2. Items with `origin` of `edited` or `manual`, and any pinned item, are kept
   and passed *into* the regeneration prompt as already-covered material, so
   the new questions do not duplicate them.
3. Editing a generated item flips its origin to `edited`, which makes it
   immune to future regenerations of its section. This is the intended
   meaning of an edit: the user has taken ownership of that item.
4. Pinning exists for the case where the user wants to keep a generated item
   they have *not* edited.

Section state is tracked per section rather than per kit:

```
sections: {
  company_brief:      { status, rev, updated_at },
  questions_technical:{ status, rev, updated_at },
  ... one per category ...
  schedule:           { status, rev, updated_at }
}
```

so one section can be `regenerating` while the rest of the kit stays readable
and editable. A regeneration writes into a staging field and swaps atomically
on success, so a failed regeneration leaves the previous content intact.

## 6. Generation as a job

`POST /api/kits` validates the input, writes a kit document with
`status: "queued"`, and returns its id immediately. An in-process runner
executes the pipeline and updates `progress` after each step. The client polls
`GET /api/kits/:id`.

This answers the three failure modes the brief names:

- **Ninety seconds** — the request never blocks; the UI shows the step list
  advancing.
- **Fails halfway** — the kit persists with `status: "partial"`, whatever
  sections completed, and a `warnings[]` array naming each skipped source and
  why. It is readable and resumable, not lost.
- **Triggered twice** — a dedupe key of `hash(userId + jd + company_url)`
  returns the existing job rather than starting a second one.

## 7. Failure handling

| Case | Behaviour |
|---|---|
| Company URL invalid, 404, timeout | Record the source as unreachable, continue with the JD alone; brief says so honestly |
| No hiring or about page found | `company_brief` states that nothing was published; questions fall back to JD-derived only |
| Two-line JD | Few requirements extracted, thin kit, and the brief says the description was thin. Nothing invented |
| Public discussion finds nothing | Recorded as not found. No fabricated sources |
| Model returns invalid JSON | One repair attempt with the parse error fed back, then the step fails into a warning |
| Rate limited | Token-bucket limiter plus exponential backoff with jitter, honouring `retry-delay`, three attempts |
| Duplicate submission | Dedupe key returns the existing kit |
| 1-day or 60-day schedule | Allocator handles both; day count always equals the request |

The governing rule: inventing a requirement a description does not contain is
worse than reporting that there were few.

## 8. Security

- **URL validation before fetch.** Scheme must be http or https. Resolve the
  hostname and reject private, loopback, link-local and reserved ranges when
  `NODE_ENV === "production"`. Local addresses stay permitted outside
  production because the batch command is tested against `http://localhost:8099`.
- **Content restrictions.** Accept only HTML and plain text. Cap response size
  and request timeout. Cap redirects.
- **Untrusted text.** The pasted JD and every fetched page are wrapped in
  delimiters and introduced to the model as untrusted data that must never be
  followed as instructions. The cleaner strips script, style, nav and comment
  nodes before the text is ever seen.
- **Auth.** Email and password with bcrypt, JWT in an httpOnly, secure,
  sameSite cookie. Every kit route scopes its query by the authenticated user
  id, so a kit belonging to someone else is a 404 rather than a 403. Expired
  or invalid tokens clear the cookie and redirect to login. No email
  verification, no password reset, no roles — explicitly out of scope.

## 9. Frontend

- **Create** — textarea for the JD, field for the company URL, number of days,
  and a file upload for a batch of description-and-company pairs.
- **Progress** — the step list with per-step state, plus the warnings as they
  arrive. Clear empty, loading and error states throughout.
- **Reader** — company brief, role breakdown, question bank by category,
  flashcards, schedule.
- **Builder** — inline editing, drag reorder within and across categories, add
  and delete, per-section regenerate. Edits apply optimistically to local state
  and PATCH the single item; no round-trip per keystroke.
- **Practice** — one flashcard at a time, reveal, record confidence of 1 to 3,
  a covered/not-covered indicator, and the next session ordered by lowest
  confidence first with least-recently-seen breaking ties. A confidence-weighted
  sort rather than a full spaced-repetition schedule: the user has days, not
  months, so an interval algorithm tuned for long-term retention would defer
  cards they need before the interview.

Responsive from phone to laptop, keyboard navigable, visible focus states.

## 10. Batch entry point

`npm run evaluate -- --input cases.json --output kits.json`

Reads an array of `{ id, jd, company_url, days }`. Calls the same
`runPipeline()` the API calls. Concurrency of two, which keeps five cases well
inside fifteen minutes while leaving rate-limit headroom. Each case is wrapped
so a failure records `status: "failed"` with an error code and the run
continues. Writes the Appendix B envelope with one entry per input case.
`failed` is reserved for cases where no kit could be produced at all; a case
that was only partially researched is `ok` with the gaps recorded in the kit.
Credentials come from environment variables documented in `.env.example`, and
the command runs from a clean clone after `npm install`.

## 11. Tests

Automated tests for the three behaviours the brief names:

- **Schedule allocation** — day count equals the request for 1, 5 and 60 days;
  every must-have appears; minutes are integers; harder material lands earlier;
  every `question_ids` entry refers to a question that exists.
- **Coverage checking** — a requirement with no question is reported; a covered
  one is not; the second pass closes a gap; `passes` reflects reality.
- **Structure validation** — a conforming kit passes; missing fields, float
  minutes, out-of-range difficulty, and dangling id references are rejected.

## 12. Deployment

Frontend on Vercel, API as a Render web service, MongoDB Atlas. Both reachable
publicly. Render's free tier sleeps when idle, so the first request after a
quiet period is slow — noted in the README. Every environment variable is
listed in `.env.example` with a line describing its purpose. No secret is
committed.

## 13. Scope not taken

The optional creative feature is not built. It is explicitly not required, and
the time is better spent on the builder and interaction design, which carry
twenty-five of the forty-five human-review points between them. The README
records the decision.

## 14. Build order

Ordered so that a partial build still scores. The fifty-five automated points
depend only on the pipeline and the batch command, so both are finished before
any interface work begins.

1. Monorepo, Mongo, auth, kit model, Appendix A validator, the three test suites
2. `packages/core` pipeline end to end, batch command working
3. Express API, job runner, progress polling
4. Next.js interface: create, progress, reader, builder, practice
5. Deploy, `.env.example`, README, walkthrough video
