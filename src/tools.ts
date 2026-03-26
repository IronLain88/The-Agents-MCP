import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import * as agentTools from "./tools/agent.js";
import * as assetTools from "./tools/assets.js";
import * as inboxTools from "./tools/inbox.js";
import * as eventTools from "./tools/events.js";
import * as receptionTools from "./tools/reception.js";
import * as taskTools from "./tools/tasks.js";
import * as dtoTools from "./tools/dto.js";

export function registerTools(server: McpServer) {
  agentTools.register(server);
  assetTools.register(server);
  inboxTools.register(server);
  eventTools.register(server);
  receptionTools.register(server);
  taskTools.register(server);
  dtoTools.register(server);
}
