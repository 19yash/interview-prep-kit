# Walkthrough Script — 3½ Minutes

This script is structured to cover all 5 required video evaluation topics in order:

## Preparation Before Recording
- Open two browser tabs:
  1. A finished kit with questions, 3D flashcards, and edits already made.
  2. The home / create kit page (`/kits/new`).
- Have a terminal window ready with the repo root open.
- Copy a realistic job description into your clipboard.
- Wake up the Render API web service (e.g. visit `/api/health`) beforehand so no cold start slows down your demo.

---

## 0:00 — 0:20: Introduction (20s)
> *"Paste a job description, enter a company website, and specify how many days you have to prepare. The application autonomously crawls the company, extracts requirements, generates a categorized preparation kit, and gives you an interactive builder and practice mode to study against. Today I'll demonstrate creating a kit end-to-end, the deterministic coverage loop, our 3D flashcards, and the state model that guarantees your edits survive regeneration."*

---

## 0:20 — 1:10: End-to-End Generation & Research (50s)
- On `/kits/new`, paste the job description, enter `https://stripe.com/` (or target company), set days to `5`, and click **Build kit**.
- Point to the live progress panel as steps advance:
  > *"These are actual pipeline step names updating in real time, not an artificial progress bar. Requirements extraction runs first on the raw text. Then our crawler dynamically ranks and fetches links—there are no hardcoded `/careers` paths because companies structure their sites differently. Discovering interview stages directly influences the tone and categories of questions generated downstream."*

---

## 1:10 — 1:55: The Two-Pass Coverage Loop (45s)
- Switch to the finished kit and click the **Questions** tab.
  > *"Every requirement has a stable identifier like `r1`, and every question declares which requirement IDs it covers. Coverage is verified by pure deterministic set arithmetic in our code—never delegated to an LLM. When an initial pass leaves a must-have requirement uncovered, the pipeline triggers a targeted second pass specifically naming that gap. We cap this at two passes: if a targeted call still cannot cover a requirement, it is typically ambiguous or degenerate text. The kit reports the gap honestly rather than hallucinating questions."*

---

## 1:55 — 2:50: Builder, State Model & 3D Flashcards (55s)
- Edit a question prompt:
  > *"Notice the badge changes to 'Edited'. In our state model, an edit is an act of ownership that permanently shields the item from being overwritten during future regenerations."*
- Pin another question:
  > *"I can also pin generated questions I want to keep without editing them."*
- Click **Regenerate** on a question category:
  > *"The confirmation modal explicitly tells me: 'Replaces X generated items, keeps Y of yours'. Upon regeneration, my edited question and pinned question remain intact while new questions fill in around them without duplicating existing topics."*
- Switch to the **Flashcards** tab:
  > *"Flashcards render as an interactive 3D card grid. Clicking any card flips it smoothly between the Question and Answer faces. Notice how text utilizes the full card body without artificial scrollbars, and we can also trigger a full-height edit mode."*

---

## 2:50 — 3:20: Practice Mode & Deterministic Schedule (30s)
- Click **Practise these** to open Practice Mode:
  > *"Cards start with answers hidden. Pressing Space reveals the answer, and keys 1, 2, or 3 record confidence. The next sitting is ordered server-side, prioritizing cards with the lowest confidence and longest elapsed time. We deliberately avoided long-term spaced repetition algorithms like SM-2, because interview candidates have deadlines in days, not months."*
- Switch to the **Schedule** tab:
  > *"Requested 5 days, and exactly 5 days are allocated. Pure arithmetic front-loads higher difficulty and must-have requirements into earlier days, keeping the night before for review."*

---

## 3:20 — 3:45: CLI & Architecture Defense (25s)
- Switch to the terminal and show `npm run evaluate`:
  > *"The mandatory batch CLI runs the exact same `@ipk/core` pipeline as our web application. The technical decision I'd defend most is avoiding heavy orchestration frameworks: an 80-line custom runner is transparent, easy to debug, and guarantees that coverage and scheduling remain deterministic code."*
