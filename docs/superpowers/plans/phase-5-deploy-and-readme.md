# Phase 5 — Deployment, README and Submission Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Get the application publicly reachable with both halves live, prove the mandatory batch command works from a clean clone, document every environment variable and every design decision the brief asks about, and record the walkthrough. This is the phase where the work becomes a submission.

**Architecture:** Frontend on Vercel, API as a long-lived Render web service, MongoDB Atlas free tier. Nothing is proxied — the browser calls the API directly with credentials, so the CORS origin and the cookie attributes have to agree, and they are the most likely thing to be wrong on first deploy.

**Tech Stack:** Vercel, Render, MongoDB Atlas, all free tiers.

**Spec:** `docs/superpowers/specs/2026-09-08-interview-prep-kit-design.md`

**Depends on:** Phases 1–4 complete, `npx vitest run` green, `npm run typecheck` clean.

## Global Constraints

- No secret is committed. `.env` stays gitignored; `.env.example` carries names and comments only.
- Cross-origin cookies require `secure: true` and `sameSite: 'none'` in production. Phase 1 Task 12 already keys this off `NODE_ENV` — verify it, do not re-implement it.
- The batch command must run from a clean clone with one documented install step and nothing else.
- Every environment variable appears in `.env.example` with a comment saying what it is for, and again in the README.
- The README must contain every section the brief lists. Missing one is a lost point regardless of how good the code is.
- Free tiers: Render sleeps when idle, Atlas has a connection cap, Gemini limits tokens per minute. Each is a documented limitation, not a surprise.
- Do not commit — present each commit message to the user.

## File Structure

```
interview-prep-kit/
  README.md                      the submission document
  .env.example                   every variable, commented
  cases.example.json             already added in Phase 1
  render.yaml                    optional, but makes the API deploy reproducible
  apps/
    api/src/server.ts            add production hardening
    web/.env.local.example
  docs/
    walkthrough-script.md         the video script, kept out of the README
```

---

## Task 1: Production hardening and the deployment surface

Small, targeted changes the deploy needs. Nothing speculative.

**Files:**
- Modify: `apps/api/src/server.ts`
- Modify: `apps/api/src/env.ts`
- Modify: `apps/api/package.json`
- Create: `render.yaml`
- Test: `apps/api/test/hardening.test.ts`

**Interfaces:**
- Consumes: `env`, `isProduction`, `createServer`.
- Produces:
  - `createServer()` additionally: `app.set('trust proxy', 1)`, a multi-origin CORS allowlist, and a rate limit on the two auth routes
  - `env.WEB_ORIGIN` accepts a comma-separated list, so a Vercel preview URL can be allowed alongside production
  - `parseOrigins(value: string): string[]`
  - `GET /api/health` reports database connectivity, not just process liveness

Why each one:

- **`trust proxy`** — Render terminates TLS at its edge. Without this, Express thinks the connection is plain HTTP and refuses to set a `secure` cookie, which presents as "login appears to work but the session never sticks". This is the single most likely deploy failure.
- **Origin list** — one string cannot cover production and a preview deployment, and hard-coding a single origin means every preview is broken.
- **Auth rate limit** — the login endpoint is the one unauthenticated write in the application. A small limit is proportionate; anything more elaborate is out of scope.
- **Health check with database state** — a health check that returns 200 while Mongo is unreachable tells you nothing.

- [ ] **Step 1: Write the failing test**

`apps/api/test/hardening.test.ts`:

```ts
import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { parseOrigins } from '../src/env.js'
import { createServer } from '../src/server.js'

describe('parseOrigins', () => {
  it('reads a single origin', () => {
    expect(parseOrigins('https://app.test')).toEqual(['https://app.test'])
  })

  it('reads a comma-separated list and trims it', () => {
    expect(parseOrigins('https://a.test, https://b.test')).toEqual(['https://a.test', 'https://b.test'])
  })

  it('drops empty entries and a trailing slash', () => {
    expect(parseOrigins('https://a.test/,,  ')).toEqual(['https://a.test'])
  })

  it('returns an empty list for an empty value', () => {
    expect(parseOrigins('')).toEqual([])
  })
})

describe('hardening', () => {
  const app = createServer()

  it('trusts the proxy, so a secure cookie can be set behind Render’s edge', () => {
    expect(app.get('trust proxy')).toBe(1)
  })

  it('reports database state on the health check rather than only process liveness', async () => {
    const response = await request(app).get('/api/health')
    expect(response.status).toBe(200)
    expect(response.body).toHaveProperty('database')
  })

  it('rejects a request from an origin that is not allowed', async () => {
    const response = await request(app).get('/api/health').set('Origin', 'https://not-allowed.test')
    // The health check still answers; what must not appear is permission for
    // that origin to read the response.
    expect(response.headers['access-control-allow-origin']).toBeUndefined()
  })

  it('allows a configured origin with credentials', async () => {
    process.env.WEB_ORIGIN = 'http://localhost:3000'
    const fresh = createServer()
    const response = await request(fresh).get('/api/health').set('Origin', 'http://localhost:3000')
    expect(response.headers['access-control-allow-origin']).toBe('http://localhost:3000')
    expect(response.headers['access-control-allow-credentials']).toBe('true')
  })

  it('rate limits repeated login attempts', async () => {
    const fresh = createServer()
    const attempts = []
    for (let i = 0; i < 12; i += 1) {
      attempts.push(await request(fresh).post('/api/auth/login').send({ email: 'a@b.test', password: 'wrong password here' }))
    }
    expect(attempts.some((response) => response.status === 429)).toBe(true)
  })

  it('does not rate limit ordinary reads', async () => {
    const fresh = createServer()
    for (let i = 0; i < 15; i += 1) {
      const response = await request(fresh).get('/api/health')
      expect(response.status).toBe(200)
    }
  })
})
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run apps/api/test/hardening.test.ts`
Expected: FAIL — `parseOrigins` does not exist and `trust proxy` is unset.

- [ ] **Step 3: Add `parseOrigins` to `env.ts`**

Append to `apps/api/src/env.ts`:

```ts
/**
 * A single origin cannot cover production and a preview deployment, so this
 * accepts a comma-separated list. Trailing slashes are stripped because the
 * Origin header never carries one and a mismatch is invisible in logs.
 */
export function parseOrigins(value: string): string[] {
  return value
    .split(',')
    .map((origin) => origin.trim().replace(/\/+$/, ''))
    .filter((origin) => origin.length > 0)
}

export const allowedOrigins = parseOrigins(env.WEB_ORIGIN)
```

- [ ] **Step 4: Harden the server**

Add the dependency:

```bash
npm install express-rate-limit -w @ipk/api
```

Rewrite `apps/api/src/server.ts`:

```ts
import cookieParser from 'cookie-parser'
import cors from 'cors'
import express from 'express'
import rateLimit from 'express-rate-limit'
import mongoose from 'mongoose'
import { connectDb } from './db.js'
import { env, isProduction, parseOrigins } from './env.js'
import { errorHandler, notFound } from './middleware/errors.js'
import { authRouter } from './routes/auth.js'
import { itemsRouter } from './routes/items.js'
import { kitsRouter } from './routes/kits.js'
import { practiceRouter } from './routes/practice.js'
import { regenerateRouter } from './routes/regenerate.js'

export function createServer(): express.Express {
  const app = express()

  // Render terminates TLS at its edge. Without this Express sees a plain HTTP
  // connection and silently refuses to set a `secure` cookie, which looks
  // exactly like "login works but the session never sticks".
  app.set('trust proxy', 1)

  const allowed = parseOrigins(env.WEB_ORIGIN)
  app.use(
    cors({
      credentials: true,
      origin(origin, callback) {
        // No Origin header means a same-origin or non-browser caller, such as
        // the batch command or a health probe.
        if (!origin) return callback(null, true)
        callback(null, allowed.includes(origin.replace(/\/+$/, '')))
      },
    }),
  )

  app.use(express.json({ limit: '1mb' }))
  app.use(cookieParser())

  app.get('/api/health', (_req, res) => {
    // 1 is "connected" in mongoose's readyState. A health check that returns
    // 200 while the database is unreachable is worse than none.
    const states = ['disconnected', 'connected', 'connecting', 'disconnecting'] as const
    res.json({ ok: true, database: states[mongoose.connection.readyState] ?? 'unknown' })
  })

  // The only unauthenticated writes in the application.
  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: { code: 'TOO_MANY_ATTEMPTS', message: 'too many attempts — wait a few minutes and try again' } },
  })
  app.use('/api/auth/login', authLimiter)
  app.use('/api/auth/register', authLimiter)

  app.use('/api/auth', authRouter)
  app.use('/api/kits', kitsRouter)
  app.use('/api/kits', itemsRouter)
  app.use('/api/kits', regenerateRouter)
  app.use('/api/kits', practiceRouter)

  app.use(notFound)
  app.use(errorHandler)
  return app
}

if (process.argv[1]?.includes('server')) {
  const app = createServer()
  connectDb(env.MONGODB_URI)
    .then(() => {
      app.listen(env.PORT, () => {
        console.log(`api listening on ${env.PORT} (${isProduction ? 'production' : env.NODE_ENV})`)
        console.log(`allowed origins: ${parseOrigins(env.WEB_ORIGIN).join(', ') || '(none configured)'}`)
      })
    })
    .catch((error) => {
      console.error('failed to start:', error)
      process.exit(1)
    })
}
```

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `npx vitest run apps/api`
Expected: PASS. If the rate-limit test interferes with `auth.test.ts`, give
each test file its own `createServer()` instance — the limiter's store is
per-instance, which is why the hardening test builds fresh servers.

- [ ] **Step 6: Add the Render blueprint**

`render.yaml` — not required by Render, but it makes the API deployment
reproducible and documents the build for a reader:

```yaml
services:
  - type: web
    name: ipk-api
    runtime: node
    plan: free
    region: frankfurt
    buildCommand: npm install
    startCommand: npm run start -w @ipk/api
    healthCheckPath: /api/health
    envVars:
      - key: NODE_ENV
        value: production
      - key: MONGODB_URI
        sync: false
      - key: JWT_SECRET
        sync: false
      - key: GEMINI_API_KEY
        sync: false
      - key: WEB_ORIGIN
        sync: false
```

`sync: false` means Render prompts for the value rather than storing it in the
repository. No secret is committed.

- [ ] **Step 7: Commit** — *present this message to the user; do not run it*

```
feat(api): trust proxy, allowlist origins, rate limit auth and report db health
```

---

## Task 2: Environment documentation

Every variable, in one place, with a sentence saying what it is for. The brief
asks for this explicitly and it takes ten minutes.

**Files:**
- Modify: `.env.example`
- Modify: `apps/web/.env.local.example`

- [ ] **Step 1: Write the complete `.env.example`**

Replace the file with the full set. Every line has a comment; no line has a
value that is a real secret.

```
# ---------------------------------------------------------------------------
# Copy to .env and fill in. Nothing here is committed — .env is gitignored.
# ---------------------------------------------------------------------------

# --- Model provider -------------------------------------------------------
# Google AI Studio key for Gemini. Free, no card: aistudio.google.com/apikey
# Used by every generation step, always through packages/core/src/llm/client.ts
GEMINI_API_KEY=

# Model id for every generation step. gemini-2.5-flash is the free-tier
# default and supports the JSON response schema the kit structure relies on.
GEMINI_MODEL=gemini-2.5-flash

# --- API ------------------------------------------------------------------
# Port the Express server listens on. Render sets this itself; locally 4000.
PORT=4000

# MongoDB connection string. Atlas free tier gives one for nothing:
# mongodb+srv://<user>:<password>@<cluster>.mongodb.net/ipk
MONGODB_URI=mongodb://127.0.0.1:27017/ipk

# Secret used to sign the session cookie. Generate with:
#   openssl rand -hex 32
# Changing it signs every existing session out, which is the intended effect.
JWT_SECRET=

# Origins allowed to call the API with credentials. Comma-separated, so a
# Vercel preview deployment can be allowed alongside production. No trailing
# slash — the browser never sends one and the mismatch is invisible in logs.
#   e.g. https://interview-prep-kit.vercel.app,https://ipk-git-main.vercel.app
WEB_ORIGIN=http://localhost:3000

# production turns on secure, sameSite=none cookies and blocks fetching
# private and loopback addresses. Anything else leaves local addresses
# reachable, which the batch command needs.
NODE_ENV=development
```

- [ ] **Step 2: Write `apps/web/.env.local.example`**

```
# Copy to apps/web/.env.local

# Public base URL of the Express API. No trailing slash. This is the only
# variable the browser sees, which is why it carries no secret.
#   local:      http://localhost:4000
# production: https://ipk-api.onrender.com
NEXT_PUBLIC_API_URL=http://localhost:4000
```

- [ ] **Step 3: Verify nothing is committed**

```bash
git status --short
git check-ignore -v .env apps/web/.env.local
grep -rn "AIza\|mongodb+srv://[^<]" --include="*.ts" --include="*.tsx" --include="*.json" --include="*.md" . | grep -v node_modules
```

Expected: `.env` and `.env.local` both reported as ignored, and the grep
returns nothing but placeholder text. If it finds a real key, rotate that key
before doing anything else — a key that has been committed is a key that has
leaked, whether or not the commit was pushed.

- [ ] **Step 4: Commit** — *present this message to the user; do not run it*

```
docs: document every environment variable with its purpose
```

---

## Task 3: Deploy

Order matters: database, then API, then frontend, then come back and fix the
API's origin now that the frontend has a URL. That last step is the one people
forget.

- [ ] **Step 1: MongoDB Atlas**

1. Create a free M0 cluster.
2. Add a database user with a generated password.
3. Network access: allow `0.0.0.0/0`. Render's free tier has no static egress address, so an allowlist cannot be narrowed. Note this in the README's limitations — it is a real trade-off, not an oversight.
4. Copy the connection string and append the database name: `.../ipk?retryWrites=true&w=majority`.

- [ ] **Step 2: Render — the API**

1. New Web Service from the repository, or Blueprint from `render.yaml`.
2. Root directory: the repository root. This is a workspace install; do not set it to `apps/api`.
3. Build command: `npm install`. Start command: `npm run start -w @ipk/api`.
4. Environment variables: `NODE_ENV=production`, `MONGODB_URI`, `JWT_SECRET`, `GEMINI_API_KEY`, and `WEB_ORIGIN` set to a placeholder for now.
5. Health check path: `/api/health`.
6. Deploy, then confirm:

```bash
curl -s https://<your-api>.onrender.com/api/health
```

Expected: `{"ok":true,"database":"connected"}`. If `database` says
`disconnected`, the connection string or the network allowlist is wrong — fix
that before going further, because every other symptom downstream will be
misleading.

- [ ] **Step 3: Vercel — the frontend**

1. Import the repository.
2. Root directory: `apps/web`.
3. Framework preset: Next.js. Leave the build command alone.
4. Environment variable: `NEXT_PUBLIC_API_URL=https://<your-api>.onrender.com`.
5. Deploy and note the production URL.

- [ ] **Step 4: Close the loop — the step that is always forgotten**

Set Render's `WEB_ORIGIN` to the Vercel production URL, with no trailing slash,
and redeploy the API. Until this is done, registration will appear to work and
the session will never stick, because the browser will refuse a cookie from an
origin the API has not allowed.

If you want previews to work too, add them comma-separated.

- [ ] **Step 5: Verify the deployed application end to end**

Against the public URLs, not localhost:

1. Register — a session cookie is set and survives a reload. In devtools the cookie shows `Secure`, `HttpOnly`, `SameSite=None`.
2. Sign out, then attempt `/kits` — bounced to login.
3. Create a kit from a real posting and a real company URL. Watch the steps advance.
4. Confirm the kit is valid: requirements present, questions reference requirement ids, schedule day count matches the days requested.
5. Try a company URL that 404s — a warning, not a failure.
6. Try a two-line description — a thin kit that says so.
7. Edit a question, regenerate its category, confirm the edit survived.
8. Run a practice session, reload, confirm the ratings persisted.
9. Leave it fifteen minutes so Render sleeps, then load again — slow first request, then normal. This is the cold start to mention in the README and the video.
10. Open the frontend on a phone.

- [ ] **Step 6: Prove the batch command from a clean clone**

This is the mandatory entry point and it is tested against postings you have
not seen, so it has to work from nothing:

```bash
cd $(mktemp -d)
git clone <repository-url> ipk && cd ipk
npm install
cp .env.example .env
# put a real GEMINI_API_KEY in .env; MONGODB_URI is not needed for the batch
time npm run evaluate -- --input cases.example.json --output kits.json
node -e "const o=require('./kits.json');console.log(o.version, o.kits.length, o.kits.map(k=>k.id+':'+k.status).join(' '))"
```

Expected: both cases reported, `kits.json` written in the Appendix B shape, and
the whole run comfortably inside three minutes for two cases — which puts five
cases inside the fifteen-minute limit.

Then build a five-case file and time it for real:

```bash
node -e "const c=require('./cases.example.json');require('fs').writeFileSync('five.json',JSON.stringify([...c,...c,c[0]].map((x,i)=>({...x,id:'case-0'+(i+1)})),null,2))"
time npm run evaluate -- --input five.json --output five-kits.json
```

If it exceeds fifteen minutes, raise `--concurrency 3` and re-time it. If rate
limiting starts biting instead, lower it to 1 and reduce the page budget in
`discoverPages`. Record the number you actually measured in the README.

- [ ] **Step 7: Commit** — *present this message to the user; do not run it*

```
chore: add render blueprint for reproducible api deployment
```

---

## Task 4: The README

The brief lists the required sections. This is the document the human reviewer
reads before they read any code, and ten of the forty-five human-review points
cover code quality *and the reasoning in the README* together.

**Files:**
- Create: `README.md`

- [ ] **Step 1: Write it**

Every section below is required by the brief. Fill the bracketed values with
what you actually measured — do not leave a single placeholder.

````markdown
# The AI Interview Prep Kit

Paste a job description, give a company's website address, say how many days
you have — and get a preparation kit you can reshape and practise against: a
company brief, a role breakdown, a categorised question bank, flashcards and a
day-by-day study schedule.

**Live:** [frontend](https://…vercel.app) · [API health](https://…onrender.com/api/health)
**Walkthrough:** [3–4 minute video](https://…)

> The API runs on Render's free tier, which sleeps when idle. The first request
> after a quiet spell takes around thirty seconds; everything after it is
> normal.

## Contents

- [What it does](#what-it-does)
- [Tech stack](#tech-stack)
- [Setup](#setup)
- [The batch entry point](#the-batch-entry-point)
- [Environment variables](#environment-variables)
- [Architecture](#architecture)
- [The pipeline, step by step](#the-pipeline-step-by-step)
- [Retrieval approach](#retrieval-approach)
- [Deterministic by design](#deterministic-by-design)
- [The second pass](#the-second-pass)
- [Generated, edited and pinned state](#generated-edited-and-pinned-state)
- [Schedule allocation](#schedule-allocation)
- [Practice ordering](#practice-ordering)
- [Failure handling](#failure-handling)
- [Security](#security)
- [Tests](#tests)
- [Design decisions and trade-offs](#design-decisions-and-trade-offs)
- [Known limitations](#known-limitations)

## What it does

1. You paste a job description and give a company website address.
2. It extracts the role's requirements, each with a stable id and marked
   **must** or **nice** according to how the posting words it.
3. It crawls the company site, ranks the links, and fetches what looks like a
   careers, hiring or about page — no fixed list of paths.
4. It searches for public accounts of how that company interviews.
5. It writes a company brief, then a question bank one category at a time,
   informed by whatever the research actually found.
6. It checks in code that every requirement has a question against it,
   generates questions for the gaps, and checks again.
7. It allocates the material across exactly the number of days you have.
8. You edit, reorder, add, delete and regenerate any part of it — and practise
   against the flashcards.

## Tech stack

| Layer | Choice | Why |
|---|---|---|
| Frontend | Next.js 15 (App Router) + Tailwind | the preferred stack |
| Backend | Node.js + Express | the preferred stack |
| Database | MongoDB Atlas (Mongoose) | the preferred stack |
| Language | TypeScript | zod schemas double as the kit's types |
| Retrieval | undici + cheerio + robots-parser | no browser engine needed for server-rendered marketing pages |
| Model | Google Gemini `gemini-2.5-flash` | genuine free tier, and a native JSON response schema, which matters when the output shape is graded field by field |
| Search | Gemini's `google_search` grounding | returns sources alongside the answer, so cited URLs are ones that exist — and no second API key |
| Tests | Vitest | one runner across the workspaces |

Nothing was swapped from the preferred stack. The two additions worth
explaining are the model choice and the deliberate absence of an orchestration
framework — see [Design decisions](#design-decisions-and-trade-offs).

## Setup

Requires Node 20 or later.

```bash
git clone <repository-url> && cd interview-prep-kit
npm install

cp .env.example .env                       # add GEMINI_API_KEY and JWT_SECRET
cp apps/web/.env.local.example apps/web/.env.local

npm run dev:api                            # http://localhost:4000
npm run dev:web                            # http://localhost:3000
```

MongoDB: either a local `mongod` or an Atlas connection string in
`MONGODB_URI`. The batch command needs no database at all.

```bash
npm test              # every test
npm run typecheck     # core + api
```

## The batch entry point

```bash
npm run evaluate -- --input cases.json --output kits.json
```

Reads an array of `{ id, jd, company_url, days }` and writes the Appendix B
envelope. Optional `--concurrency <n>`, default 2.

```bash
npm run evaluate -- --input cases.example.json --output kits.json
```

- Runs the **same** `runPipeline()` the application uses — `scripts/evaluate.ts`
  is argument parsing and file IO, nothing else.
- Uses each case's own `days` value when allocating its schedule.
- Continues after a failing case, recording the failure rather than aborting.
- Concurrency 2. One at a time can miss the fifteen-minute limit when a retry
  fires; four at once is the fastest way to be rate-limited. Measured:
  **[N] cases in [M]** on a free-tier key.
- `failed` is reserved for a case that produced no kit at all. A case that
  could only be partially researched is `ok`, with the gaps recorded honestly
  inside the kit.
- Retrieval assumes no particular host and follows relative links, so company
  sites served from `http://localhost:8099` work.

## Environment variables

| Variable | Used by | Purpose |
|---|---|---|
| `GEMINI_API_KEY` | core | Google AI Studio key. Every model call. |
| `GEMINI_MODEL` | core | Model id, default `gemini-2.5-flash`. |
| `PORT` | api | Listen port. Render sets this. |
| `MONGODB_URI` | api | Connection string. Not needed for the batch command. |
| `JWT_SECRET` | api | Signs the session cookie. `openssl rand -hex 32`. |
| `WEB_ORIGIN` | api | Comma-separated origins allowed to call with credentials. |
| `NODE_ENV` | api, core | `production` enables secure cookies and blocks private-address fetching. |
| `NEXT_PUBLIC_API_URL` | web | Public base URL of the API. The only variable the browser sees. |

`.env.example` carries the same list with fuller comments. No secret is
committed; `.env` is gitignored.

## Architecture

```
packages/core         the pipeline — the single source of truth
  schema/             zod schemas for Appendix A and Appendix B
  fetch/              url guard, robots, capped fetcher, cleaner, link ranking
  llm/                Gemini client: token bucket, retries, JSON repair
  steps/              one file per pipeline step
  coverage/           deterministic coverage check
  schedule/           deterministic allocator
  state/              the generated / edited / pinned merge rules
  pipeline/           step runner, orchestration, batch runner

apps/api              Express: auth, kits, background jobs, builder endpoints
apps/web              Next.js: create, progress, reader, builder, practice
scripts/evaluate.ts   the mandatory batch command
```

`apps/api` and `scripts/evaluate.ts` both import `packages/core`. There is one
implementation of generation, not two.

**Generation is a job, not a request.** `POST /api/kits` validates, writes a
document with `status: 'queued'`, and returns an id immediately. An in-process
runner executes the pipeline and writes progress after each step; the client
polls. That answers the three hard cases directly:

- **It takes ninety seconds** — the request never blocks; the interface shows
  the real step list advancing.
- **It fails halfway** — the kit persists as `partial` with whatever completed
  and a `warnings[]` array naming each skipped source. It is readable and
  reopenable, not lost.
- **It is triggered twice** — the dedupe key is
  `sha256(userId + jd + companyUrl)` with a unique index, so the second
  submission joins the first job instead of starting another.

A queue service would be the right answer at scale. For one Render web service
with no request timeout, it would be machinery with no reader.

## The pipeline, step by step

| # | Step | Model? | Responsible for |
|---|---|---|---|
| 1 | `extractRequirements` | yes | JD → requirements with ids `r1..rN`, kind, must/nice |
| 2 | `discoverPages` | no | fetch root, rank links, fetch the best |
| 3 | `fetchAndClean` | no | one URL → clean text, capped |
| 4 | `findHiringProcess` | yes | hiring pages → the stages they describe |
| 5 | `searchPublicDiscussion` | yes | grounded search → public account + real sources |
| 6 | `buildCompanyBrief` | yes | pages → summary, what they do, sources |
| 7 | `generateQuestions` | yes | **one call per category** |
| 8 | `checkCoverage` | **no** | set difference over requirement ids |
| 9 | `fillGaps` | yes | questions for exactly the uncovered requirements |
| 10 | `allocateSchedule` | **no** | arithmetic over the final question set |
| 11 | `validateKit` | no | zod against Appendix A before anything is stored |

**Why this order, and why it is not one prompt.** Pasted text needs no
retrieval, so extraction runs first and alone. A homepage is useless until
crawled, so discovery precedes anything that reads it. Hiring signals found in
steps 4 and 5 are *inputs* to step 7 — a company that publishes a take-home
followed by a system design round produces a different kit from one that
publishes nothing. Question categories are separate calls because "five years
with React" and "mentoring junior engineers" should not be answered by the same
call with the same instructions. And the schedule is allocated last, because it
can only be allocated over a question set that is finished.

Every step is timed, its failure is isolated into a warning, and its state is
written to the kit document — which is why the progress panel shows the real
sequence rather than a decorative bar.

## Retrieval approach

Companies bury hiring information in unpredictable places, so there is no fixed
path list. The crawler:

1. Fetches the root and collects same-origin links.
2. Scores each one: keyword hits in the URL slug are worth more than hits in
   anchor text, because the slug is chosen by the site author; hiring keywords
   outscore about-us keywords; shallower paths score higher; navigation and
   footer placement adds a small bonus.
3. Fetches the highest-scoring links up to a budget of six pages.
4. Follows one level deeper, once, and only from a page classified as hiring —
   because the process description usually sits a click below the careers
   index.

`robots.txt` is fetched and cached per origin and respected throughout; a
missing or unreadable `robots.txt` is treated as permission granted, which is
the conventional reading. Requests carry an identifying user agent, are capped
at 1.5 MB and 8 seconds, accept only HTML and plain text, and follow at most
three redirects.

**Sources used:** the company's own site, and public discussion found through
Gemini's search grounding, which returns the URLs it used so the kit cites
pages that exist. Every URL actually fetched is recorded in
`source.pages_used`, and the brief cites only what it read.

## Deterministic by design

Two decisions are the application's, not the model's, because both are
checkable and neither is a judgement call:

- **Coverage** is a set difference between requirement ids and the requirement
  ids referenced by questions. "Is this requirement covered" has to be a fact,
  not an opinion.
- **Schedule allocation** is arithmetic: sort by priority then difficulty,
  deal across exactly the days requested, integer minutes.

Both are pure functions with their own test suites. A third is close to it:
`thin` — whether a description was too sparse to build much from — is computed
from the character count and the requirement count rather than asked of the
model, because the kit's honesty about itself should not depend on the model's
mood.

## The second pass

After the first draft, `checkCoverage` reports every requirement with no
question against it. `fillGaps` then generates questions for exactly those
requirements, naming them directly, and the check runs again.

**Two passes maximum, and here is why.** If a requirement is still uncovered
after a targeted call that named it explicitly, the requirement is usually
degenerate text rather than a generation failure — a line like "excellent
communication skills" that a question cannot meaningfully attach to. A third
pass spends a rate-limited token budget to produce the same result. So the kit
records the remaining gap in `coverage.uncovered_requirement_ids`, surfaces it
in the interface, and offers the user the two things that actually help: write a
question by hand, or regenerate that category. `coverage.passes` reports the
real number of passes run, not a constant.

## Generated, edited and pinned state

The hardest problem in the assessment. Regenerating one section must not
discard edits made elsewhere, and a question the user wrote or edited must
survive a regeneration of its category.

Every editable item carries:

```ts
origin: 'generated' | 'edited' | 'manual'
pinned: boolean
rev: number
```

The rule, enforced in `packages/core/src/state/merge.ts`:

1. A regeneration replaces **only** items where `origin === 'generated'` and
   `pinned === false`.
2. Everything else is kept **and passed into the regeneration prompt** as
   already-covered material, so the new questions do not duplicate it.
3. Editing a generated item flips its origin to `edited`, which makes it immune
   to future regenerations of its section. **An edit is an act of ownership** —
   that is the opinion this design takes. The alternative, requiring an explicit
   pin after editing, means one more click to protect work the user has already
   invested in, and one more way to lose it.
4. `pinned` exists for the case where a user wants to keep a generated item they
   have not edited.

Section state is tracked per section, not per kit, so one section can be
regenerating while the rest stays readable and editable. A regeneration builds
its result against a clone and swaps it in only after it validates — so a
failed regeneration leaves the previous content exactly as it was and sets
`sections.<key>.status = 'failed'`.

The interface makes this visible rather than implicit: every item shows whether
it is Generated, Edited or Yours, items that will survive are tinted, and the
Regenerate button states the consequence before you press it — "replaces 4
generated items, keeps 2 of yours". A rule the user cannot see is a rule they
cannot trust.

## Schedule allocation

Arithmetic in `packages/core/src/schedule/allocate.ts`, with its own test
suite:

- Questions are ranked by the priority of their highest-priority requirement
  (must before nice), then by difficulty descending — so harder, required
  material lands earlier and the night before is review.
- They are dealt round-robin across exactly `days` buckets, which front-loads
  the work: no later day carries more questions than an earlier one.
- `days` is clamped to 1–60. The returned array length always equals
  `days_available`, which always equals the number requested.
- One day means everything on day one. Sixty days means light days with an
  honest focus line, not invented material.
- Minutes are integers. A day with no questions gets zero minutes and a review
  focus rather than a fabricated task.

## Practice ordering

Confidence-weighted, computed on the server so it survives a reload and exists
in exactly one place: unseen cards first, then lowest confidence, then longest
since last seen.

**Why not spaced repetition.** SM-2 and its relatives optimise for retention
over months. This user has days. An interval algorithm would happily schedule a
card the user is shaky on for a date after their interview, which is precisely
the wrong answer. The simpler sort is the better fit for the deadline the
application exists to serve.

## Failure handling

| Case | Behaviour |
|---|---|
| Company URL invalid, 404 or times out | Recorded as unreachable, run continues on the JD alone, brief says so |
| No hiring or about page anywhere | Step skipped with a reason; brief states nothing was published; questions fall back to JD-derived |
| Two-line job description | Few requirements, thin kit, and a warning saying the description was thin. Nothing invented |
| No public discussion found | Recorded as not found. No fabricated sources |
| Model returns invalid JSON | One repair attempt with the parse error fed back, then the step fails into a warning |
| Rate limited | Token bucket plus exponential backoff with jitter, honouring any `retry-delay`, three attempts, then a warning rather than a dead run |
| Duplicate submission | Dedupe key returns the existing job |
| 1-day or 60-day request | Allocator handles both; day count always matches |
| Generation fails halfway | Kit persists as `partial`, readable, with warnings |

The governing rule: **inventing a requirement a description does not contain is
worse than reporting that there were few.** A thin description produces a thin
kit that says so, and a company nothing can be found about gets an honest brief
rather than a fabricated one.

## Security

The application fetches untrusted pages from the open internet, so it treats
them as untrusted throughout.

- **URL validation before every fetch.** Scheme must be http or https. Private,
  loopback, link-local (including the cloud metadata address), carrier-grade
  NAT and unspecified addresses are rejected when `NODE_ENV === 'production'`.
  They remain reachable outside production because the batch command is tested
  against `http://localhost:8099`.
- **Content restrictions.** HTML and plain text only, 1.5 MB cap, 8 second
  timeout, at most three redirects.
- **Prompt injection.** Every fetched page and the pasted description are
  wrapped in labelled delimiters and introduced to the model as untrusted data
  that must never be followed as instructions. Any forged delimiter inside the
  content is defanged before wrapping, and the cleaner strips script, style,
  nav and comment nodes before any text is taken. Both the description and every
  crawled page are text nobody in this system wrote, and all of it is fed to a
  model.
- **Auth.** Email and password, bcrypt, JWT in an httpOnly, secure,
  sameSite=none cookie. Every kit query is scoped by the authenticated user id,
  so another user's kit is a **404, not a 403** — whether it exists is not
  information this user is entitled to. Wrong password and unknown email return
  the same message. Login and registration are rate limited. Expired tokens
  clear the cookie and bounce to login rather than looping.
- Email verification, password reset and role hierarchies are deliberately out
  of scope, as the brief specifies.

## Tests

```bash
npm test
```

The three behaviours the brief names as most worth protecting have dedicated
suites:

- **Schedule allocation** — day count matches for 1, 5, 60 and out-of-range
  requests; every must-have appears; minutes are integers; harder material
  lands earlier; front-loading holds; every scheduled question exists.
- **Coverage checking** — a requirement with no question is reported; a covered
  one is not; must and nice are distinguished; references to non-existent
  requirements cover nothing; the second pass closes a gap.
- **Structure validation** — a conforming kit passes; missing sections, float
  minutes, out-of-range difficulty, malformed ids, dangling requirement and
  question references, and a day count that disagrees with `days_available` are
  all rejected.

Alongside those: the URL guard's private-range logic, the fetcher's size,
content-type and timeout caps against a real loopback server, link ranking and
crawl degradation, the LLM client's retry and JSON-repair paths, every pipeline
step against a stubbed client, a full pipeline run against a local fixture site,
the batch runner's per-case isolation and concurrency, auth and ownership
boundaries, the builder's edit-survives-regeneration rules, and the web app's
API client, mutation rollback and practice ordering.

**[N] tests across [M] files.**

## Design decisions and trade-offs

**No orchestration framework.** The pipeline is a mostly-linear sequence of
named steps with exactly one loop, and two of its steps must be deterministic
code. A state-graph framework would add channel and checkpointer concepts that
buy nothing here, and would make the sequencing harder for a reviewer to read,
not easier. `pipeline/runner.ts` is about eighty lines and does the three things
a framework would also do: time each step, isolate its failure, report
progress. Durable checkpointing and human-in-the-loop interrupts are the real
reasons to reach for one, and neither applies.

**Gemini over the alternatives.** A native JSON response schema is worth a lot
when the output shape is graded field by field, and search grounding removes the
need for a second API key while returning sources that exist. Groq is faster but
its free tokens-per-minute ceiling would have the batch command backing off
constantly.

**Express on Render rather than Next route handlers on Vercel.** Generation
takes sixty to a hundred and twenty seconds. Serverless timeouts would force
the pipeline into chunked invocations — a more complicated architecture to
solve a problem a long-lived process does not have. The cost is Render's cold
start, which is documented above.

**A monorepo with npm workspaces.** The batch command must run the same code as
the application, and `packages/core` makes that structural rather than a matter
of discipline. The cost is real: workspace installs need care on both hosts, and
the frontend cannot cleanly import from `packages/core` because Next resists
imports above its app root — so `apps/web/lib/types.ts` restates the kit types.
That duplication is the one place two definitions of the same shape exist, and
`validateKit` on the server is the authority.

**404 rather than 403 for another user's kit.** A 403 confirms the resource
exists.

**An edit protects an item permanently.** Discussed under
[state](#generated-edited-and-pinned-state). The alternative is an explicit pin
after editing; this design chose fewer clicks and less chance of losing work.

**Two coverage passes.** Discussed under [the second
pass](#the-second-pass).

**Confidence sort over spaced repetition.** Discussed under [practice
ordering](#practice-ordering).

**Requirements are read-only in the builder.** Every question and flashcard
references them by id, so editing a requirement would silently invalidate those
references and the coverage claim built on them. Reshaping happens on the
questions instead.

## Known limitations

- **Render's free tier sleeps.** The first request after idle takes about thirty
  seconds.
- **Atlas network access is open to `0.0.0.0/0`** because Render's free tier has
  no static egress address. On a paid plan this would be narrowed to a fixed
  address.
- **The crawler reads server-rendered HTML only.** A careers page rendered
  entirely by client-side JavaScript will look empty. A headless browser would
  fix it and was out of scope for the timebox.
- **Free-tier token limits.** Under sustained load the client backs off and, if
  it cannot recover, records a warning. Generation degrades rather than failing,
  but it does degrade.
- **The kit types are stated twice** — `packages/core/src/schema/kit.ts` and
  `apps/web/lib/types.ts` — for the Next import reason above. The server
  schema is authoritative.
- **The job runner is in-process.** A restart mid-generation leaves that kit in
  `running` with no worker; it can be deleted and restarted. A durable queue
  would fix it and is unjustified at this scale.
- **No optimistic-concurrency check on kit edits.** Two browser tabs editing the
  same question will have the last write win. Single-user editing is the
  assumed case.
- **The optional creative feature was not built.** Explicitly optional; the time
  went into the builder and interaction design instead, which carry
  twenty-five of the forty-five human-review points between them.
````

- [ ] **Step 2: Fill in every measured value**

Search the README for `[N]`, `[M]` and every `https://…` and replace them with
real values: the deployed URLs, the video link, the test count from
`npx vitest run`, and the batch timing you measured in Task 3 Step 6. A README
with a placeholder in it reads as unfinished work.

```bash
grep -n "\[N\]\|\[M\]\|…" README.md
```

Expected: no output.

- [ ] **Step 3: Commit** — *present this message to the user; do not run it*

```
docs: add readme covering architecture, retrieval, state model and trade-offs
```

---

## Task 5: The walkthrough video

Three to four minutes, and the brief says clarity matters more than production
value. It names five things it wants to see; the script covers all five in that
order.

**Files:**
- Create: `docs/walkthrough-script.md`

- [ ] **Step 1: Write the script**

`docs/walkthrough-script.md`:

```markdown
# Walkthrough script — 3½ minutes

Prepare before recording:
- Two browser tabs: a finished kit with edits already made, and a blank create form.
- A terminal with the repository open.
- A real job description in the clipboard.
- Wake the Render service first, so no cold start eats twenty seconds of the video.

## 0:00 — What it is (20s)

"Paste a job description, give a company's website, say how many days you have.
It researches the company, writes a preparation kit, and lets you reshape it and
practise against it. I'll show a kit being built, then the two parts I'd defend
hardest: the coverage loop, and what happens to your edits when you regenerate."

## 0:20 — End to end (50s)

Paste the description, enter the company URL, set days to 5, submit.

Point at the progress list while it runs:

"These are the pipeline's own step names, not a decorative bar. Extraction runs
first and alone because pasted text needs no retrieval. Then it crawls the site
and ranks the links — there's no hard-coded /careers, because companies bury
this in different places. What it finds about how they hire is an input to the
questions, so a company that publishes a take-home and a design round gets a
different kit from one that publishes nothing."

## 1:10 — Research and the second pass (45s)

Open the finished kit, then the Questions tab.

"Every requirement has a stable id. Every question says which requirements it
covers. That's what makes coverage checkable rather than a matter of opinion —
and the check is a set difference in my code, not something I asked the model."

Point at the coverage notice.

"First pass left a must-have uncovered. The application generated questions for
exactly that requirement, named it directly, and checked again. Two passes
maximum — if a targeted call naming a requirement still can't cover it, it's
usually degenerate text, and spending more of a rate-limited budget won't fix
it. So it reports the gap honestly and offers me the two things that help: write
one myself, or regenerate the category."

## 1:55 — Editing and regeneration (55s)

This is the part to get right.

Edit a question's prompt. Point at the badge changing to Edited.

"An edit is an act of ownership, so this is now immune to regeneration. I can
also pin a generated one I like without editing it."

Pin a second question. Then press Regenerate on Technical and pause on the
confirmation.

"It tells me the consequence before I commit: replaces four generated items,
keeps two of mine."

Confirm. Then point at the survivors.

"My edited question is still here with my wording. The pinned one survived.
The new questions came in around them — and they were told what already exists,
so they don't duplicate it. And" — switch to the Overview tab — "the brief I
edited earlier is untouched, because sections regenerate independently."

Drag a question, then reorder another with the keyboard arrows.

"Reordering works by keyboard as well as drag — drag alone isn't usable without
a pointer."

## 2:50 — Practice and the schedule (35s)

Open Practice. Press Space, then 1.

"One card at a time, keyboard throughout. I record how confident I felt, and
the next session comes back ordered by what I was least confident about —
computed on the server, so it survives a reload. Not spaced repetition: SM-2
optimises for months, and this user has days. An interval algorithm would
happily schedule a shaky card for after the interview."

Open the Schedule tab.

"Five days requested, five days allocated — arithmetic in my code, not a
prompt. Harder and required material first, so the night before is review."

## 3:25 — The decision I'd defend (25s)

Switch to the terminal.

`npm run evaluate -- --input cases.example.json --output kits.json`

"Same pipeline as the app — the batch command imports it, it isn't a second
implementation.

The decision I'd defend: no orchestration framework. This is a linear sequence
with one loop, and two steps that must be arithmetic rather than a prompt. A
state graph would have added concepts without adding capability, and made the
sequencing harder to read. The runner is eighty lines and does the three things
a framework would: time each step, isolate its failure, report progress."

## Cut if over time

- The batch command at the end (mention it, don't run it).
- The drag reorder (the keyboard reorder makes the same point better).
```

- [ ] **Step 2: Record and upload**

Record it, upload unlisted, and put the link in the README's header.

- [ ] **Step 3: Commit** — *present this message to the user; do not run it*

```
docs: add walkthrough script
```

---

## Task 6: Submission check

Read against the brief one last time. Every row is something a grader will look
for, and every row is cheap to check now and expensive to have missed.

- [ ] **Automated half — 55 points**

| Check | Where |
|---|---|
| Must-haves found in each description, marked correctly, nothing invented | `extractRequirements`, its tests, and the `thin` warning |
| Every must-have requirement has a question | `checkCoverage` + `fillGaps`, coverage notice |
| Schedule spans exactly the days requested and allocates all of it | `allocateSchedule` tests |
| Company site crawled, hiring page sought, public discussion searched | `discoverPages`, `findHiringProcess`, `searchPublicDiscussion` |
| Question categories generated separately | one call per category in `generateAllQuestions` |
| Coverage genuinely checked, `passes` reports reality | pipeline loop |
| Run completes, unreachable sites recorded not fatal | warnings, `partial` status |
| Kits match Appendix A exactly | `validateKit`, run before every save and write |
| Tests pass | `npm test` |
| `npm run evaluate` works from a clean clone | Task 3 Step 6, done for real |
| Five cases inside fifteen minutes | measured, recorded in the README |

- [ ] **Human half — 45 points**

| Check | Where |
|---|---|
| Editing, reordering, and a regeneration that preserves edits | builder; demonstrated in the video |
| Loading, empty and error states everywhere | Phase 4 Task 4's audit table, each row seen |
| Responsive and keyboard-navigable | Phase 4 sweeps |
| Code quality and separation of concerns | `packages/core` boundaries |
| Reasoning in the README | design-decisions and known-limitations sections |
| Practice mode | Phase 4 |
| Creative feature | deliberately skipped, and said so in the README |

- [ ] **Submission requirements**

| Item | Status |
|---|---|
| Public GitHub repository with real commit history | commits made per task through all five phases |
| Batch entry point working from a clean clone | verified in Task 3 |
| Deployment link, frontend and backend both reachable | verified in Task 3 |
| 3–4 minute walkthrough video | Task 5 |
| README with every listed section | Task 4 |

- [ ] **The two cases the brief says it tests**

Run both against the deployed application and watch what happens:

1. **A two-line description with almost no detail.** Expect: few requirements, a
   thin kit, an explicit warning that the description was thin, and nothing
   invented.
2. **A company whose site has no hiring page anywhere.** Expect: the hiring step
   skipped with a reason, a brief that says what could and could not be found,
   questions derived from the description, and no fabricated sources.

The brief says handling these honestly counts for more than handling the easy
ones well. If either one embellishes, fix it before submitting — that is the
highest-value bug left in the system.

- [ ] **Final sweep**

```bash
npm test
npm run typecheck
npx tsc --noEmit -p apps/web
git status --short          # clean
grep -rn "TODO\|FIXME\|XXX" --include="*.ts" --include="*.tsx" packages apps scripts | grep -v node_modules
grep -n "\[N\]\|\[M\]\|…" README.md
```

Expected: tests green, types clean, working tree clean, no stray markers, no
placeholders in the README.

---

## Phase 5 done when

- Both halves are publicly reachable and a real kit can be built end to end on the deployed application.
- The session cookie works cross-origin — verified in devtools, not assumed.
- `npm run evaluate` has been run from a genuinely clean clone and produced Appendix B output, with a measured timing recorded in the README.
- Every environment variable is documented in two places and no secret is committed.
- The README contains every section the brief lists, with no placeholders.
- The video is recorded and linked.
- The thin-description and no-hiring-page cases both degrade honestly on the deployed application.
