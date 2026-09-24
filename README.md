# n8n Automation Portfolio

Production-ready automation workflows built with self-hosted n8n. Integrates GitHub, Gmail, Groq (LLM), Google Gemini (embeddings), Supabase (PostgreSQL + pgvector), and Telegram.

## Projects

### 1. GitHub "Good First Issue" Notifier

Automatically checks a GitHub repository every weekday at 9:00 AM (Asia/Manila) for open issues labeled `good first issue` and emails a formatted summary. Skips the email when there's nothing to report.

**Problem it solves:** Manually checking a repo for contribution opportunities is repetitive and easy to forget. This workflow runs on a schedule and surfaces new issues without any manual check.

**Architecture:**

```
Schedule Trigger (weekday 9AM)
→ GitHub: Get Issues (open, repo: xirv-systems)
→ Filter: has 'good first issue' label AND is not a PR
→ Edit Fields: format email subject + body
→ Gmail: send summary email
```

**Key implementation details:**

- **Schedule:** Cron expression `0 9 * * 1-5` with timezone `Asia/Manila`. Weekdays only.
- **Label filtering:** GitHub's API returns labels as an array of objects, not strings. Filter uses `labels.some(l => l.name === 'good first issue')`.
- **PR exclusion:** GitHub's issues endpoint returns pull requests too. Filter checks `pull_request === undefined` to exclude PRs.
- **Empty-result handling:** Filter node outputs 0 items when nothing matches, which structurally prevents Gmail from sending. No email sent = no noise.
- **Error handling:** Linked to a dedicated error workflow that emails the failure details.

**Stack:** n8n (self-hosted) · GitHub REST API · Gmail API (OAuth2)

**Estimated impact:** ~5 minutes saved per manual check × ~22 weekdays = **~110 minutes/month saved**.

---

### 2. AI Log Classifier (Groq + Supabase + Telegram)

Event-driven workflow that receives application logs via webhook, classifies severity using an LLM, persists every log to PostgreSQL, and sends real-time Telegram alerts for critical entries only.

**Problem it solves:** Manual log review doesn't scale, and silent failures go unnoticed. This workflow triages logs automatically — everything gets stored, only critical issues interrupt you.

**Architecture:**

```
Webhook (POST /log-classifier)
→ HTTP Request: Groq API (openai/gpt-oss-20b) — classify severity
→ Code: parse JSON response from Groq's content field
→ Switch: route by severity (critical | warning | info)
    ├── critical → Postgres INSERT → Telegram alert
    ├── warning  → Postgres INSERT
    └── info     → Postgres INSERT
```

**Key implementation details:**

- **Groq API call via HTTP Request node** — demonstrates raw API understanding and gives full control over the request body.
- **Structured JSON output:** Uses `response_format: { type: "json_object" }` and a system prompt that defines the exact schema. Temperature `0.1` for deterministic classification.
- **Response parsing:** Groq returns the classification as a JSON string inside `choices[0].message.content`. A Code node runs `JSON.parse()` and flattens the fields.
- **Cross-node data access:** The Telegram node references `$('Code in JavaScript').item.json.summary` (not `$json`) because the Postgres node's output no longer carries the classification fields forward.
- **SQL escaping:** All string fields pass through `.replace(/'/g, "''")` to escape apostrophes before INSERT.
- **Single table, three writers:** The `error_logs` table receives inserts from three separate Postgres nodes — one per severity branch.

**Stack:** n8n (self-hosted) · Groq API · Supabase (PostgreSQL) · Telegram Bot API

**Estimated impact:** Replaces manual log review. Critical alerts surface in seconds instead of during the next check.

---

### 3. Error Handler (Supporting Workflow)

Reusable error workflow that fires whenever a linked workflow fails.

**Architecture:**

```
Error Trigger (fires on linked workflow failure)
→ Gmail: send failure notification with error details
```

**Email includes:** workflow name, error message, last node executed, and a link to the failed execution in n8n.

**Problem it solves:** Silent workflow failures go unnoticed until a stakeholder asks why something didn't happen. This workflow surfaces failures within minutes, with enough context to debug without re-running the workflow.

**Why it matters:** Silent automation failures are worse than no automation.

**Estimated impact:** Catches silent failures within minutes instead of hours.

---

### 4. AF Homes Inquiry Intake — RAG Pipeline (Groq + Gemini + pgvector + Telegram)

> **Portfolio demonstration inspired by hospitality and property-developer workflows. Not affiliated with, endorsed by, or built for AF Homes.**

Event-driven inquiry pipeline: receives property inquiries via webhook, classifies category and priority with an LLM, extracts structured details, embeds the inquiry, retrieves semantically similar FAQ chunks from a pgvector store, drafts a grounded reply using retrieval-augmented generation (RAG), persists everything with a citation trail, and alerts high-priority inquiries via Telegram.

**Problem it solves:** Property developers receive inquiries across categories (bookings, VIP card questions, careers, general). Triage is manual, response drafts are repetitive, and high-value leads get missed. This workflow automates first-pass triage and produces reply drafts grounded in actual company documentation — not generic LLM output.

**Architecture:**

```
Webhook (POST /af-homes-inquiry)
→ HTTP Request: Groq — classify category + priority, extract structured fields
→ Code: parse Groq JSON response into flat fields
→ HTTP Request: Gemini gemini-embedding-001 — embed the inquiry (1536 dims)
→ Build RPC Body: Code node, formats vector as Postgres-compatible string
→ Retrieve FAQ Chunks: Postgres node, calls match_faq_chunks RPC
→ Build Draft Body: Code node, formats full request body for Groq
→ Draft Reply: HTTP Request: Groq — generates grounded reply from retrieved context
→ Execute a SQL query: Postgres INSERT into inquiries (with draft_reply + retrieved_sources)
→ If: priority == high
    ├── true  → Edit Fields → Call notify-telegram
    └── false → (end, no alert)
```

**Key implementation details:**

- **Two LLM calls per inquiry:** (1) classification + extraction with `gpt-oss-20b`, (2) reply drafting with the same model but grounded in retrieved context.
- **Embedding with Gemini `gemini-embedding-001`:** Groq doesn't offer an embeddings endpoint. Gemini's embedding API uses a different auth header (`x-goog-api-key`) than Groq's.
- **1536-dim embeddings:** `gemini-embedding-001` natively outputs 3072 dims, but pgvector's HNSW index caps at 2000. Truncated to 1536, a divisor of 3072, which balances quality and index compatibility.
- **RAG via Postgres RPC, not PostgREST:** Supabase's PostgREST layer cached the old function signature after a `CREATE OR REPLACE FUNCTION` and returned empty arrays despite the function working in the SQL Editor. Solved by calling `match_faq_chunks` directly through n8n's Postgres node instead of the Supabase HTTP endpoint.
- **Citation trail:** The `retrieved_sources` column stores a text array of the FAQ filenames used to generate the draft reply. Verify that the reply is actually grounded by inspecting this trail.
- **Precomputed request bodies in Code nodes:** Both the RPC call and the Groq draft call build their full request bodies as JSON strings in Code nodes, then send via `Body Content Type: Raw` with `={{ $json.body_string }}`. This bypasses n8n's JSON template interpolation, which flattens arrays and breaks on newlines.
- **Grounding prompt:** The system prompt explicitly says "grounded ONLY in the provided knowledge base excerpts. If the knowledge base doesn't cover the inquiry, say so politely."

**Verified behavior:** For the inquiry *"How does the reservation process work? I want to understand the steps and fees."*, the drafted reply cited:
- 2% non-refundable reservation fee (from `reservation-process.md`)
- Two valid IDs + proof of billing + Data Privacy Consent (from `document-requirements.md`)
- 20% down payment over 18 months (from `down-payment-terms.md`)
- 30-day document window and 45–60 day timeline (from `reservation-process.md`)

Every specific number was sourced from the retrieved FAQ chunks — none invented.

**Stack:** n8n (self-hosted) · Groq API (`openai/gpt-oss-20b`) · Google Gemini (`gemini-embedding-001`) · Supabase (PostgreSQL + pgvector) · Telegram Bot API

**Estimated impact:** Replaces manual inquiry triage. Grounded draft replies reduce first-response time from minutes of drafting to seconds of review.

---

### 5. AI Lead Qualification Agent (Groq + Apify + Supabase)

**Status:** Slices 1 and 2 complete. Slices 3 and 4 deferred — see Roadmap.

Event-driven workflow that receives inbound leads via webhook, enriches them with company data from Apify, uses an AI Agent to score them as high / medium / low against explicit countable criteria, and logs the score with a machine-readable audit trail to PostgreSQL.

**Problem it solves:** Manual lead triage is subjective, inconsistent, and slow. Even LLM-based scoring is unreliable when the prompt uses adjectives instead of rules. This workflow demonstrates how to make an AI agent's scoring deterministic, auditable, and defensible — a reliability engineering problem, not just a prompting problem.

**Architecture:**

```
Webhook (POST /lead-qualifier)
→ Enrich Company: HTTP Request to Apify (company-data-enricher by domain)
→ AI Agent: "Qualify Lead" — scores against 5 countable criteria
    └── Groq Chat Model: openai/gpt-oss-20b (temperature 0.0)
→ Parse Agent Output: Code node — JSON.parse + Title Case normalization + SQL escaping
→ Log Lead: Postgres INSERT into leads table
```

**The determinism fix (the strongest story in this workflow):**

The initial version used temperature 0.1 and a system prompt that described criteria with adjectives: *"enterprise company, specific request, decision-maker."* The same test payload scored **medium / medium / high** across three runs. The `high` run's reasoning invented a signal that wasn't present in the payload — *"implying the sender is a decision-maker"* — from a message that never named a role.

The fix had three parts:

1. **Temperature 0.0** — not 0.1. Deterministic greedy decoding.
2. **Countable criteria** — replaced adjectives with 5 explicit signals and a numeric threshold: `high = 2+ criteria, medium = 1, low = 0`.
3. **Strictness clause** — explicit instruction: *"Ambiguous cases lean toward the lower score, not the higher one. Do not infer signals that aren't stated."*

Result: three identical runs of the same payload now return identical scores and identical `criteria_met` arrays. Verified across 6 runs (3× medium, 3× high).

**Key implementation details:**

- **Countable criteria over adjectives.** The system prompt defines 5 signals: decision-maker role, budget/approval, company maturity (from enrichment), timeline, specific solution request. The scoring rule is arithmetic, not judgment.
- **Machine-readable audit trail.** The agent returns `criteria_met` as a JSON array of strings. Any reviewer can verify the score by counting the array — no interpretation of the LLM's prose required.
- **Enrichment via Apify's company-data-enricher.** Domain-based lookup returns LinkedIn presence, domain age, technology stack, and RDAP registration data. No paid API keys required.
- **Criterion 3 requires 2+ of 4 enrichment signals.** LinkedIn link alone doesn't pass it. This prevents a single signal from falsely flagging a company as mature.
- **Manual JSON parsing over LangChain's Structured Output Parser.** The parser rejected valid LLM output when `criteria_met` contained 4+ items. Replaced with a Code node that strips markdown fences, `JSON.parse()`s the raw string, and handles the shape in code — same pattern used in Projects 2 and 4.
- **Empty-response guard.** Transient Groq failures sometimes return an empty `content` string. The Parse Agent Output node detects this, logs the lead with `score: low` and a clear `"Classification failed"` reasoning, and avoids losing the lead entirely.
- **Title Case normalization in code, not in the prompt.** LLM casing drifted between `"SPECIFIC SOLUTION REQUEST"` and `"Specific Solution Request"` even at temperature 0. Fixed deterministically via `.replace(/\b\w/g, l => l.toUpperCase())` in the Code node.

**Verified behavior (determinism test, 2026-09-23):**

Three identical runs of a medium-signal lead with empty enrichment (`maria@acme.ph`) returned:
- `score: medium` all 3 times
- `criteria_met: ["Specific Solution Request"]` all 3 times
- `enrichment_summary.domain_age: null`

Three identical runs of a high-signal lead with enrichment (`juan@example.com` — IANA-reserved domain with populated RDAP data):
- `score: high` all 3 times
- `criteria_met: ["Decision-Maker Role", "Budget Or Approval", "Company Maturity", "Timeline", "Specific Solution Request"]` all 3 times
- `enrichment_summary.domain_age: "31 years"`

The `Company Maturity` criterion fires only when enrichment supports it. When enrichment returns empty, the criterion stays absent and the score reflects only the signals present in the message.

**Stack:** n8n (self-hosted) · Groq API (`openai/gpt-oss-20b`) · Apify (`company-data-enricher`) · Supabase (PostgreSQL) · LangChain AI Agent node

**Estimated impact:** Reduces lead triage from ~10 minutes of manual review to ~30 seconds per lead. Deterministic scoring eliminates the review-and-correct cycle that inconsistent LLM output forces.

**Gotchas specific to this workflow:**

- **LLM classification is not deterministic by default.** Temperature 0.1 is not "low enough" for consistent scores on classification tasks. Use temperature 0 for any workflow where the same input should produce the same output.
- **Adjectives in prompts produce nondeterministic scoring.** "Enterprise company, specific request, decision-maker" is subjective. Countable criteria with explicit thresholds remove the LLM's room for interpretation.
- **The AI Agent's Chat Model output may appear empty.** With the Tools Agent architecture, the model's first response is a tool call (`finish_reason: "tool_calls"`), not a text completion. The final output is the agent's parsed JSON. Don't debug the empty Chat Model output.
- **The LangChain Structured Output Parser is fragile with longer arrays.** It rejected valid JSON when `criteria_met` contained 4+ items. Manual `JSON.parse()` in a Code node is more reliable and easier to debug.
- **Nested field access on external API responses silently returns undefined.** Apify returns `domainInfo.domainAge`, not `domainAge`. Accessing the wrong path doesn't throw — it returns undefined and the criterion silently fails. Verify field paths against actual API output before wiring them into prompts.
- **Title Case normalization belongs in code, not in the prompt.** Adding "use Title Case" to the system prompt reduces but does not eliminate casing drift. Deterministic post-processing in a Code node is the correct fix.
- **Inline array expressions in n8n's Postgres Query field are fragile.** The `ARRAY[...]` construction with arrow functions and nested quotes broke silently in Project 4 and was avoided here. Precompute SQL-safe values in a Code node.
- **Empty LLM responses happen.** Guard against them explicitly. A lead with a failed classification is still a lead — log it with a failure marker rather than dropping it.
- **n8n's Header Auth credential: the "Name" field is the HTTP header key, not a display label.** Setting `Name: Apify API` produces `ERR_INVALID_HTTP_TOKEN` because spaces aren't valid in HTTP header names. Use `Name: Authorization`, `Value: Bearer <token>`. The credential's human-readable label is set separately when you name the credential during save.

---

## Repo Structure

```
workflows/      # Runtime workflows. Import these into n8n.
scripts/        # One-off setup utilities. Run once, then discard.
README.md
package.json
.env.example
```

---

## Setup

### Prerequisites

- n8n (self-hosted — install via npm or Docker)
- **GitHub notifier:** GitHub PAT with `public_repo` scope; Gmail OAuth2 credentials
- **AI Log Classifier:** Groq API key; Supabase project; Telegram bot token + chat ID
- **AF Homes Inquiry Intake:** Groq API key; Gemini API key; Supabase project with pgvector; Telegram bot token + chat ID

### Importing the workflows

1. In n8n, click **Add workflow** → **Import from File**
2. Select the JSON from `workflows/`
3. Re-link credentials (see credential list below)
4. Update placeholder values (`YOUR_PROJECT_REF`, `YOUR_TELEGRAM_CHAT_ID`, `YOUR_GROQ_API_KEY`, `YOUR_GEMINI_API_KEY`)
5. **Publish** each workflow

### Required credentials

| Credential | Type | Used in |
|-----------|------|---------|
| GitHub account | Access Token | GitHub notifier |
| Gmail account | OAuth2 | GitHub notifier, Error handler |
| Postgres account | Postgres | AI Log Classifier, AF Homes Intake |
| Telegram account | Telegram API | AI Log Classifier, AF Homes Intake, notify-telegram |
| Header Auth (Groq) | Header Auth, `Authorization: Bearer gsk_...` | AI Log Classifier, AF Homes Intake |
| Header Auth (Gemini) | Header Auth, `x-goog-api-key: ...` | AF Homes Intake |

### Supabase schema

```sql
-- AI Log Classifier
CREATE TABLE error_logs (
    id BIGSERIAL PRIMARY KEY,
    severity VARCHAR(20) NOT NULL CHECK (severity IN ('critical', 'warning', 'info')),
    summary TEXT NOT NULL,
    recommended_action TEXT NOT NULL,
    raw_message TEXT NOT NULL,
    source VARCHAR(100),
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_error_logs_severity ON error_logs(severity);
CREATE INDEX idx_error_logs_created_at ON error_logs(created_at DESC);

-- AF Homes Inquiry Intake
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE faq_chunks (
    id BIGSERIAL PRIMARY KEY,
    source TEXT NOT NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    embedding vector(1536),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_faq_chunks_embedding ON faq_chunks
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

CREATE TABLE inquiries (
    id BIGSERIAL PRIMARY KEY,
    inquiry TEXT NOT NULL,
    category TEXT NOT NULL CHECK (category IN ('booking', 'vip_card', 'careers', 'general')),
    priority TEXT NOT NULL CHECK (priority IN ('high', 'low')),
    summary TEXT NOT NULL,
    extracted_name TEXT,
    extracted_email TEXT,
    extracted_phone TEXT,
    extracted_property TEXT,
    extracted_timeline TEXT,
    draft_reply TEXT,
    retrieved_sources TEXT[],
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);
CREATE INDEX idx_inquiries_category ON inquiries(category);
CREATE INDEX idx_inquiries_priority ON inquiries(priority);
CREATE INDEX idx_inquiries_created_at ON inquiries(created_at DESC);

ALTER TABLE faq_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE inquiries ENABLE ROW LEVEL SECURITY;

-- RPC function for RAG retrieval
CREATE OR REPLACE FUNCTION match_faq_chunks(
  query_embedding vector(1536),
  match_threshold float,
  match_count int
)
RETURNS TABLE (
  id bigint, source text, title text, content text, similarity float
)
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT
    faq_chunks.id,
    faq_chunks.source,
    faq_chunks.title,
    faq_chunks.content,
    1 - (faq_chunks.embedding <=> query_embedding) AS similarity
  FROM faq_chunks
  WHERE 1 - (faq_chunks.embedding <=> query_embedding) > match_threshold
  ORDER BY faq_chunks.embedding <=> query_embedding
  LIMIT match_count;
$$;
```

### Seeding the FAQ vector store

The `scripts/` folder contains a one-off seed utility. Ingest runs outside n8n because it needs filesystem access to read local markdown files and runs once per corpus update, not on every workflow execution. Real RAG systems separate ingest from query.

```bash
# From repo root
npm install
node scripts/seed-faq.js
```

Requires `.env` at repo root:

```
GEMINI_API_KEY=your_key_here
SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_here
```

### Testing

**GitHub notifier:** Create a test issue with the `good first issue` label, click Execute Workflow, check your inbox.

**AI Log Classifier:**

```powershell
[System.IO.File]::WriteAllText("$env:TEMP\test-log.json", '{"message": "Database connection timeout after 30s", "level": "error", "source": "xirv-api", "timestamp": "2026-09-21T15:30:00Z"}')
curl.exe -X POST http://localhost:5678/webhook/log-classifier -H "Content-Type: application/json" --data-binary "@$env:TEMP\test-log.json"
```

**AF Homes Inquiry Intake:**

```powershell
[System.IO.File]::WriteAllText("$env:TEMP\af-homes-test.json", '{"inquiry": "How does the reservation process work? I want to understand the steps and fees."}')
curl.exe -X POST http://localhost:5678/webhook/af-homes-inquiry -H "Content-Type: application/json" --data-binary "@$env:TEMP\af-homes-test.json"
```

Verify in Supabase:

```sql
SELECT id, category, priority, draft_reply, retrieved_sources
FROM inquiries
ORDER BY created_at DESC
LIMIT 1;
```

---

## Design Decisions

| Decision | Rationale |
|----------|-----------|
| Self-hosted n8n (npm) over cloud | Free, unlimited executions, full control |
| Cron `0 9 * * 1-5` | Weekdays only — no weekend noise |
| Filter, not GitHub-side label filter | GitHub's issues endpoint doesn't support label filtering server-side |
| Explicit `pull_request` check | Prevents PRs from appearing as "issues" |
| Separate error workflow | Centralized failure notifications; reusable across projects |
| HTTP Request node over built-in Groq node | Demonstrates raw API understanding; full control over request body |
| `response_format: json_object` + schema in system prompt | Reliable structured output |
| Temperature 0.1 (classification), 0.3 (reply drafting) | Deterministic classification; consistent but natural-sounding replies |
| Postgres per severity branch (Log Classifier) | Enables different downstream actions per severity |
| Gemini embeddings over Groq | Groq has no embeddings endpoint; Gemini provides 1536 dims on the free tier |
| 1536 dims over 3072 | pgvector HNSW index caps at 2000 dims; 1536 is a divisor of 3072 |
| Postgres node over Supabase HTTP endpoint | PostgREST schema cache caused silent empty responses after `CREATE OR REPLACE FUNCTION` |
| Precomputed request bodies in Code nodes | Bypasses n8n's JSON template interpolation, which flattens arrays and breaks on newlines |
| 0.3 similarity threshold | Calibrated via similarity matrix of the FAQ corpus; related chunks score 0.60–1.0, unrelated score 0.40–0.60 |
| Telegram over Slack/Discord | Mobile push notifications; simplest demo |
| Ingest as script, not workflow | Batch operation; different operational requirements than query path |

## Gotchas Encountered

**n8n 2.x:**
- Renamed "Trigger Times" to "Trigger Interval" and moved timezone from Personal Settings to per-workflow settings.
- Error workflows must be published to appear in another workflow's Error Workflow dropdown.
- Requires republishing after any settings change for it to take effect on production runs.
- `$json` only references the immediate previous node's output. To reach earlier nodes, use `$('Node Name').item.json.field`.
- n8n expression interpolation flattens arrays in JSON bodies. `{{ $json.someArray }}` inside a JSON body inserts array elements without brackets, producing invalid JSON. Workaround: precompute the entire body as a JSON string in a Code node, then set the HTTP Request node to `Body Content Type: Raw` with `={{ $json.body_string }}`.
- Raw body mode treats a leading `=` as literal text. Unlike other parameter fields, the Raw body field does not need the `=` prefix — the fx toggle handles expression mode. Including `=` sends the character as part of the body.
- n8n evaluates Execute Sub-workflow node parameters in the sub-workflow's context, not the parent's. Cross-node references like `$('Parent Node')` don't resolve. Precompute values in a Set node before the Execute Sub-workflow call.

**APIs:**
- GitHub: Issues endpoint returns PRs as issues. Labels are arrays of objects, not strings.
- Groq: `llama-3.1-8b-instant` was deprecated for free tiers in August 2026. Migrated to `openai/gpt-oss-20b`.
- Groq: Response body wraps the actual JSON in a string at `choices[0].message.content`. Needs `JSON.parse()`. The `reasoning` field is ignored.
- Groq does not offer an embeddings endpoint. Use Gemini or another provider for embeddings.
- Gemini `text-embedding-004` is deprecated. Current model is `gemini-embedding-001`.
- Gemini embedding API uses `x-goog-api-key` header, not `Authorization: Bearer`.
- Supabase: The session pooler connection string uses `postgres.[project-ref]` as the username, not just `postgres`.
- Supabase: Requires **Ignore SSL Issues** enabled in n8n's Postgres credential — the pooler's certificate chain isn't trusted by default.
- Supabase PostgREST caches function signatures. After `CREATE OR REPLACE FUNCTION`, PostgREST may still route calls to the old signature, returning empty arrays silently. Fix: `notify pgrst, 'reload schema'`, or bypass PostgREST entirely with n8n's Postgres node.

**pgvector:**
- HNSW index caps at 2000 dimensions. `gemini-embedding-001`'s native output is 3072 dims, exceeding the limit. Use `outputDimensionality: 1536` on the Gemini call — a divisor of 3072, well within the limit.
- Truncated embeddings produce lower similarity scores than expected. At 768 dims, related chunks scored 0.72 (uncomfortably close to unrelated). At 1536 dims, related chunks score 0.78–1.0 with clear separation from unrelated.
- `array_fill(0.01, 768)` produces a degenerate vector with near-zero similarity to all zero-mean embeddings. Use a real embedding for threshold calibration, not a synthetic one.

**PowerShell / Windows:**
- `Out-File -Encoding utf8` writes a BOM that JSON parsers reject. Use `[System.IO.File]::WriteAllText` for clean UTF-8.
- `curl` in PowerShell is an alias for `Invoke-WebRequest`. Use `curl.exe` explicitly.
- Sending JSON inline with `-d` mangles quotes. Write the body to a file and use `--data-binary @file.json`.
- `Resolve-DnsName` needs a bare hostname, not a URL with `https://`.

## Roadmap

- [ ] Add support for multiple repositories (GitHub notifier)
- [ ] Migrate SQL string escaping to parameterized queries (`$1`, `$2`) to prevent injection
- [ ] Add Slack/Discord notification options alongside Telegram
- [ ] Deploy to VPS for 24/7 operation (currently runs when local machine is on)
- [ ] Add AI-powered issue summarization to the GitHub notifier using Groq
- [ ] Add a REST API endpoint in XIRV that emits logs directly to the webhook
- [ ] Build a simple dashboard (React) that queries `error_logs` and `inquiries`
- [ ] Expand FAQ corpus and re-calibrate similarity threshold as corpus grows
- [ ] Extract `notify-telegram` into a fully reusable sub-workflow (currently duplicated across workflows)
- [ ] **AI Lead Qualification Agent — Slice 3:** Route leads by score. High → HubSpot deal + Telegram alert. Medium → Airtable nurture list + scheduled follow-up. Low → Supabase only. Integrates two new business tools (HubSpot, Airtable) and introduces conditional branching based on the agent's scoring output.
- [ ] **AI Lead Qualification Agent — Slice 4:** Personalized response email drafting. Extend the agent's output schema to include a `draft_reply` field grounded in the enrichment data and the lead's original message. Log the draft to Supabase; optionally send via Gmail for high-scoring leads.
- [ ] **Calibrate the Company Maturity threshold with a real corpus.** The current "2 of 4 enrichment signals" threshold was validated against two test domains. Re-calibrate against 20–30 real domains spanning actual company sizes to confirm the threshold discriminates correctly.

## About

Built by [Henson Brix Arroyo](https://hensonbrix-portfolio.vercel.app) — Full-Stack Developer transitioning into AI Automation.

- GitHub: [@Xhenzouu](https://github.com/Xhenzouu)
- Portfolio: [hensonbrix-portfolio.vercel.app](https://hensonbrix-portfolio.vercel.app)
- Email: arroyobrix@gmail.com

## License

MIT
