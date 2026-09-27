# XIRV MCP Server

Exposes n8n automation workflows as MCP tools for Claude Code and any other MCP-compatible client.

## Overview

This is a small Node.js server that speaks the Model Context Protocol (MCP) over stdio. It exposes two tools that proxy requests to n8n webhooks:

| Tool | What it does | Backing workflow |
|------|--------------|------------------|
| `score_lead` | Accepts a lead payload (name, email, company, message) and returns an AI classification with score, criteria met, and reasoning. | AI Lead Qualification Agent |
| `get_summary` | Returns a status digest across all automation data: lead counts, invoice counts, recent errors. | Summary Digest |

The MCP server is a thin wrapper. All business logic lives in n8n. The server's job is to translate MCP tool calls into HTTP POST requests and return the response.

## Prerequisites

- **Node.js 20 or newer.** Check with `node --version`. The MCP SDK requires a modern runtime.
- **n8n running with the webhooks published.** The AI Lead Qualification Agent and Summary Digest workflows must be active.
- **A public tunnel URL for n8n.** Cloudflare Tunnel or ngrok. Webhook URLs must be publicly reachable.

## Setup

### 1. Install dependencies

```powershell
cd mcp-server
npm install
```

### 2. Create the `.env` file

Copy the example and edit it:

```powershell
Copy-Item .env.example .env
```

Edit `.env` and set both URLs to your current tunnel URL:

```
N8N_WEBHOOK_URL=https://YOUR_TUNNEL_URL.trycloudflare.com/webhook/lead-qualifier
N8N_SUMMARY_WEBHOOK_URL=https://YOUR_TUNNEL_URL.trycloudflare.com/webhook/summary-digest
```

**Do not commit `.env`.** It is gitignored. The repo ships `.env.example` with placeholder values.

### 3. Verify the tunnel and webhooks

Before starting the server, confirm both webhooks are reachable:

```powershell
[System.IO.File]::WriteAllText("$env:TEMP\empty.json", '{}')
curl.exe -X POST https://YOUR_TUNNEL_URL.trycloudflare.com/webhook/summary-digest -H "Content-Type: application/json" --data-binary "@$env:TEMP\empty.json"
```

Expected: a JSON response with lead and invoice counts. If you get a 404, the workflow is not published or the tunnel URL is stale.

## Running with MCP Inspector (development)

The MCP Inspector is the official tool for testing MCP servers. It provides a web UI to list tools, call them with arguments, and see responses.

From the `mcp-server/` directory:

```powershell
npx @modelcontextprotocol/inspector node index.js
```

The terminal prints a URL like `http://localhost:6274/?MCP_PROXY_AUTH_TOKEN=...`. Open it in a browser.

In the Inspector UI:

| Field | Value |
|-------|-------|
| **Transport Type** | STDIO |
| **Command** | `node` |
| **Arguments** | `index.js` |
| **Environment Variables** | leave blank |

Click **Connect**. The **Tools** tab lists both tools. Select a tool, provide arguments (or none), and click **Call Tool**.

**Note:** the Inspector's working directory is wherever you run `npx` from. Run it from inside `mcp-server/` so `index.js` resolves correctly.

## Running standalone (for Claude Code)

For actual use with Claude Code, the server runs as a child process spawned by Claude Code itself. Do not start it manually.

**Do not run this if you are also using the Inspector.** Only one process can bind to the stdio channel.

For manual testing outside the Inspector:

```powershell
cd mcp-server
node index.js
```

The server starts and waits on stdio. You will not see output because all logs go to stderr, and stderr is captured by the parent process. To see startup logs, redirect stderr:

```powershell
node index.js 2>&1 | Out-Host
```

Press `Ctrl+C` to stop.

## Registering with Claude Code

The repo root contains `.mcp.json`, which registers this server at project scope. When you run `claude` from the repo root, Claude Code reads the file and spawns the server automatically.

**On first use, Claude Code asks for approval** because the server definition comes from a repository file. Approve it once per project. Approval persists in `~/.claude.json`.

To verify the registration:

```powershell
cd D:\projects\n8n-automation-portfolio
claude mcp list
```

Expected output:

```
xirv-mcp-server: node mcp-server/index.js - ✓ Connected
```

Inside a Claude Code session, run `/mcp` to see tool availability.

**If the server shows as "Pending approval":** start an interactive session with `claude` and approve the trust dialog.

**If `.mcp.json` uses an absolute path:** the path is specific to the author's machine. Edit `.mcp.json` and replace the path with your local path to `mcp-server/index.js` before launching Claude Code.

## URL validation behavior

The server validates both webhook URLs at startup. If any check fails, it prints a `[FATAL]` message to stderr and exits with code 1.

The five checks:

1. The environment variable is set (not undefined or empty)
2. The URL starts with `https://`
3. The URL does not contain a doubled `https://https://` prefix
4. The URL does not contain `//webhook/` (a doubled slash before the path)
5. The URL contains `/webhook/` somewhere in the path

Successful startup logs:

```
[STARTUP] N8N_WEBHOOK_URL validated: https://...
[STARTUP] N8N_SUMMARY_WEBHOOK_URL validated: https://...
XIRV MCP Server running on stdio
```

`[FATAL]` example:

```
[FATAL] N8N_WEBHOOK_URL must start with https://. Got: http://localhost...
```

Fix the `.env` file and restart.

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `[FATAL] ... is not set` | `.env` missing or variable name misspelled | Copy `.env.example` to `.env` and fill in both URLs |
| `[FATAL] ... must start with https://` | URL uses `http://` or has a leading space | Fix the URL in `.env` |
| `[FATAL] ... doubled https:// prefix` | URL pasted with `https://https://` | Remove the extra prefix |
| `[FATAL] ... doubled slash before /webhook/` | URL contains `.com//webhook/` | Remove the extra slash |
| Server starts but tool returns `404` | Tunnel URL changed or workflow not published | Update `.env` with the current tunnel URL. Verify the workflow is published in n8n. |
| Server starts but tool returns `ECONNREFUSED` | n8n not running or tunnel down | Start n8n with `n8n start` and restart the Cloudflare tunnel |
| `No MCP servers configured` in Claude Code | `.mcp.json` not in the current directory | Run `claude` from the repo root, not from a subdirectory |
| Claude Code shows "Pending approval" | Project-scoped MCP server not yet trusted | Run `claude` interactively and approve the trust prompt |
| `get_summary` returns stale counts | n8n workflow cached | The workflow runs fresh on every call. If counts look wrong, check the Supabase tables directly. |
| `score_lead` returns `{"message":"Workflow was started"}` | Webhook responds immediately; scoring is async | Expected. The score appears in the `leads` table a few seconds later. Use `get_summary` to confirm the lead count increased. |

## Environment file reference

`.env` is loaded with an explicit path relative to the script location, not the current working directory. This makes the server work regardless of where it is spawned from.

```javascript
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '.env') });
```

If you ever move the server or restructure the folder, this pattern keeps `.env` loading correct.

## Layout

```
mcp-server/
├── index.js           # Server code: tool definitions, validation, transport
├── package.json       # Dependencies
├── package-lock.json  # Locked dependency versions
├── .env               # Local config (gitignored)
├── .env.example       # Template (committed)
├── README.md          # This file
└── HOW-TO-RUN.md      # Quick-start reference
```