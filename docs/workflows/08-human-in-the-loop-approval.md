# Workflow 8: Human-in-the-Loop Approval (Groq + Supabase + Telegram Inline Keyboard)

[← Back to README](../../README.md)

**Status:** v1.0.0 published. Edit loop, publish endpoint, and separate-bot isolation deferred to [Roadmap](../../README.md#roadmap).
**Companion workflow:** [Approval Callback Handler](./08b-approval-callback-handler.md)

## Problem

Content teams and marketing workflows need human oversight before publishing AI-generated content. This two-workflow system has an AI Agent refine a submitted draft (tone, clarity, length), then lets a human approve, reject, or request edits via Telegram inline keyboard buttons, without leaving Telegram. The decision is logged to Supabase and a confirmation is sent back to the reviewer. Every decision is auditable.

## Architecture

Two workflows.

Parent workflow (`human-in-the-loop-approval.json`):

```
Webhook (POST /draft-approval)
→ AI Agent "Refine Draft" (Groq openai/gpt-oss-20b, temperature 0.3)
    └── Groq Chat Model sub-node
→ Insert Draft (Postgres INSERT ... RETURNING id)
→ Send for Approval (Telegram Send Message with Inline Keyboard: Approve / Reject / Edit)
```

Callback handler workflow (`approval-callback-handler.json`, published):

```
Telegram Trigger (Callback Query)
→ Acknowledge Click (Telegram Answer Query)
→ Log Decision (Postgres UPDATE draft_approvals)
→ Send Confirmation (Telegram Send Message to the original chat)
```

## Key implementation details

- **Two-workflow design over the Wait node.** The Wait node approach requires storing a resume URL in Supabase, calling it from the callback handler, and handling timeouts. Here, Telegram callback queries arrive as new webhook events and the handler updates the database row directly. Same user experience, less machinery.
- **Draft row created before the Telegram send.** The parent inserts the draft into `draft_approvals` first. `RETURNING id` provides the row ID, which is embedded in each button's `callback_data` as `decision:id`.
- **Inline keyboard with dynamic callback data.** Buttons carry `approve:42`, `reject:42`, `edit:42`. The handler splits on `:` to extract the decision and row ID.
- **Answer Query acknowledges the click.** Telegram requires the bot to acknowledge callback queries within 10 seconds. Without the node, the button shows a spinner until it times out.
- **Audit trail per decision.** Every draft is persisted with its original and refined versions. Every decision is stamped with `decided_at` and `decided_by` (the reviewer's Telegram user ID).

## Verified behavior

Tested 2026-09-25:

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

![Telegram message with Approve / Reject / Edit buttons](../images/wf08-approval-message.png)

![Supabase draft_approvals row with decision=approve and decided_by set](../images/wf08-decision-log.png)

## Stack

n8n (self-hosted) · Groq API (`openai/gpt-oss-20b`) · Supabase (PostgreSQL) · Telegram Bot API (inline keyboard + callback query)

## Gotchas

- **Only one Telegram Trigger can hold a bot's webhook at a time.** If multiple workflows use Telegram Triggers with the same bot, the most recently published one wins and the others silently stop firing. Fix: one bot per workflow with an inbound trigger, created via BotFather with its own n8n credential.
- **`$json` is replaced after Telegram Answer Query.** It returns `{ok: true, result: true}`. Use `$('Telegram Trigger').first().json.callback_query.*` downstream.
- **`callback_data` has a 64-byte limit.** `decision:id` fits comfortably; don't pack more into it.
- **Telegram markdown parsing.** Draft text containing `*`, `_`, or `[` may be interpreted as formatting. Set Parse Mode to `None` on the Send Message node if drafts may contain them.
- **Callback queries are a distinct event type.** The Telegram Trigger's `Trigger On` must include `Callback Query` or button clicks won't fire the workflow.
- **A known n8n bug stops callback queries from firing when Restrict to Chat IDs is populated.** Leave that field blank for workflows that receive button clicks.
- **Publish the callback handler before testing the parent,** or button clicks will not fire.

## Estimated impact

Reduces content approval turnaround from email threads and Slack messages to a single Telegram button click. Every decision is logged with full context for audit.

## Deferred

- Edit loop: when `decision = 'edit'`, re-run the refinement with the human's edit notes.
- Publish path: when `decision = 'approve'`, POST the refined draft to a real publishing endpoint.
- Separate Telegram bots per workflow to eliminate webhook conflicts.

## Monitored by

[Workflow 10: Workflow Health Monitor](./10-workflow-health-monitor.md)