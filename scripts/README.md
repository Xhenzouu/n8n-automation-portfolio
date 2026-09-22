# Setup Utilities

One-off scripts for initializing the AF Homes Inquiry Intake workflow. These are not part of the runtime path — they run once per setup, or once per corpus update.

## Why scripts live outside n8n

The FAQ ingest is a batch operation with different requirements than the query path:

- It needs filesystem access to read local markdown files
- It runs once, not on a schedule
- Its failure mode is different (bad markdown structure → parse error, not a runtime error)

Real RAG systems separate ingest from query for these reasons. The n8n workflow only handles retrieval — the interesting part.

## Files

- `faq/` — source markdown files (8 topics, ~100-200 words each)
- `seed-faq.js` — reads markdown, chunks by H2, embeds via Gemini, inserts into Supabase `faq_chunks`

## Running

```bash
npm install
node scripts/seed-faq.js
