import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer as createHttpServer } from "node:http";
import { randomUUID } from "node:crypto";
import { execSync } from "child_process";

import { HUB_URL, API_KEY, AGENT_ID, agentState } from "./lib/config.js";
import { reportToHub, fetchPropertyFromHub } from "./lib/hub.js";
import { handleOAuthRoute } from "./lib/oauth.js";

import * as agentTools from "./tools/agent.js";
import * as assetTools from "./tools/assets.js";
import * as inboxTools from "./tools/inbox.js";
import * as eventTools from "./tools/events.js";
import * as receptionTools from "./tools/reception.js";
import * as taskTools from "./tools/tasks.js";
import * as dtoTools from "./tools/dto.js";

const server = new McpServer({ name: "agent-visualizer", version: "1.0.0" });

agentTools.register(server);
assetTools.register(server);
inboxTools.register(server);
eventTools.register(server);
receptionTools.register(server);
taskTools.register(server);
dtoTools.register(server);

async function main() {
  const httpPort = process.env.MCP_HTTP_PORT ? parseInt(process.env.MCP_HTTP_PORT) : null;

  if (httpPort) {
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => randomUUID() });
    await server.connect(transport);

    const httpServer = createHttpServer(async (req, res) => {
      try {
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "content-type, mcp-session-id, authorization");
        if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

        if (await handleOAuthRoute(req, res)) return;

        if (API_KEY && req.headers.authorization !== `Bearer ${API_KEY}`) {
          res.writeHead(401, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Unauthorized" })); return;
        }

        let body: unknown;
        if (req.method === "POST") {
          const chunks: Buffer[] = [];
          req.on("data", (chunk: Buffer) => chunks.push(chunk));
          await new Promise<void>(r => req.on("end", r));
          const raw = Buffer.concat(chunks).toString();
          body = raw ? JSON.parse(raw) : undefined;
        }
        await transport.handleRequest(req, res, body);
      } catch (err) {
        console.error("[mcp-http] Request error:", err);
        if (!res.headersSent) { res.writeHead(500); res.end(); }
      }
    });

    httpServer.listen(httpPort, "0.0.0.0", () => {
      console.error(`[agent-visualizer] MCP HTTP server on port ${httpPort}`);
    });
    await reportToHub("idle", "Connected via HTTP MCP");
  } else {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error(`[agent-visualizer] MCP server connected via stdio`);
    console.error(`[agent-visualizer] Reporting to hub at ${HUB_URL} as "${agentState.name}" (${AGENT_ID})`);
    await reportToHub("idle", "Agent connected");
    try {
      const property = await fetchPropertyFromHub();
      const residents = (property.residents as { id: string; name: string }[] | undefined) || [];
      for (const r of residents) {
        await reportToHub("idle", "Waiting", r.id, r.name, AGENT_ID);
        console.error(`[agent-visualizer] Registered resident "${r.name}" (${r.id})`);
      }
    } catch (err) {
      console.error("[agent-visualizer] Could not fetch property for residents:", err);
    }
  }
}

async function cleanup() {
  try {
    await fetch(`${HUB_URL}/api/agents/${encodeURIComponent(AGENT_ID)}`, {
      method: "DELETE",
      headers: { ...(API_KEY && { Authorization: `Bearer ${API_KEY}` }) },
    });
    console.error(`[agent-visualizer] Removed agent ${AGENT_ID} from hub`);
  } catch {}
}

process.on("SIGINT", async () => { await cleanup(); process.exit(0); });
process.on("SIGTERM", async () => { await cleanup(); process.exit(0); });
process.on("exit", () => {
  try {
    execSync(`curl -s -X DELETE -H "Authorization: Bearer ${API_KEY}" "${HUB_URL}/api/agents/${encodeURIComponent(AGENT_ID)}"`, { timeout: 2000, stdio: "ignore" });
  } catch {}
});

main().catch((err) => {
  console.error("[agent-visualizer] Fatal error:", err);
  process.exit(1);
});
