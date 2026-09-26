import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import dotenv from "dotenv";

// Load environment variables from .env
dotenv.config();

// --- CONFIGURATION ---
const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL;

// --- STARTUP VALIDATION ---
// Fail fast if the URL is malformed. This catches the four URL bugs seen during development.
if (!N8N_WEBHOOK_URL) {
  console.error("[FATAL] N8N_WEBHOOK_URL is not set. Check mcp-server/.env");
  process.exit(1);
}

if (!N8N_WEBHOOK_URL.startsWith("https://")) {
  console.error(`[FATAL] N8N_WEBHOOK_URL must start with https://. Got: ${N8N_WEBHOOK_URL}`);
  process.exit(1);
}

if (N8N_WEBHOOK_URL.includes("https://https://")) {
  console.error(`[FATAL] N8N_WEBHOOK_URL contains a doubled https:// prefix. Got: ${N8N_WEBHOOK_URL}`);
  process.exit(1);
}

if (N8N_WEBHOOK_URL.includes("//webhook/")) {
  console.error(`[FATAL] N8N_WEBHOOK_URL contains a doubled slash before /webhook/. Got: ${N8N_WEBHOOK_URL}`);
  process.exit(1);
}

if (!N8N_WEBHOOK_URL.includes("/webhook/")) {
  console.error(`[FATAL] N8N_WEBHOOK_URL must contain /webhook/. Got: ${N8N_WEBHOOK_URL}`);
  process.exit(1);
}

console.error(`[STARTUP] N8N_WEBHOOK_URL validated: ${N8N_WEBHOOK_URL}`);

// --- SERVER SETUP ---
const server = new McpServer({
  name: "xirv-mcp-server",
  version: "1.0.0"
});

// --- TOOL: score_lead ---
server.tool(
  "score_lead",
  // Input schema using Zod
  {
    name: z.string().describe("The lead's full name"),
    email: z.string().email().describe("The lead's email address"),
    company: z.string().describe("The lead's company name"),
    message: z.string().describe("The lead's message or inquiry")
  },
  // Handler function
  async ({ name, email, company, message }) => {
    // Use console.error for logging, NEVER console.log (corrupts stdio)
    console.error(`[score_lead] Received lead: ${name} (${email}) from ${company}`);

    try {
      const response = await fetch(N8N_WEBHOOK_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(N8N_API_KEY && { "Authorization": `Bearer ${N8N_API_KEY}` })
        },
        body: JSON.stringify({ name, email, company, message })
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[score_lead] Webhook failed with status ${response.status}: ${errorText}`);
        return {
          content: [{ type: "text", text: `Error: Workflow returned ${response.status}` }],
          isError: true
        };
      }

      const data = await response.json();
      console.error(`[score_lead] Webhook success:`, JSON.stringify(data));

      // The n8n workflow returns the AI's structured JSON.
      // We stringify it so the LLM can read it.
      const resultText = typeof data === 'object' ? JSON.stringify(data, null, 2) : String(data);

      return {
        content: [{ type: "text", text: resultText }]
      };

    } catch (error) {
      console.error(`[score_lead] Fetch error:`, error);
      return {
        content: [{ type: "text", text: `Error: Could not connect to workflow. ${error.message}` }],
        isError: true
      };
    }
  }
);

// --- START SERVER ---
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("XIRV MCP Server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});