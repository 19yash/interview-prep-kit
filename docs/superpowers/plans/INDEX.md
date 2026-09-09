# Implementation Plans — AI Interview Prep Kit

Spec: `../specs/2026-09-08-interview-prep-kit-design.md`

Execute in order. Each phase ends with something demonstrable.

| Phase | File | Deliverable | Status |
|---|---|---|---|
| 1 | [2026-09-08-interview-prep-kit.md](./2026-09-08-interview-prep-kit.md) | Core pipeline, batch command (`npm run evaluate`), API with auth + jobs + builder endpoints. The 55 automated points are all in here. | planned |
| 2 | [phase-2-web-foundation.md](./phase-2-web-foundation.md) | Next.js app: auth, kit list, create form + batch upload, live progress view. | planned |
| 3 | [phase-3-reader-and-builder.md](./phase-3-reader-and-builder.md) | Kit reader and the builder: inline edit, reorder, add/delete, per-section regenerate. | planned |
| 4 | [phase-4-practice-and-polish.md](./phase-4-practice-and-polish.md) | Practice mode, coverage display, keyboard access, responsive pass. | planned |
| 5 | [phase-5-deploy-and-readme.md](./phase-5-deploy-and-readme.md) | Deployment, environment documentation, README, walkthrough video script. | planned |

Phase 1 must be finished before Phase 2: the web app is written against the
API contract Phase 1 establishes, and the automated half of the score does not
depend on any interface existing.
