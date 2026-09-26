# MCP Server: How to Run

## Development and Testing

    cd D:\projects\mcp-server
    npx @modelcontextprotocol/inspector node index.js

Then open the Inspector URL in a browser. Configure STDIO, command `node`, args `index.js`, click Connect.

## Production (Claude Code integration)

1. Start the server standalone:

        cd D:\projects\mcp-server
        node index.js

2. In a separate terminal, register with Claude Code:

        claude mcp add xirv-mcp -- node D:\projects\mcp-server\index.js

3. In Claude Code, verify the server is connected:

        /mcp

## Important Notes

- Do not run standalone and Inspector modes at the same time. Only one process can bind to stdio.
- The Inspector spawns its own child process. Disconnect kills it. Connect re-spawns it.
- Environment variables in the Inspector override hardcoded values in index.js. If you move the URL to env vars, set them in the Inspector's Environment Variables section.
- All server logs go to stderr (console.error), not stdout. Do not use console.log in server code.