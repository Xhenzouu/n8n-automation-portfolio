# n8n Automation Portfolio

Production-ready automation workflows built with self-hosted n8n, integrating GitHub, Gmail, and error monitoring.

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

### 2. Error Handler (Supporting Workflow)

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
- GitHub Personal Access Token with `public_repo` scope
- Gmail account with OAuth2 credentials (Google Cloud project with Gmail API enabled)

### Importing the workflows

1. In n8n, click **Add workflow** → **Import from File**
2. Select `workflows/github-good-first-issue-notifier.json`
3. Re-link credentials:
   - **GitHub node:** create a new GitHub credential with your PAT
   - **Gmail node:** create a new Gmail OAuth2 credential via Google Cloud
4. Update the **Repository Owner** and **Repository Name** fields to your target repo
5. Repeat for `workflows/error-handler.json`
6. In the main workflow's **Settings**, set the Error Workflow to `Error Handler`
7. **Publish** both workflows

### Testing

1. Create a test issue in your target repo with the `good first issue` label
2. Click **Execute Workflow** on the main workflow
3. Check your inbox for the notification email
4. To test the error handler: add a **Stop And Error** node after the Schedule Trigger, publish, wait for the next run

---

## Design Decisions

| Decision | Rationale |
|----------|-----------|
| Self-hosted n8n (npm) over cloud | Free, unlimited executions, full control |
| Cron `0 9 * * 1-5` | Weekdays only — no weekend noise |
| Filter, not GitHub-side label filter | GitHub's issues endpoint doesn't support label filtering server-side |
| Explicit `pull_request` check | Prevents PRs from appearing as "issues" |
| Separate error workflow | Centralized failure notifications; reusable across projects |

## Gotchas Encountered

- **n8n 2.x renamed "Trigger Times" to "Trigger Interval"** and moved timezone out of Personal Settings into per-workflow settings.
- **Error workflows must be published** to appear in the Error Workflow dropdown of another workflow.
- **n8n 2.x requires republishing** after changing workflow settings for changes to apply on scheduled runs.
- **GitHub API returns labels as objects** (`[{ name: 'good first issue', ... }]`), not strings — `.includes()` won't work, `.some(l => l.name === ...)` does.

## Roadmap

- [ ] Add support for multiple repositories
- [ ] Add Slack/Discord notification option alongside email
- [ ] Deploy to VPS for 24/7 operation (currently runs when local machine is on)
- [ ] Add AI-powered issue summarization using Groq

## About

Built by [Henson Brix Arroyo](https://hensonbrix-portfolio.vercel.app) — Full-Stack Developer transitioning into AI Automation.

- GitHub: [@Xhenzouu](https://github.com/Xhenzouu)
- Portfolio: [hensonbrix-portfolio.vercel.app](https://hensonbrix-portfolio.vercel.app)
- Email: arroyobrix@gmail.com

## License

MIT
