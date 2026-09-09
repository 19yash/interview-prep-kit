# The AI Interview Prep Kit

Transform any job description, company URL, and preparation timeframe into a tailored, interactive interview preparation kit: company research brief, role breakdown, categorized question bank, interactive 3D flashcards, and a day-by-day study schedule.

---

## 1. Overview & Tech Stack

The application takes a pasted job description, a target company's website address, and a preparation timeline (1–60 days), producing a fully structured preparation kit that users can customize, regenerate section-by-section, and rehearse against.

| Layer | Technology | Choice & Justification |
|---|---|---|
| **Frontend** | Next.js 15 (App Router), React 19, Tailwind CSS | Server & client component separation, accessible interactive UI, CSS 3D transforms for card flipping. |
| **Backend** | Node.js, Express, TypeScript | Long-lived process suited for multi-step background pipeline jobs without serverless execution timeouts. |
| **Database** | MongoDB & Mongoose | Flexible document model matching the nested, versioned preparation kit schema and practice attempts. |
| **Core Shared** | `@ipk/core` (npm workspace) | Single source of truth for schemas (Zod), deterministic algorithms, crawler, and pipeline runner shared by API and CLI. |
| **LLM Provider** | Google Gemini (`gemini-3.6-flash`) | Native JSON schema enforcement (`responseSchema`), free-tier availability, and search grounding. |
| **Scraping** | `undici` + `cheerio` + `robots-parser` | Lightweight HTML parsing and link extraction respecting `robots.txt` without heavy browser engine overhead. |
| **Testing** | Vitest | Fast unified test runner across all monorepo workspaces (343 tests across 30 files). |

---

## 2. Setup & Local Development

### Prerequisites
- Node.js `>= 20.0.0`
- MongoDB instance (local `mongod` or MongoDB Atlas URI)
- Google AI Studio API key (`GEMINI_API_KEY`)

### Installation & Run

```bash
# 1. Clone and install dependencies
git clone <repository-url> && cd interview-prep-kit
npm install

# 2. Configure environment
cp .env.example .env

# 3. Start development servers
npm run dev:api    # Express API on http://localhost:4000
npm run dev:web    # Next.js web app on http://localhost:3000
```

### Environment Variables

| Variable | Target | Purpose |
|---|---|---|
| `GEMINI_API_KEY` | `@ipk/core`, API, CLI | Google AI Studio API key for all generation steps. |
| `GEMINI_MODEL` | `@ipk/core` | Model identifier (defaults to `gemini-2.5-flash`). |
| `MONGODB_URI` | API | MongoDB connection string (e.g. `mongodb://127.0.0.1:27017/ipk`). |
| `PORT` | API | Port Express listens on (default `4000`). |
| `JWT_SECRET` | API | Secret for signing session cookies (`openssl rand -hex 32`). |
| `WEB_ORIGIN` | API | Allowed CORS origin(s), comma-separated (default `http://localhost:3000`). |
| `NODE_ENV` | Global | `production` turns on strict SSRF checks and secure cookies. |
| `NEXT_PUBLIC_API_URL` | Web | Base API URL read by the Next.js client (`http://localhost:4000`). |

---

## 3. Batch Evaluation

The repository provides the required CLI evaluation entry point that runs the exact same core pipeline without requiring a running database:

```bash
npm run evaluate -- --input <cases.json> --output <kits.json> [--concurrency 2]
```

Example:
```bash
npm run evaluate -- --input cases.example.json --output kits.json
```

- **Clean Execution**: Operates standalone with zero database dependency.
- **Isolated Cases**: Failures in individual cases are captured as error records in the output array without aborting the batch.
- **Concurrency Control**: Defaults to 2 concurrent runs to balance execution speed against Gemini rate limits.
- **Localhost Friendly**: Follows relative URLs and accepts `http://localhost:*` endpoints in non-production environments.

---

## 4. Architecture & Component Roles

```
                         Next.js Web App (apps/web)
                                    │
                               REST + Cookie
                                    │
                         Express Server (apps/api)
                                    │
                  ┌─────────────────┴─────────────────┐
                  ▼                                   ▼
             Auth & Kit State                 Job Runner (Queue)
             (MongoDB / Mongoose)                     │
                                                      ▼
 ┌─────────────────────────────────────────────────────────────────────────────┐
 │                         @ipk/core Pipeline Runner                           │
 │                                                                             │
 │   1. JD Extraction ──> 2. Web Research ──> 3. Brief & Breakdown             │
 │                                                                             │
 │   4. Question Bank ──> 5. Coverage Check (Deterministic) ──> 6. Gap Fill    │
 │                                                                             │
 │   7. 3D Flashcards ──> 8. Schedule Allocator (Deterministic)                │
 └─────────────────────────────────────────────────────────────────────────────┘
                                    ▲
                                    │
                  Batch CLI (scripts/evaluate.ts)
```

### Deterministic Application Logic vs. LLM Responsibilities
A core architectural tenet is: **Never delegate what code can prove to an LLM.**

- **LLM Decides**: Requirement extraction from prose, synthesis of crawled pages into company briefs, contextual interview question generation, and flashcard drafting.
- **Deterministic Code Decides**:
  - **Coverage Verification**: Explicit set difference between requirement IDs and question requirement references.
  - **Schedule Allocation**: Mathematical round-robin distribution over exact $N$ days, ordered by requirement importance and question difficulty.
  - **Thin Description Detection**: Character and requirement count thresholds rather than subjective model assessment.
  - **Regeneration Merge**: Immutable preservation of user-edited, user-created, and pinned items.

---

## 5. Research & Generation Pipeline Sequence

The pipeline executes as a strictly sequenced directed acyclic graph:

```
[Job Description] ──> [1. extractRequirements] (r1..rN, kind, must/nice)
                               │
[Company URL]     ──> [2. discoverPages] ──> [3. fetchAndClean] (robots.txt, links ranked)
                               │
                      [4. findHiringProcess] (discovered stages & rounds)
                               │
                      [5. searchPublicDiscussion] (grounded interview experiences)
                               │
                      [6. buildCompanyBrief] (company summary, hiring notes, sources)
                               │
                      [7. generateQuestions] (1 prompt per category: tech, behav, etc.)
                               │
                      [8. checkCoverage] (pure code: set difference)
                               │
                 Uncovered must-haves? 
                 ├── Yes ──> [9. fillGaps] (targeted questions) ──> [re-check coverage]
                 └── No  ──┐
                           ▼
                      [10. generateFlashcards] (targeted front/back study pairs)
                           │
                      [11. allocateSchedule] (pure code: distribution over exact N days)
                           │
                      [12. validateKit] (Zod schema validation against Appendix A)
```

### Why Ordering Matters
1. **Extraction First**: Role requirements establish the ground truth (`r1..rN`) used by all subsequent generation and verification steps.
2. **Research Precedes Questions**: Real hiring process data (e.g. a known take-home assessment or system design round) directly informs the categories and tone of questions.
3. **Categories Run Independently**: Generating technical, behavioral, and role-specific questions in isolated prompt calls prevents instructions from bleeding across categories.
4. **Coverage Before Schedule**: The schedule can only distribute questions once the final question set (including gap-filling questions) is complete.
5. **Two Passes Maximum**: If a requirement remains uncovered after a targeted second pass naming it explicitly, it is typically ambiguous or degenerate text. Continuing to burn token budget in loops is avoided; the gap is reported honestly in `coverage.uncovered_requirement_ids`.

---

## 6. Retrieval Strategy & Sources

- **Heuristic Link Discovery**: Rather than hardcoding fixed paths (like `/careers`), the crawler parses the homepage, resolves links, and scores them based on hiring keywords, path depth, and URL slug semantics.
- **Crawler Constraints**: Bounded to a maximum of 6 pages per site, 1.5 MB response size cap, 8-second timeout, and at most 3 redirects.
- **Search Grounding**: Public interview discussions are retrieved using Google Search grounding, ensuring cited URLs correspond to real external discussions.
- **Robots & Ethics**: `robots.txt` is fetched, cached, and strictly respected per origin.

---

## 7. State Model & Section Regeneration

To solve the challenge of section regeneration without destroying user modifications, every question and flashcard maintains explicit provenance metadata:

```ts
type ItemState = {
  origin: 'generated' | 'edited' | 'manual'
  pinned: boolean
  rev: number
}
```

### Regeneration Rules (`packages/core/src/state/merge.ts`)
1. **Replaced**: Only items with `origin === 'generated'` and `pinned === false` are replaced during regeneration.
2. **Preserved**:
   - `edited`: Any inline modification flips `origin` to `edited`. **An edit is an act of ownership** and is permanently immune to regeneration.
   - `manual`: Questions or flashcards added by hand are always preserved.
   - `pinned`: Unmodified generated items explicitly pinned by the user survive.
3. **No Duplication**: Preserved items are passed back into the LLM regeneration prompt under `existing_items` so the model avoids duplicating existing concepts.
4. **Scoped Sections**: Regenerating questions in one category (or flashcards) operates on a cloned document and never impacts other sections.

---

## 8. Deterministic Schedule Allocation

Implemented in `packages/core/src/schedule/allocate.ts`:
- **Strict Day Invariant**: The schedule always contains exactly `days_available` days (matching user input, clamped between 1 and 60 days).
- **Priority & Difficulty Ordering**: Questions covering `must` requirements are scheduled before `nice` requirements; higher difficulty questions land in earlier days, reserving the final days for review.
- **Round-Robin Front-Loading**: Questions are distributed round-robin across days so that no later day has more questions than an earlier day.
- **Valid Question References**: Every scheduled `question_id` strictly exists in the kit's question bank.

---

## 9. Practice Mode & Interactive 3D Flashcards

- **3D Card Flip**: Flashcards feature full CSS 3D transforms (`perspective: 1000px`, `transform-style: preserve-3d`, `rotate-y-180`) with dedicated Question and Answer faces.
- **Space-Efficient Typography**: Text flows naturally across the entire card body without artificial scrollbars, offering a full-height edit mode on demand.
- **Interactive Practice**:
  - Cards start with answers hidden.
  - Reveal answer via `Space` / `Enter` or pointer click.
  - 3-point confidence rating: `1` (Not yet), `2` (Shaky), `3` (Confident).
- **Server-Driven Queue Ordering**:
  - Order: **Unseen cards** $\rightarrow$ **Lowest confidence** $\rightarrow$ **Least recently seen**.
  - **Why not SM-2 Spaced Repetition?** Spaced repetition algorithms (e.g. Anki/SM-2) optimize memory retention over months. Candidates using this kit have deadlines measured in days. Scheduling shaky cards for days after the interview is counter-productive.

---

## 10. Reliability, Security & Failure Handling

### Failure Behavior
| Scenario | System Handling |
|---|---|
| **Company 404 / Timeout** | Marked unreachable; pipeline proceeds using JD alone; brief explicitly states company site was unreachable. |
| **No Hiring Page Found** | Recorded honestly in `warnings[]`; questions fall back to JD requirements; no fabricated stages. |
| **Thin Job Description** | Generates minimal requirements, flags kit with `thin: true` warning; never invents requirements. |
| **Invalid Model JSON** | Automatically repaired using JSON parse feedback; fails gracefully into isolated warning if unrecoverable. |
| **Rate Limiting** | Exponential backoff with jitter and token bucket limiter; degrades gracefully rather than failing the run. |
| **Duplicate Submission** | Deduplicated via `sha256(userId + jd + companyUrl)` unique index, returning the existing in-progress job. |

### Security Measures
- **SSRF Prevention**: In `production`, URLs resolving to private, loopback, link-local, carrier-grade NAT, or cloud metadata IP ranges (`169.254.169.254`) are blocked.
- **Prompt Injection Defense**: All crawled text and pasted descriptions are wrapped in strict delimiters and declared as untrusted data in system instructions.
- **Session Security**: Session tokens are stored in `httpOnly`, `secure`, `sameSite: none` cookies. Cross-user data access returns `404 Not Found` (rather than `403 Forbidden`) to prevent resource enumeration.

---

## 11. Testing & Verification

The suite contains **343 automated tests across 30 test files** covering all core invariants:

```bash
# Run all workspace tests
npm test

# Run type checks
npm run typecheck
npx tsc --noEmit -p apps/web
```

- `packages/core/test/schedule.allocate.test.ts`: Exact day count, round-robin, must-have inclusion, integer minutes.
- `packages/core/test/coverage.check.test.ts`: Deterministic coverage set arithmetic, gap detection.
- `packages/core/test/schema.kit.test.ts`: Zod validation of Appendix A schema.
- `packages/core/test/fetch.url-guard.test.ts`: SSRF protection and IP range filtering.
- `apps/api/test/builder.test.ts`: CRUD, question reordering, flashcard mutations, and section regeneration.
- `apps/web/test/use-practice.test.ts`: Practice session state, keyboard shortcuts, and queue advancement.

---

## 12. Design Decisions & Trade-offs

| Decision | Alternative Considered | Rationale |
|---|---|---|
| **No heavy orchestration framework (e.g. LangGraph)** | LangChain, CrewAI | The pipeline is a predictable 9-step sequence with one conditional loop. An 80-line custom runner (`pipeline/runner.ts`) is easier to audit, debug, and maintain. |
| **Express background job over Serverless functions** | Next.js API Routes / Vercel Functions | Generation takes 60–90 seconds with crawling and model calls. Serverless timeouts (10–60s) would force complex chunking. |
| **Set-difference coverage over LLM evaluation** | LLM-as-a-judge | Coverage must be an objective, reproducible fact, not a probabilistic opinion. |
| **Automatic edit protection over explicit pinning** | Manual pin-after-edit | Requiring users to remember to pin an item after editing creates a high risk of accidental data loss during regeneration. |
| **Confidence queue over SM-2 spaced repetition** | SuperMemo SM-2 | Short interview preparation timelines require urgent remediation of weak topics, not long-term exponential intervals. |

---

## 13. Known Limitations

- **JavaScript-Rendered SPAs**: The lightweight crawler parses static HTML via Cheerio. Sites requiring full client-side JavaScript execution to render text are not fully indexed (a headless browser like Playwright was omitted to prevent resource bloat).
- **Render Free Tier Cold Starts**: Render's free tier spins down after inactivity; initial requests after a sleep period may take ~30–50 seconds to boot.
- **In-Process Job Queue**: Background jobs run inside the API process. While ideal for single-instance scale, a distributed production deployment would replace this with Redis/BullMQ.
- **Single-User Concurrency**: Last-write-wins semantics apply if the same kit is modified concurrently across multiple browser tabs.
