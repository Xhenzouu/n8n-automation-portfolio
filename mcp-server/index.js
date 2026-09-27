import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import dotenv from "dotenv";

// Load environment variables from .env
dotenv.config();

// --- CONFIGURATION ---
const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL;
const N8N_SUMMARY_WEBHOOK_URL = process.env.N8N_SUMMARY_WEBHOOK_URL;

// --- STARTUP VALIDATION ---
function validateWebhookUrl(name, url) {
  if (!url) {
    console.error(`[FATAL] ${name} is not set. Check mcp-server/.env`);
    process.exit(1);
  }
  if (!url.startsWith("https://")) {
    console.error(`[FATAL] ${name} must start with https://. Got: ${url}`);
    process.exit(1);
  }
  if (url.includes("https://https://")) {
    console.error(`[FATAL] ${name} contains a doubled https:// prefix. Got: ${url}`);
    process.exit(1);
  }
  if (url.includes("//webhook/")) {
    console.error(`[FATAL] ${name} contains a doubled slash before /webhook/. Got: ${url}`);
    process.exit(1);
  }
  if (!url.includes("/webhook/")) {
    console.error(`[FATAL] ${name} must contain /webhook/. Got: ${url}`);
    process.exit(1);
  }
}

validateWebhookUrl("N8N_WEBHOOK_URL", N8N_WEBHOOK_URL);
validateWebhookUrl("N8N_SUMMARY_WEBHOOK_URL", N8N_SUMMARY_WEBHOOK_URL);

console.error(`[STARTUP] N8N_WEBHOOK_URL validated: ${N8N_WEBHOOK_URL}`);
console.error(`[STARTUP] N8N_SUMMARY_WEBHOOK_URL validated: ${N8N_SUMMARY_WEBHOOK_URL}`);

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
          "Content-Type": "application/json"
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

// --- TOOL: get_summary ---
server.tool(
  "get_summary",
  // No input parameters
  {},
  // Handler function
  async () => {
    console.error(`[get_summary] Fetching summary from workflow`);

    try {
      const response = await fetch(N8N_SUMMARY_WEBHOOK_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({})
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[get_summary] Webhook failed with status ${response.status}: ${errorText}`);
        return {
          content: [{ type: "text", text: `Error: Summary workflow returned ${response.status}` }],
          isError: true
        };
      }

      const data = await response.json();
      console.error(`[get_summary] Summary retrieved:`, JSON.stringify(data));

      const resultText = typeof data === 'object' ? JSON.stringify(data, null, 2) : String(data);

      return {
        content: [{ type: "text", text: resultText }]
      };

    } catch (error) {
      console.error(`[get_summary] Fetch error:`, error);
      return {
        content: [{ type: "text", text: `Error: Could not connect to summary workflow. ${error.message}` }],
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