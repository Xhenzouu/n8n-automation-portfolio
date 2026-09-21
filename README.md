# n8n Automation Portfolio

Production-ready automation workflows built with self-hosted n8n, integrating GitHub, Gmail, Groq (LLM), Supabase (PostgreSQL), and Telegram.

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
- **Error handling:** Linked to a dedicated error workflow that emails the failure details (see below).

**Estimated impact:** ~5 minutes saved per manual check × ~22 weekdays = **~110 minutes/month saved**.

**Stack:** n8n (self-hosted) · GitHub REST API · Gmail API (OAuth2)

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

- **Groq API call via HTTP Request node** (not the built-in Groq node) — demonstrates raw API understanding and gives full control over the request body.
- **Structured JSON output:** Uses `response_format: { type: "json_object" }` and a system prompt that defines the exact schema. Temperature set to `0.1` for deterministic classification.
- **Response parsing:** Groq returns the classification as a JSON *string* inside `choices[0].message.content`. A Code node runs `JSON.parse()` and flattens the fields.
- **Cross-node data access:** The Telegram node references `$('Code in JavaScript').item.json.summary` (not `$json`) because the Postgres node's output no longer carries the classification fields forward.
- **SQL escaping:** All string fields pass through `.replace(/'/g, "''")` to escape apostrophes in log messages before INSERT.
- **Single table, three writers:** The `error_logs` table receives inserts from three separate Postgres nodes — one per severity branch.
- **Conditional alerting:** Telegram only fires on the critical branch. Warnings and info logs are stored silently.

**Estimated impact:** Replaces manual log review. Critical issues surface in seconds instead of during the next check.

**Stack:** n8n (self-hosted) · Groq API (`openai/gpt-oss-20b`) · Supabase (PostgreSQL) · Telegram Bot API

---

### 3. Error Handler (Supporting Workflow)

Reusable error workflow that fires whenever a linked workflow fails.

**Architecture:**

```
Error Trigger (fires on linked workflow failure)
→ Gmail: send failure notification with error details
```

**Email includes:**
- Workflow name that failed
- Error message
- Last node that executed
- Link to the failed execution in n8n

**Why it matters:** Silent automation failures are worse than no automation. This workflow ensures that if the GitHub notifier breaks (API changes, expired token, etc.), I know within minutes.

---

## Setup

### Prerequisites

- n8n (self-hosted — install via npm or Docker)
- **GitHub notifier:** GitHub Personal Access Token with `public_repo` scope; Gmail account with OAuth2 credentials (Google Cloud project with Gmail API enabled)
- **AI Log Classifier:** Groq API key (free at `console.groq.com/keys`); Supabase project with an `error_logs` table; Telegram bot token + chat ID

### Importing the workflows

1. In n8n, click **Add workflow** → **Import from File**
2. Select the JSON from `workflows/`
3. Re-link credentials:
   - **GitHub node:** create a new GitHub credential with your PAT
   - **Gmail node:** create a new Gmail OAuth2 credential via Google Cloud
   - **Postgres node:** create a Postgres credential using Supabase connection details
   - **Telegram node:** create a Telegram credential with your bot token
   - **HTTP Request (Groq):** create a Header Auth credential with `Authorization: Bearer YOUR_GROQ_API_KEY`
4. Update placeholder values:
   - GitHub: **Repository Owner** and **Repository Name**
   - Telegram: **chatId** → replace `YOUR_TELEGRAM_CHAT_ID` with your numeric chat ID
5. **Publish** each workflow

### Supabase table schema

```sql
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
```

### Testing

**GitHub notifier:**

1. Create a test issue in your target repo with the `good first issue` label
2. Click **Execute Workflow** on the main workflow
3. Check your inbox for the notification email

**AI Log Classifier:**

```bash
curl.exe -X POST http://localhost:5678/webhook/log-classifier \
  -H "Content-Type: application/json" \
  --data-binary '@test-log.json'
```

Test payloads (save as `test-log.json`, `test-warning.json`, `test-info.json`):

```json
{"message": "Database connection timeout after 30s", "level": "error", "source": "xirv-api", "timestamp": "2026-09-21T15:30:00Z"}
```

```json
{"message": "Slow query detected: 2.3s for user fetch", "level": "warn", "source": "xirv-api", "timestamp": "2026-09-21T15:31:00Z"}
```

```json
{"message": "User logged in successfully", "level": "info", "source": "xirv-api", "timestamp": "2026-09-21T15:32:00Z"}
```

Verify:
- All three payloads insert rows into `error_logs`
- Only the critical payload triggers a Telegram message

**Error handler:** Add a **Stop And Error** node after the Schedule Trigger in the GitHub notifier, publish, wait for the next run.

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
| `response_format: json_object` + schema in system prompt | Reliable structured output; eliminates parsing errors |
| Temperature 0.1 | Deterministic classification, not creative writing |
| Postgres per severity branch | Enables different downstream actions (alerts vs. silent storage) |
| Telegram over Slack/Discord | Mobile push notifications; simplest demo to show on phone |

## Gotchas Encountered

**n8n 2.x:**
- Renamed "Trigger Times" to "Trigger Interval" and moved timezone from Personal Settings to per-workflow settings.
- Error workflows must be published to appear in another workflow's Error Workflow dropdown.
- Requires republishing after any settings change for it to take effect on production runs.
- `$json` only references the immediate previous node's output. To reach earlier nodes, use `$('Node Name').item.json.field`. This bit us in the Telegram node — it saw only Postgres's `{success: true}` response, not the parsed classification.

**APIs:**
- GitHub: Issues endpoint returns PRs as issues. Labels are arrays of objects, not strings.
- Groq: `llama-3.1-8b-instant` was deprecated for free tiers in August 2026. Migrated to `openai/gpt-oss-20b`. Hardcoded model IDs are fragile — monitor provider deprecation notices.
- Groq: Response body wraps the actual JSON in a string at `choices[0].message.content`. Needs `JSON.parse()`. The `reasoning` field (returned by gpt-oss models) is ignored.
- Supabase: The session pooler connection string uses `postgres.[project-ref]` as the username, not just `postgres`. Uses IPv4 proxy so it works on Windows.
- Supabase: Requires **Ignore SSL Issues** enabled in n8n's Postgres credential — the pooler's certificate chain isn't trusted by default.

**PowerShell / Windows:**
- `Out-File -Encoding utf8` writes a BOM that JSON parsers reject. Use `[System.IO.File]::WriteAllText` for clean UTF-8.
- `curl` in PowerShell is an alias for `Invoke-WebRequest`. Use `curl.exe` explicitly for actual curl behavior.
- Sending JSON inline with `-d` mangles quotes. Write the body to a file and use `--data-binary @file.json`.

## Roadmap

- [ ] Add support for multiple repositories (GitHub notifier)
- [ ] Migrate SQL string escaping to parameterized queries (`$1`, `$2`) to prevent injection
- [ ] Add Slack/Discord notification option alongside Telegram
- [ ] Deploy to VPS for 24/7 operation (currently runs when local machine is on)
- [ ] Add AI-powered issue summarization to the GitHub notifier using Groq
- [ ] Add a REST API endpoint in XIRV that emits logs directly to the webhook
- [ ] Build a simple dashboard (React) that queries `error_logs` for the last 7 days

## About

Built by [Henson Brix Arroyo](https://hensonbrix-portfolio.vercel.app) — Full-Stack Developer transitioning into AI Automation.

- GitHub: [@Xhenzouu](https://github.com/Xhenzouu)
- Portfolio: [hensonbrix-portfolio.vercel.app](https://hensonbrix-portfolio.vercel.app)
- Email: arroyobrix@gmail.com

## License

MIT
