# GradeMate

AI-assisted grading for Google Classroom. A teacher signs in with Google, browses the classes
they teach, opens an assignment to see who submitted, previews each student's PDF, and runs a
3-step **Grade All** wizard (Assignment → Marking Scheme → Grades) where
**Gemma 4 26B-A4B** (via AWS Bedrock's mantle OpenAI-compatible endpoint) grades each
submission's page images against the marking scheme with live progress logs, per-criterion
scores, feedback, class stats and CSV export.

Grades stay in GradeMate (read-only Google scopes) — nothing is written back to Classroom.

## Stack

Next.js 15 (App Router) · Tailwind v4 · Auth.js v5 (Google OAuth) · Drizzle ORM + libSQL/SQLite ·
googleapis (Classroom + Drive) · `openai` SDK → Bedrock mantle (Gemma, vision) ·
`pdf-to-img` + `sharp` (PDF → downscaled page images) · KaTeX + highlight.js previews ·
Langfuse (OpenTelemetry) tracing for every LLM call.

## Run

```bash
pnpm install
pnpm db:migrate       # first time only — applies drizzle/ migrations, creates dev.db
pnpm dev              # http://localhost:3000
```

Changed the schema (`db/schema.ts`)? Run `pnpm db:generate` to emit a new migration, then
`pnpm db:migrate` to apply it. `pnpm db:studio` opens Drizzle Studio.

### Modes

- **Real mode** (`USE_MOCK_CLASSROOM=false` in `.env`): sign in with the Google teacher
  account; live Classroom/Drive data.
- **Mock mode** (`USE_MOCK_CLASSROOM=true`): adds a "Continue as Demo Teacher" login with 4
  fixture classes and sample PDF submissions — no Google needed. Bedrock creds are still used
  if present (real AI over mock data); without them, AI endpoints stream canned content so
  every flow still completes offline.

## Environment (`.env`)

| Var | Notes |
|---|---|
| `AUTH_SECRET` | Auth.js JWT/cookie secret |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | OAuth web client; redirect `http://localhost:3000/api/auth/callback/google` |
| `NEXTAUTH_URL` | `http://localhost:3000` |
| `BEDROCK_BASE_URL` | must end in **`/openai/v1`** — plain `/v1` gives a misleading "Berm not enabled" 401; `/anthropic` is Claude-only |
| `BEDROCK_API_KEY` | Bedrock API key, sent as Bearer (no AWS SigV4) |
| `BEDROCK_MODEL_ID` | `google.gemma-4-26b-a4b` (vision; used to grade the transcript, and as the fallback when OCR is off) |
| `MISTRAL_API_KEY` | Mistral OCR — every document is read to Markdown before it reaches the grader. Omit to fall back to sending page images |
| `MISTRAL_OCR_MODEL` | optional override; defaults to `mistral-ocr-latest` |
| `NEON_DATABASE_URL` | Neon Postgres, pooled (`-pooler`) host — what the app runs on |
| `NEON_DATABASE_URL_UNPOOLED` | direct host; used by `drizzle-kit` for migrations and studio |
| `AWS_REGION` | `us-east-1` — region of the uploads bucket |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | IAM user scoped to `s3:{Put,Get,Delete}Object` on `<bucket>/uploads/*`, plus `s3:ListBucket` on the bucket (see below) |
| `S3_BUCKET_NAME` | private bucket for uploads; all keys live under the `uploads/` prefix |
| `USE_MOCK_CLASSROOM` | `true` / `false` |
| `LANGFUSE_PUBLIC_KEY` / `LANGFUSE_SECRET_KEY` | Langfuse project keys — enable LLM tracing. Omit both to disable tracing (no-op) |
| `LANGFUSE_BASE_URL` | e.g. `https://us.cloud.langfuse.com` (US) or `https://cloud.langfuse.com` (EU) |

## Layout

- `app/` — routes: `login`, `(app)/dashboard`, `(app)/classes/[courseId]`,
  `…/work/[workId]` (submissions + PDF modal), `…/grade` (wizard), plus API routes:
  `api/drive/[fileId]` (authed Drive proxy, exports Google Docs → PDF), `api/files/*`
  (uploads), `api/sessions/[id]`, `api/ai/transcribe`, `api/ai/generate` (streaming),
  `api/grade/[sessionId]` (NDJSON grading stream).
- `db/` — Drizzle schema (`schema.ts`) and the migrate runner (`migrate.mjs`); generated SQL
  lives in `drizzle/`.
- `lib/` — `auth` (Auth.js + Drizzle adapter), `db` (Drizzle + Neon serverless client), `google` (token
  refresh), `classroom` (real + mock behind one interface), `bedrock` (Gemma calls + tolerant
  JSON), `pdf` (rasterize + downscale, capped pages), `prompts` (loads editable templates),
  `storage` (S3; uploads live under the `uploads/` key prefix and are proxied through
  `api/files/[id]`, so the bucket stays private), `canned` (offline fallbacks).
- `prompts/` — the AI prompt templates as editable Markdown (`transcribe`, `generate-marking-scheme`,
  `grade-system`, `grade`). Edit freely; they're re-read on every request. See `prompts/README.md`.
- `demo/` — standalone integration smoke tests (see `demo/README.md`).
- `dev.db`, `.env`, `demo/out/` are gitignored (secrets + student files). Uploads no longer
  touch the filesystem — they go to S3.

## Observability (Langfuse)

Every LLM call is traced to [Langfuse](https://langfuse.com) via OpenTelemetry. Setup lives in
`instrumentation.ts` (starts the OTel Node SDK on server boot) and `lib/langfuse.ts` (the shared
`LangfuseSpanProcessor`); the `openai` client is wrapped with `observeOpenAI` in `lib/bedrock.ts`,
so all three AI routes (`grade`, `ai/generate`, `ai/transcribe`) are covered automatically.

- **Traces:** `grade-run` (one per grading run, with a `grade-submission` generation per student),
  `generate-marking-scheme`, `transcribe-document`. Each carries `userId` (teacher), `sessionId`
  (the grading session — groups a run's students and re-runs under **Sessions**), tags, and
  per-call metadata (student, course, assignment, page count, points). Model, tokens and **cost**
  are captured per generation.
- **Student scans are never sent:** base64 page images are masked out of the traced payload
  (`lib/langfuse.ts`), and student emails are kept out of metadata.
- **Disable** by removing `LANGFUSE_*` from `.env` — tracing becomes a no-op.
- **Cost** needs a one-time model-price entry for `google.gemma-4-26b-a4b` in your Langfuse project
  (Settings → Models, or the API). This repo's was seeded at ~$0.13/1M input, $0.40/1M output —
  adjust to current Bedrock pricing.

## Notes

- Real rosters paginate at 30/page and can repeat students — the classroom layer paginates
  and dedupes by `userId`; big phone-scan PDFs are downscaled to ≤1280px and capped at 8
  pages per submission.
- Google refresh tokens in OAuth "Testing" mode expire after 7 days — sign in again if
  classes stop loading.
- Google Forms quizzes are listed but out of scope for AI grading (auto-graded by Forms).
