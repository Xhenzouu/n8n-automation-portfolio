# n8n Automation Portfolio

Production-ready automation workflows built with self-hosted n8n. Integrates GitHub, Gmail, Groq (LLM), Google Gemini (embeddings), Supabase (PostgreSQL + pgvector), and Telegram.

## Quick Tour

Eight production-quality workflows. Each teaches a distinct architecture pattern. Full details below.

| # | Workflow | Pattern |
|---|----------|---------|
| 1 | GitHub Good First Issue Notifier | Scheduled poll → filter → email |
| 2 | AI Log Classifier | Webhook → LLM classify → conditional Telegram alert |
| 3 | Error Handler | Cross-workflow failure notification |
| 4 | AF Homes Inquiry Intake | RAG pipeline with vector search and grounded reply drafting |
| 5 | AI Lead Qualification Agent | Deterministic LLM scoring with machine-readable audit trail |
| 6 | Invoice Processing Pipeline | PDF extraction + 3-branch validation with per-status routing |
| 7 | Customer Support Agent | Conversational AI agent with tool calling and persistent memory |
| 8 | Human-in-the-Loop Approval | AI refinement + Telegram inline keyboard approval |

**Stack:** n8n (self-hosted) · Groq · Google Gemini · Apify · Supabase (PostgreSQL + pgvector) · Telegram · Gmail · GitHub REST API

---

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

### 6. Invoice Processing Pipeline (Groq + Supabase + Telegram)

**Status:** v1.0.0 published. OCR support and amount formatting deferred to roadmap.

Event-driven invoice processing pipeline: receives PDF invoices via Telegram, extracts text from the PDF, uses an LLM to pull structured fields, validates the vendor against a reference table, classifies the invoice as valid / suspicious / invalid, and routes to one of three branches with distinct Postgres persistence and Telegram notifications.

**Problem it solves:** Manual invoice entry is slow and error-prone. Vendor fraud, duplicate submissions, and typo'd amounts go unnoticed until they reach accounting. This workflow automates first-pass invoice intake with a rule-based validation layer, produces an audit trail for every submission (including rejections), and alerts the submitter with context-specific messaging.

**Architecture:**

```
Telegram Trigger (receives PDF document)
→ Extract PDF Text (read text layer from binary)
→ Build Groq Body (Code node, precompute JSON body)
→ Extract Fields with Groq (structured field extraction)
→ Parse Invoice Fields (Code node, JSON.parse + validate schema)
→ Look Up Vendor (Postgres SELECT against vendors table)
→ Compute Validation Status (Code node, apply rules)
→ Build Invoice SQL (Code node, precompute SQL string with null handling)
→ Route by Status (Switch on status field)
    ├── valid       → Insert Valid Invoice (Postgres) → Send Valid Confirmation (Telegram)
    ├── suspicious  → Insert Suspicious Invoice (Postgres) → Send Suspicious Warning (Telegram)
    └── invalid     → Insert Invalid Invoice (Postgres) → Send Rejection (Telegram)
```

**Key implementation details:**

- **Telegram as input surface.** The Telegram Trigger node receives PDF documents directly. No file upload endpoint needed. The trigger's "Download Images/Files" option fetches the binary and exposes it as `binary.data`.
- **PDF text extraction before AI.** `Extract from PDF` reads the text layer natively. The AI Agent receives plain text, not binary. This eliminates the multimodal complexity and keeps the extraction step deterministic.
- **Structured field extraction with Groq.** Fields extracted: `vendor_name`, `invoice_number`, `amount`, `currency`, `invoice_date`, `due_date`, `line_items_summary`. `response_format: json_object` forces valid JSON. Temperature 0 for determinism.
- **Vendor validation against a reference table.** The `vendors` table contains the canonical list of approved vendors. Lookup is case-insensitive and escapes SQL metacharacters to prevent injection from LLM-extracted text.
- **Three-branch classification with explicit rules.** Valid = vendor found, active, positive amount, valid currency, coherent dates. Suspicious = valid vendor but one of: amount exceeds threshold, non-PHP currency, dates in wrong order, or future invoice date. Invalid = vendor not found, inactive, or missing required fields. Precedence: invalid > suspicious > valid.
- **Machine-readable audit trail.** Every invoice is written to the `invoices` table regardless of status. The `status_reasons` array documents exactly why an invoice was flagged. Reviews and audits can query by status without re-running the workflow.
- **Precomputed SQL with null handling.** The `Build Invoice SQL` Code node uses `esc()` and `num()` helper functions that emit the SQL keyword `NULL` unquoted for null values. This replaced inline string interpolation, which broke on the DATE columns when the LLM extracted null for `invoice_date` or `due_date`.
- **Three-branch routing.** The Switch node reads a `status` field computed by the upstream Code node. Each branch has its own Postgres Insert and Telegram Send, with distinct message text.

**Verified behavior (2026-09-24):**

Three test invoices processed end-to-end:

| Input | Vendor lookup | Classification | Result |
|-------|--------------|----------------|--------|
| Acme Office Supplies, PHP 15,750 | Found, active | valid | Inserted, confirmation sent |
| Acme Office Supplies, USD 250 | Found, active | suspicious (non-PHP currency) | Inserted, warning sent |
| Fictional Corp Pty Ltd., USD 500 | Not found | invalid (vendor not found) | Inserted, rejection sent |

Supabase `invoices` table contains one row per status after cleanup, confirming all three branches persist data.

**Stack:** n8n (self-hosted) · Groq API (`openai/gpt-oss-20b`) · Telegram Bot API · Supabase (PostgreSQL)

**Estimated impact:** Replaces manual first-pass invoice triage. Reduces per-invoice processing from ~5 minutes of manual entry and validation to under 10 seconds of automated processing plus a Telegram review notification for suspicious and invalid cases.

**Gotchas specific to this workflow:**

- **The `Extract from PDF` node fails silently on scanned PDFs.** Image-only PDFs return an empty string or garbled text instead of an error. There is no validation that the extracted text is meaningful. Workflows handling PDFs should validate the extraction output before passing it downstream. For scanned documents, add an OCR step with a separate tool.
- **The `Extract from PDF` node returns more than just text.** Output includes PDF metadata: `numpages`, `info.PDFFormatVersion`, `info.Author`, `info.Creator`, `info.Language`, plus the `text` field. Useful for logging, but be aware the output shape is larger than expected.
- **`Extract from File` does not validate the extracted text.** A 117 kB text-layer PDF and a corrupted PDF both produce output the node doesn't validate. Add downstream checks if PDF quality matters.
- **Nested field access on external API responses silently returns undefined.** The `Extract from PDF` node returns metadata at `info.Author` and `info.Creator` (nested), while the text is at the top-level `text` field. Verify field paths before referencing them.
- **Multi-line PDF text breaks inline JSON body interpolation.** The same trap from Project 4 and Project 5. The fix is a `Build Groq Body` Code node that precomputes the full JSON body via `JSON.stringify()` and sends it as Raw. Same pattern across all three workflows.
- **Nullable fields in SQL string interpolation produce `'null'` (quoted string) instead of the SQL keyword `NULL`.** Postgres rejects `'null'` for DATE columns. Fix: precompute the full INSERT as a string in a Code node with helper functions that emit `NULL` unquoted for null values.
- **`$json` after a Postgres Insert node refers to `{success: true}`, not the input data.** All downstream references (Telegram message fields) must reach back to an earlier node via `$('Node Name').first().json.field`. Fourth occurrence of this trap across the portfolio.
- **Telegram Trigger uses webhooks, which require a publicly reachable HTTPS URL in production.** Test mode uses n8n's tunnel; production requires a VPS, Cloudflare Tunnel, or a similar stable ingress. The n8n `--tunnel` flag is deprecated and non-functional in v2.
- **The `Always Output Data` setting is required on Postgres nodes whose SELECT may return zero rows.** Without it, an empty result terminates the workflow before downstream branches can handle the "not found" case.
- **Groq's `response_format: json_object` mode does not accept a JSON Schema.** The schema must be communicated via the prompt. Unlike OpenAI's Structured Outputs, Groq validates only that output is valid JSON, not that it matches a specific shape.

---

### 7. Customer Support Agent with Tool Calling (Groq + Supabase + Telegram)

**Status:** v1.0.0 published. Multi-language support, SLA priority, and human-agent reply routing deferred to roadmap.

Conversational Telegram support agent where an LLM decides which tool to call based on the customer's message. Three tools available: order lookup, shipping lookup, and escalation to a human agent. Persistent conversation memory across messages. Sub-workflow used as a tool demonstrates the agentic pattern that job listings mean by "AI Agents."

**Problem it solves:** Support teams waste time on repetitive lookup questions ("where is my order?") while complex issues get lost. This workflow automates the lookup path, resolves simple questions instantly, and escalates complex cases to a human with full context — including the customer's chat ID and the reason for escalation.

**Architecture:**

```
Telegram Trigger (receives customer message)
→ AI Agent "Support Agent"
    ├── Groq Chat Model: openai/gpt-oss-20b (temperature 0)
    ├── Postgres Chat Memory (session_key = Telegram chat ID)
    └── Tool connector:
        ├── lookup_order (Postgres Tool, SELECT against orders)
        ├── lookup_shipping (Postgres Tool, JOIN orders + shipping)
        └── escalate_to_human (Call n8n Workflow Tool → escalate-and-notify)
→ (AI Agent produces grounded reply)
→ Telegram Trigger already routes the reply via the agent's response
```

**Sub-workflow `escalate-and-notify`:**

```
Execute Sub-workflow Trigger (reason, order_number, chat_id)
→ Postgres INSERT into escalations
→ Telegram Send to admin chat
→ Edit Fields (returns confirmation string to the parent)
```

**Key implementation details:**

- **Three tools, each with a specific purpose.** The agent's tool selection is driven by the `Description` field on each tool node. If descriptions overlap, the agent calls the wrong tool. Clear, non-overlapping descriptions produce correct selection.
- **`lookup_order`** takes `order_number` and returns status, items, total, order date.
- **`lookup_shipping`** takes `order_number` (not tracking number — customers don't know those) and JOINs `shipping` to `orders` to return carrier, location, estimated delivery, status.
- **`escalate_to_human`** uses the Call n8n Workflow Tool pattern. The agent calls this tool with `reason` and `order_number` (both from `$fromAI()`), plus `chat_id` from the Telegram Trigger context. The sub-workflow handles the database write and admin notification.
- **Sub-workflow as tool is the portfolio differentiator.** The agent treats the composite capability as one tool. Any future change to escalation (add Slack, add a ticket system, add priority logic) happens in the sub-workflow without touching the agent.
- **Persistent memory via Postgres Chat Memory.** The `session_key` is the Telegram chat ID, so each customer gets their own conversation history. Memory persists across n8n restarts. The agent remembers context across messages: "What is the status of that order?" resolves to the order number mentioned in the previous turn.
- **Temperature 0** for tool selection. Reasoning models might pick different tools based on subtle phrasing at higher temperatures. Temperature 0 makes tool selection deterministic.
- **System prompt includes operational rules:** currency is PHP, dates use ISO format, ask for order number if not provided.

**Verified behavior (2026-09-24):**

| Test | Message | Tool called | Result |
|------|---------|-------------|--------|
| A | "What is the status of order ORD-2026-002?" | `lookup_order` | Reply includes order status, items, total |
| B | "When will my order ORD-2026-001 arrive?" | `lookup_shipping` | Reply includes LBC carrier, Manila Hub location, 2026-09-25 delivery estimate |
| C | "This is unacceptable. I want to speak to a manager about order ORD-2026-005." | `escalate_to_human` | Row inserted into `escalations`, admin Telegram notification delivered |
| D | Message 1: "My order number is ORD-2026-001" / Message 2: "What is the status of that order?" | `lookup_order` (from memory) | Reply resolves "that order" to ORD-2026-001 without re-prompting |

All four tests verify: correct tool selection, correct parameter extraction via `$fromAI()`, grounded replies from tool results, and persistent conversation memory.

**Stack:** n8n (self-hosted) · Groq API (`openai/gpt-oss-20b`) · Supabase (PostgreSQL) · Telegram Bot API · Postgres Chat Memory · LangChain AI Agent node with tool calling

**Estimated impact:** Replaces first-line support triage for order and shipping inquiries. Simple lookups resolve in under 10 seconds without human intervention. Complex cases escalate with full context (reason, order number, chat ID) in the same time window.

**Gotchas specific to this workflow:**

- **Tool descriptions drive agent behavior more than prompts.** The `Description` field on each tool node is what the LLM reads when deciding which tool to call. Vague or overlapping descriptions cause wrong-tool selection. Tighten descriptions before tweaking the system prompt.
- **Sub-workflow trigger node default name is `When Executed by Another Workflow`, not `Execute Sub-workflow Trigger`.** Expressions in the sub-workflow that reference the trigger by name break if you assume the wrong default. Either rename the node or update every reference.
- **Sub-workflows must be published to be callable.** The Call n8n Workflow Tool node shows an empty dropdown if the target sub-workflow is unpublished. Publish the sub-workflow before wiring the parent.
- **Sub-workflow references use instance-specific IDs.** The parent workflow JSON contains a hardcoded `workflowId` reference to the sub-workflow. Importing the parent JSON on a different n8n instance leaves a dangling reference. The README Setup section documents the import order and re-linking steps.
- **Postgres Chat Memory table schema differs from expectations.** The auto-created `n8n_chat_histories` table has columns `id`, `session_id`, `message` (jsonb). There is no `created_at` column. Order by `id DESC` for chronological queries.
- **LLM date reformatting can shift dates by one day.** Even with the system prompt instructing "use ISO format exactly as returned by tools," the model rendered `2026-09-15` as `2026-09-14` in one test. Root cause is likely timezone conversion during the model's date parsing. Cosmetic issue, not a data corruption issue.
- **Sub-workflow trigger nodes need explicit input fields defined.** Clicking "Execute step" on the trigger without providing inputs produces `undefined` values in downstream nodes. Test the sub-workflow from the parent workflow, not in isolation, unless you manually provide all input values.

---

### 8. Human-in-the-Loop Approval (Groq + Supabase + Telegram Inline Keyboard)

**Status:** v1.0.0 published. Edit loop, publish endpoint, and separate-bot isolation deferred to roadmap.

Two-workflow approval system where an AI Agent refines a submitted draft and a human approves, rejects, or requests edits via Telegram inline keyboard buttons. The decision is logged to Supabase and a confirmation is sent back to the reviewer.

**Problem it solves:** Content teams and marketing workflows need human oversight before publishing AI-generated content. This workflow automates the refinement step (tone, clarity, length) and provides a structured approval interface without leaving Telegram. Every decision is auditable.

**Architecture:**

Two workflows:

```
Parent workflow (human-in-the-loop-approval.json):
Webhook (POST /draft-approval)
→ AI Agent "Refine Draft" (Groq openai/gpt-oss-20b, temperature 0.3)
    └── Groq Chat Model sub-node
→ Insert Draft (Postgres INSERT ... RETURNING id)
→ Send for Approval (Telegram Send Message with Inline Keyboard: Approve / Reject / Edit)
```

```
Callback handler workflow (approval-callback-handler.json, published):
Telegram Trigger (Callback Query)
→ Acknowledge Click (Telegram Answer Query)
→ Log Decision (Postgres UPDATE draft_approvals)
→ Send Confirmation (Telegram Send Message to the original chat)
```

**Key implementation details:**

- **Two-workflow design over Wait node.** The Wait node approach requires storing a resume URL in Supabase, calling it from the callback handler, and handling timeouts. The two-workflow pattern is simpler: Telegram callback queries arrive as new webhook events, and the callback handler updates the database row directly. Same user experience, less machinery.
- **Draft row created before Telegram send.** The parent workflow inserts the draft into `draft_approvals` before sending to Telegram. The `RETURNING id` clause provides the row ID. That ID is embedded in each button's `callback_data` as `decision:id`.
- **Inline keyboard with dynamic callback data.** The Approve / Reject / Edit buttons each carry a different `callback_data` value: `approve:42`, `reject:42`, `edit:42`. The callback handler splits on `:` to extract the decision and the row ID.
- **Answer Query node acknowledges the click.** Telegram requires the bot to acknowledge callback queries within 10 seconds. Without the `Answer Query` node, the button shows a spinner to the user until it times out.
- **Audit trail per decision.** Every draft is persisted with its original and refined versions. Every decision is stamped with `decided_at` and `decided_by` (the Telegram user ID of the reviewer).

**Verified behavior (2026-09-25):**

| Step | Result |
|------|--------|
| POST a casual draft to /draft-approval | Webhook received, workflow started |
| AI Agent refines the draft | Tone and clarity improved; casual language normalized |
| Insert Draft (Postgres RETURNING id) | Row inserted with id=1 |
| Telegram Send with inline keyboard | Message delivered with three buttons |
| Human clicks Approve | Callback query received by callback handler |
| Answer Query | Button loading indicator cleared |
| Postgres UPDATE | Row updated: decision=approve, decided_by=YOUR_TELEGRAM_CHAT_ID |
| Telegram Send confirmation | Confirmation message delivered to reviewer |

**Stack:** n8n (self-hosted) · Groq API (`openai/gpt-oss-20b`) · Supabase (PostgreSQL) · Telegram Bot API (inline keyboard + callback query)

**Estimated impact:** Reduces content approval turnaround from email threads and Slack messages to a single Telegram button click. Every decision is logged with full context for audit.

**Gotchas specific to this workflow:**

- **Only one Telegram Trigger can hold a bot's webhook at a time.** If multiple workflows use Telegram Triggers with the same bot, the most recently published one wins. Others silently stop firing. Fix: use a separate bot per workflow with an inbound trigger. Create each via BotFather and add a distinct credential in n8n.
- **The `$json` reference is replaced after Telegram Answer Query.** The Answer Query node returns `{ok: true, result: true}`, which overwrites `$json` for downstream nodes. All references to the callback query data must use `$('Telegram Trigger').first().json.callback_query.*`.
- **`callback_data` has a 64-byte limit.** The `decision:id` format fits comfortably, but do not pack additional data into it. Telegram rejects buttons whose callback_data exceeds 64 bytes.
- **Telegram inline keyboard markdown parsing.** If the draft text contains markdown characters (`*`, `_`, `[`), Telegram may interpret them as formatting. Set Parse Mode to `None` on the Send Message node if drafts may contain these characters.
- **Callback queries arrive as a distinct event type.** The Telegram Trigger's `Trigger On` setting must include `Callback Query` for the callback handler. If it's set to `Message` only, button clicks will not fire the workflow.
- **A known n8n bug causes callback queries to not fire when the Restrict to Chat IDs field is populated.** Leave that field blank for workflows that receive button clicks.

**Deferred:**
- Edit loop (when `decision = 'edit'`, re-run the refinement with the human's edit notes)
- Publish path (when `decision = 'approve'`, POST the refined draft to a real publishing endpoint)
- Separate Telegram bots per workflow to eliminate webhook conflicts

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
| Customer Support Agent | `escalate-and-notify` |
| AF Homes Inquiry Intake | `notify-telegram` |
| AI Log Classifier | `notify-telegram` |
| AI Lead Qualification Agent | `notify-telegram` |
| Invoice Processing Pipeline | `notify-telegram` (or direct Telegram Send) |
| Human-in-the-Loop Approval | none (paired with `approval-callback-handler`) |
| Approval Callback Handler | none (companion to `human-in-the-loop-approval`) |
| GitHub Good First Issue Notifier | none |
| Error Handler | none |

Workflow 8 uses a two-workflow pattern rather than a sub-workflow. Both `human-in-the-loop-approval.json` and `approval-callback-handler.json` must be imported. The callback handler must be published before testing the parent workflow, or button clicks will not fire.

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

### Seeding the databases

Two one-off seed scripts live in `scripts/`. Both run outside n8n because they need filesystem access and execute once per corpus update, not per workflow execution.

```bash
# From repo root
npm install

# Seed FAQ vector store (Project 4)
node scripts/seed-faq.js

# Seed vendor reference table (Project 6)
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
- [ ] **Workflows 9-10 (planned):** Multi-System Orchestration (HubSpot + Airtable + Google Calendar) and Ops Dashboard (cross-workflow aggregation and reporting).

## About

Built by [Henson Brix Arroyo](https://hensonbrix-portfolio.vercel.app) — Full-Stack Developer transitioning into AI Automation.

- GitHub: [@Xhenzouu](https://github.com/Xhenzouu)
- Portfolio: [hensonbrix-portfolio.vercel.app](https://hensonbrix-portfolio.vercel.app)
- Email: arroyobrix@gmail.com

## License

MIT
