# n8n Automation Portfolio

Production-ready automation workflows built with self-hosted n8n. Integrates GitHub, Gmail, Groq (LLM), Google Gemini (embeddings), Supabase (PostgreSQL + pgvector), and Telegram.

## Quick Tour

Ten production-quality workflows. Each teaches a distinct architecture pattern. Click a workflow for its architecture, verified behavior, screenshots, and gotchas.

| # | Workflow | Pattern |
|---|----------|---------|
| 1 | [GitHub Good First Issue Notifier](docs/workflows/01-github-notifier.md) | Scheduled poll → filter → email |
| 2 | [AI Log Classifier](docs/workflows/02-ai-log-classifier.md) | Webhook → LLM classify → conditional Telegram alert |
| 3 | [Error Handler](docs/workflows/03-error-handler.md) | Cross-workflow failure notification |
| 4 | [AF Homes Inquiry Intake](docs/workflows/04-af-homes-inquiry-intake.md) | RAG pipeline with vector search and grounded reply drafting |
| 5 | [AI Lead Qualification Agent](docs/workflows/05-ai-lead-qualification-agent.md) | Deterministic LLM scoring with machine-readable audit trail |
| 6 | [Invoice Processing Pipeline](docs/workflows/06-invoice-processing-pipeline.md) | PDF extraction + 3-branch validation with per-status routing |
| 7 | [Customer Support Agent](docs/workflows/07-customer-support-agent.md) | Conversational AI agent with tool calling and persistent memory |
| 8 | [Human-in-the-Loop Approval](docs/workflows/08-human-in-the-loop-approval.md) | AI refinement + Telegram inline keyboard approval |
| 9 | [MCP Integration Server](docs/workflows/09-mcp-integration-server.md) | n8n workflows exposed as tools for Claude Code |
| 10 | [Workflow Health Monitor](docs/workflows/10-workflow-health-monitor.md) | Cross-workflow failure classification + retry + Telegram escalation |

**Stack:** n8n (self-hosted) · Groq · Google Gemini · Apify · Supabase (PostgreSQL + pgvector) · Telegram · Gmail · GitHub REST API

---

## Repo Structure

```
workflows/      # Runtime workflows. Import these into n8n.
scripts/        # One-off setup utilities. Run once, then discard.
mcp-server/     # Node.js MCP server exposing n8n workflows as tools.
docs/
  workflows/    # One markdown file per workflow (01 to 10).
  images/       # Screenshots referenced by the workflow docs (wf01-*.png ... wf10-*.png, claude-code-*.png).
.mcp.json       # Claude Code MCP config. Uses relative path to mcp-server.
README.md
package.json
.env.example
```

The `mcp-server/` folder contains its own `package.json` and dependencies. Install them separately with `cd mcp-server && npm install`.

---

## Setup

### Prerequisites

- n8n (self-hosted — install via npm or Docker)
- A Supabase project (free tier sufficient) with the extensions and tables listed below
- Free API keys: [Groq](https://console.groq.com/keys), [Google Gemini](https://aistudio.google.com/apikey), [Apify](https://console.apify.com/account/integrations)
- A Telegram bot (create via @BotFather) with the bot token and your chat ID
- GitHub Personal Access Token with `public_repo` scope
- Gmail OAuth2 credentials (Google Cloud project with Gmail API enabled)

### Importing the workflows

1. In n8n, click **Add workflow** → **Import from File**
2. Select the JSON from `workflows/`
3. Re-link credentials (see credential list below)
4. Update placeholder values in each workflow:
   - `YOUR_PROJECT_REF` — your Supabase project ref
   - `YOUR_TELEGRAM_CHAT_ID` — your numeric chat ID
   - `YOUR_GROQ_API_KEY` — your Groq key
   - `YOUR_GEMINI_API_KEY` — your Gemini key
   - `YOUR_APIFY_TOKEN` — your Apify API token
5. **Publish** each workflow

[Workflow 9](docs/workflows/09-mcp-integration-server.md) requires the `summary-digest` workflow to be imported and published. The MCP server's `get_summary` tool calls this workflow's webhook.

### Sub-workflow import order

Two sub-workflows exist in this portfolio: `notify-telegram` and `escalate-and-notify`. Both are referenced by parent workflows via internal n8n IDs, which are instance-specific.

When importing workflows that reference a sub-workflow:

1. Import the sub-workflow JSON first (`notify-telegram.json` or `escalate-and-notify.json`)
2. Open it in n8n and click **Publish**
3. Import the parent workflow JSON second
4. Open the parent workflow, locate the tool or node that references the sub-workflow
5. Change its workflow dropdown to the newly imported sub-workflow
6. Save and publish the parent workflow

Workflows that use sub-workflows:

| Parent workflow | Sub-workflow required |
|-----------------|----------------------|
| [Customer Support Agent](docs/workflows/07-customer-support-agent.md) | `escalate-and-notify` |
| [AF Homes Inquiry Intake](docs/workflows/04-af-homes-inquiry-intake.md) | `notify-telegram` |
| [AI Log Classifier](docs/workflows/02-ai-log-classifier.md) | `notify-telegram` |
| [AI Lead Qualification Agent](docs/workflows/05-ai-lead-qualification-agent.md) | `notify-telegram` |
| [Invoice Processing Pipeline](docs/workflows/06-invoice-processing-pipeline.md) | `notify-telegram` (or direct Telegram Send) |
| [Human-in-the-Loop Approval](docs/workflows/08-human-in-the-loop-approval.md) | none (paired with `approval-callback-handler`) |
| Approval Callback Handler | none (companion to `human-in-the-loop-approval`) |
| [Workflow Health Monitor](docs/workflows/10-workflow-health-monitor.md) | none (top-level; monitors all other workflows) |
| Workflow Incident Callback Handler | none (companion to `workflow-health-monitor`) |
| [GitHub Good First Issue Notifier](docs/workflows/01-github-notifier.md) | none |
| [Error Handler](docs/workflows/03-error-handler.md) | none |

Workflows 8 and 10 each use a two-workflow pattern rather than a sub-workflow. Workflow 8 requires `human-in-the-loop-approval.json` and `approval-callback-handler.json`. Workflow 10 requires `workflow-health-monitor.json` and `workflow-incident-callback-handler.json`. Callback handler workflows must be published before testing their parent workflow, or button clicks will not fire.

### External integrations

Some workflows are called by external processes rather than by other n8n workflows.

| Workflow | Called by |
|----------|-----------|
| AI Lead Qualification Agent | `mcp-server/index.js` via webhook |
| Summary Digest | `mcp-server/index.js` via webhook |
| Multi-System Lead Orchestration (planned) | AI Lead Qualification Agent via HTTP |

### Required credentials

| Credential | Type | Used in |
|-----------|------|---------|
| GitHub account | Access Token | GitHub notifier |
| Gmail account | OAuth2 | GitHub notifier, Error handler |
| Postgres account | Postgres | AI Log Classifier, AF Homes Intake, Lead Qualification, Invoice Processing |
| Telegram account | Telegram API | All workflows using notifications |
| Header Auth (Groq) | Header Auth, `Authorization: Bearer gsk_...` | AI Log Classifier, AF Homes Intake, Lead Qualification, Invoice Processing |
| Header Auth (Gemini) | Header Auth, `x-goog-api-key: ...` | AF Homes Intake |
| Header Auth (Apify) | Header Auth, `Authorization: Bearer apify_api_...` | Lead Qualification |

### Supabase schema

Run all of these in the Supabase SQL Editor, in order.

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

-- AI Lead Qualification Agent
CREATE TABLE leads (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  company TEXT,
  message TEXT NOT NULL,
  score TEXT NOT NULL CHECK (score IN ('high', 'medium', 'low')),
  criteria_met TEXT[],
  reasoning TEXT NOT NULL,
  enrichment_summary JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_leads_score ON leads(score);
CREATE INDEX idx_leads_created_at ON leads(created_at DESC);

-- Invoice Processing Pipeline
CREATE TABLE vendors (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  tax_id TEXT,
  contact_email TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE invoices (
  id BIGSERIAL PRIMARY KEY,
  vendor_id BIGINT REFERENCES vendors(id),
  vendor_name TEXT NOT NULL,
  invoice_number TEXT,
  amount NUMERIC(12, 2),
  currency VARCHAR(3),
  invoice_date DATE,
  due_date DATE,
  line_items_summary TEXT,
  status VARCHAR(20) NOT NULL CHECK (status IN ('valid', 'suspicious', 'invalid')),
  status_reasons TEXT[],
  source_chat_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);
CREATE INDEX idx_invoices_status ON invoices(status);
CREATE INDEX idx_invoices_vendor_id ON invoices(vendor_id);
CREATE INDEX idx_invoices_created_at ON invoices(created_at DESC);

-- Enable RLS on all tables
ALTER TABLE error_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE faq_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE inquiries ENABLE ROW LEVEL SECURITY;
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendors ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
```

Workflows 7, 8, and 10 also use `orders`, `shipping`, `escalations`, `draft_approvals`, and `workflow_incidents` tables, plus the auto-created `n8n_chat_histories` table.

### Seeding the databases

Two one-off seed scripts live in `scripts/`. Both run outside n8n because they need filesystem access and execute once per corpus update, not per workflow execution.

```bash
# From repo root
npm install

# Seed FAQ vector store (Workflow 4)
node scripts/seed-faq.js

# Seed vendor reference table (Workflow 6)
# Run scripts/seed-vendors.sql in the Supabase SQL Editor
```

FAQ seeding requires `.env` at repo root:

```
GEMINI_API_KEY=your_key_here
SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_here
```

### Testing each workflow

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

**AI Lead Qualification Agent:**

```powershell
[System.IO.File]::WriteAllText("$env:TEMP\lead-test.json", '{"name": "Maria Santos", "email": "maria@acme.ph", "company": "Acme Corp", "message": "We need an enterprise automation solution for our sales team."}')
curl.exe -X POST http://localhost:5678/webhook/lead-qualifier -H "Content-Type: application/json" --data-binary "@$env:TEMP\lead-test.json"
```

**Invoice Processing Pipeline:** Send a PDF invoice to your Telegram bot. The workflow fires on message receipt.

Verify each workflow's output:

```sql
-- AI Log Classifier
SELECT id, severity, summary FROM error_logs ORDER BY created_at DESC LIMIT 1;

-- AF Homes Inquiry Intake
SELECT id, category, priority, draft_reply, retrieved_sources FROM inquiries ORDER BY created_at DESC LIMIT 1;

-- AI Lead Qualification Agent
SELECT id, name, score, criteria_met, enrichment_summary FROM leads ORDER BY created_at DESC LIMIT 1;

-- Invoice Processing Pipeline
SELECT id, vendor_name, status, status_reasons FROM invoices ORDER BY created_at DESC LIMIT 1;
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
| `response_format: json_object` + schema in system prompt | Reliable structured output on Groq |
| Temperature 0.1 (classification), 0.3 (reply drafting), 0.0 (deterministic scoring) | Deterministic where accuracy matters; natural-sounding where readability matters |
| Postgres per severity branch (Log Classifier) | Enables different downstream actions per severity |
| Gemini embeddings over Groq | Groq has no embeddings endpoint; Gemini provides 1536 dims on the free tier |
| 1536 dims over 3072 | pgvector HNSW index caps at 2000 dims; 1536 is a divisor of 3072 |
| Postgres node over Supabase HTTP endpoint | PostgREST schema cache caused silent empty responses after `CREATE OR REPLACE FUNCTION` |
| Precomputed request bodies in Code nodes | Bypasses n8n's JSON template interpolation, which flattens arrays and breaks on newlines |
| 0.3 similarity threshold | Calibrated via similarity matrix; related chunks score 0.60–1.0, unrelated score 0.40–0.60 |
| Telegram over Slack/Discord | Mobile push notifications; simplest demo |
| Ingest as script, not workflow | Batch operation; different operational requirements than query path |
| Countable criteria over adjectives (Lead Qualification) | Adjectives produce nondeterministic scoring. Arithmetic thresholds with explicit signals eliminate interpretation. |
| Manual JSON.parse over LangChain Structured Output Parser (Lead Qualification) | Parser rejected valid output when arrays contained 4+ items. Code node is more reliable and debuggable. |
| Title Case normalization in code, not in the prompt | LLM casing drifts even at temperature 0. Deterministic post-processing in a Code node is the correct fix. |
| Empty-response guard on LLM calls | Transient Groq failures return empty strings. Log a sentinel row instead of dropping data. |
| PDF text extraction before AI (Invoice Processing) | `Extract from PDF` reads the text layer natively. AI receives plain text, not binary. Eliminates multimodal complexity. |
| Three-branch validation with explicit rules (Invoice Processing) | Valid / suspicious / invalid classification with a machine-readable `status_reasons` array. Every invoice is persisted for audit, including rejections. |
| Precomputed SQL with `esc()` and `num()` helpers | Inline string interpolation produces `'null'` for DATE columns. Helper functions emit the SQL keyword `NULL` unquoted for null values. |
| Telegram Trigger + Download for PDF intake (Invoice Processing) | The trigger downloads the file binary directly. No separate "Get File" node needed. |

## Gotchas Encountered

Portfolio-wide gotchas. Workflow-specific gotchas live in each [workflow file](docs/workflows/).

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
- [ ] **Invoice Processing Pipeline — OCR support:** Current pipeline handles text-layer PDFs only. Scanned documents return empty or garbled text. Add OCR step (Tesseract or an API) for image-based invoices.
- [ ] **Invoice Processing Pipeline — Amount formatting:** Telegram messages render amounts as `PHP 15750` without thousand separators or decimal places. Format via `toLocaleString()` in a Code node or a message template helper.
- [ ] **Invoice Processing Pipeline — Admin routing:** Currently all Telegram notifications go to the submitting chat. Add a `routing_config` table mapping vendor IDs to specific admin chats for multi-user deployments.
- [ ] **Invoice Processing Pipeline — Duplicate detection:** The validation logic doesn't check for duplicate invoice numbers from the same vendor. Add a Postgres lookup before insert to flag or reject duplicates.
- [ ] **Customer Support Agent — Multi-language support:** Detect customer language and instruct the agent to reply in the same language. Useful for Philippine customers who message in Tagalog or Taglish.
- [ ] **Customer Support Agent — Escalation priority and SLA:** Add a `priority` field to the `escalations` table (low, medium, high). Route high-priority escalations to a separate admin chat. Add SLA timers that re-alert if no human response within a threshold.
- [ ] **Customer Support Agent — Human agent reply routing:** Currently escalations notify the admin but don't route the human's reply back to the customer. Add a flow where the admin replies in Telegram and the workflow forwards the message to the original customer chat.
- [ ] **Customer Support Agent — Tool for warranty and returns:** Add a fourth tool for warranty claims and return processing. Demonstrates how the agent handles a growing tool library without prompt changes.
- [ ] **Human-in-the-Loop Approval — Edit path:** When the human clicks Edit, re-run the AI Agent with the original draft and the human's edit notes. Loop back to the approval step until the human approves or rejects.
- [ ] **Human-in-the-Loop Approval — Publish endpoint:** When the human clicks Approve, POST the refined draft to a real publishing endpoint (WordPress, Ghost, a custom API). Currently only the decision is logged; the approved draft isn't sent anywhere.
- [ ] **Separate Telegram bots per workflow:** Currently all workflows with inbound Telegram Triggers share the XIRV Log Alerts bot, which limits one webhook at a time. Create a distinct bot per workflow via BotFather and register separate credentials in n8n. This eliminates the "most recently published wins" conflict.
- [ ] **MCP Integration Server — Streaming responses:** For long-running tools, use MCP's streaming response pattern instead of a single JSON blob. Useful if `score_lead` is refactored to wait for the actual score rather than returning the webhook acknowledgment.
- [ ] **MCP Integration Server — Authentication on tools:** Add an API key or OAuth requirement to the tools so they aren't callable by any local process. Currently the server trusts whatever process spawns it.
- [ ] **MCP Integration Server — Additional tools:** Expose more n8n workflows. Candidates: `list_open_issues` (GitHub Notifier), `get_invoice` (query the invoices table by ID), `recent_errors` (query error_logs by severity).
- [ ] **MCP Integration Server — VPS deployment:** Move the server and n8n to a VPS with a stable public URL. Removes the tunnel dependency and makes the MCP server reachable from remote Claude Code sessions.
- [ ] **MCP Integration Server — HTTP transport:** Add HTTP Streamable transport as an alternative to stdio. Enables remote clients to connect without spawning a local process.
- [ ] **Workflow Health Monitor:** see the [deferred list](docs/workflows/10-workflow-health-monitor.md#roadmap-deferred).
- [ ] **Future workflows (planned):** Multi-System Lead Orchestration (HubSpot + Airtable + Google Calendar, triggered from the AI Lead Qualification Agent) and an Ops Dashboard (cross-workflow aggregation and reporting).

## About

Built by [Henson Brix Arroyo](https://hensonbrix-portfolio.vercel.app) — Full-Stack Developer transitioning into AI Automation.

- GitHub: [@Xhenzouu](https://github.com/Xhenzouu)
- Portfolio: [hensonbrix-portfolio.vercel.app](https://hensonbrix-portfolio.vercel.app)
- Email: arroyobrix@gmail.com

## License

MIT