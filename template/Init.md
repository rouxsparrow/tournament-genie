You are Codex. Initialize a brand-new project repository from scratch with a clean, consistent, low-token workflow. Your output must be concise and action-oriented.

GOAL
Create the full initial file/folder structure, baseline configs, and the “source of truth” docs so we can start coding immediately with minimal requirement drift.

ASSUMPTIONS (use sensible defaults if not provided)
- Language: TypeScript
- Runtime: Node.js
- App type: Web app (framework-agnostic skeleton; do NOT scaffold Next.js/React unless already present)
- Package manager: npm
- Testing: Vitest
- Lint/format: ESLint + Prettier
If the repo already has a framework (e.g., Next.js), adapt configs to fit it instead of re-scaffolding.

NON-NEGOTIABLES
1) Token discipline:
   - Do NOT paste large code blocks in chat.
   - Create/edit files directly in the repo.
   - When done, only output: (a) created/changed files list, (b) commands to run, (c) next-step checklist.
2) Single source of truth:
   - Requirements live in SPEC.md
   - Work plan lives in TASKS.md
   - Decisions live in DECISIONS.md
   - Agent rules live in Agents.md
3) Consistency:
   - Enforce formatting/linting
   - Keep docs short (1–2 pages each max)
4) No feature code yet:
   - Only baseline skeleton, configs, example placeholders, and “hello” minimal entry if needed.

DELIVERABLES (must create all)
Project structure:
- /src
  - /app              (empty placeholder; where application code will go)
  - /lib              (shared utilities placeholder)
  - /types            (shared types placeholder)
  - index.ts          (minimal entry; no app logic)
- /tests              (placeholder)
- /docs
  - ARCHITECTURE.md
  - RELEASE.md
  - SECURITY.md        (short, practical)
- README.md
- Agents.md
- SPEC.md
- TASKS.md
- DECISIONS.md
- .editorconfig
- .gitignore
- .env.example
- package.json
- tsconfig.json
- eslint.config.(js|mjs)
- .prettierrc (or prettier config)
- .prettierignore
- vitest.config.ts (or minimal vitest setup)
- GitHub templates (create folder):
  - /.github
    - /PULL_REQUEST_TEMPLATE.md
    - /ISSUE_TEMPLATE
      - bug_report.md
      - feature_request.md

CONTENT REQUIREMENTS (write these carefully)
Agents.md must include:
- Read-first files: Agents.md, SPEC.md, ARCHITECTURE.md, TASKS.md, DECISIONS.md
- Rules:
  - keep diffs minimal; no drive-by refactors
  - update SPEC/DECISIONS when behavior/requirements change
  - always add/update tests when relevant
  - output format: files changed + commands + verification steps
- Coding standards:
  - naming conventions
  - folder ownership rules: business logic in /src/app, shared utils in /src/lib
  - no “god files”
- Token discipline rules (short)

SPEC.md must include a template with placeholders:
- Goal
- Non-goals
- Personas / Roles
- User journeys (top 3–5)
- Functional requirements (numbered)
- Non-functional requirements
- Acceptance criteria (verifiable)
Keep it generic (no domain assumptions).

TASKS.md must include:
- “Project bootstrap” tasks checked as done
- A section “Next tasks (to fill)” with an example of how to write tasks (thin vertical slices)

DECISIONS.md must include:
- A short ADR-style format
- Seed entries for: language/runtime/testing/linting choices

ARCHITECTURE.md must include:
- Tech stack summary
- Module boundaries
- Data flow (high level)
- Testing strategy (short)

RELEASE.md must include:
- Staging -> production checklist
- Env var checklist
- Migration checklist (even if none yet)

SECURITY.md must include:
- Secrets handling
- Dependency hygiene
- Basic auth/z hardening notes

CONFIG REQUIREMENTS
- ESLint + Prettier + TypeScript configured to work together
- Add npm scripts:
  - dev (placeholder)
  - build (tsc)
  - test (vitest)
  - lint
  - format
  - typecheck
- Ensure “lint” and “test” pass on fresh install.
- Add a very small example test in /tests that passes (e.g., a trivial sum test) to verify wiring.

WORKFLOW REQUIREMENTS
- Add a PR template that enforces:
  - links to TASKS item
  - checklist: tests, lint, docs updated, env vars/migrations considered

EXECUTION STEPS (do them now)
1) Initialize package.json + dependencies (typescript, vitest, eslint, prettier, @types/node, etc.)
2) Create folder structure
3) Create docs and templates with the required content
4) Verify configuration coherency:
   - TypeScript compiles
   - Vitest runs
   - ESLint runs
   - Prettier runs

FINAL OUTPUT (strict)
After finishing, respond with ONLY:
A) Files created/updated (grouped by category: config/docs/src/tests/.github)
B) Commands to run (copy-paste)
C) “Next steps” checklist (max 8 bullets)
