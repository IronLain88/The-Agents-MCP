import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { readFile } from "fs/promises";
import { findAsset } from "./lib/asset-lookup.js";
import { execSync } from "child_process";
import WebSocket from "ws";
import { resolve, sep } from "path";

const VALID_STATES = [
  "thinking",
  "planning",
  "reflecting",
  "searching",
  "reading",
  "querying",
  "browsing",
  "writing_code",
  "writing_text",
  "generating",
  "talking",
  "idle",
] as const;

type AgentState = string; // Allow any state - states are data-driven from property

function getGroup(state: string): string {
  switch (state) {
    case "thinking":
    case "planning":
    case "reflecting":
      return "reasoning";
    case "searching":
    case "reading":
    case "querying":
    case "browsing":
      return "gathering";
    case "writing_code":
    case "writing_text":
    case "generating":
      return "creating";
    case "talking":
      return "communicating";
    case "idle":
      return "idle";
    default:
      return "custom"; // Custom states defined in property
  }
}

function detectRepo(): { id: string; name: string } {
  try {
    const url = execSync("git remote get-url origin", { encoding: "utf-8" }).trim();
    const match = url.match(/(?:github\.com[:/])([^/]+\/[^/.]+)/);
    if (match) {
      const ownerRepo = match[1];
      return { id: ownerRepo.replace("/", "-"), name: ownerRepo };
    }
  } catch {}
  return { id: "workspace", name: "Workspace" };
}

const HUB_URL = (process.env.HUB_URL || "http://localhost:3000").replace(/\/+$/, "");
// L3: Validate HUB_URL
try {
  const parsed = new URL(HUB_URL);
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("HUB_URL must use http or https protocol");
  }
  if (parsed.hostname !== "localhost" && parsed.hostname !== "127.0.0.1") {
    console.error(`[agent-visualizer] WARNING: HUB_URL points to non-localhost host: ${parsed.hostname}`);
  }
} catch (err) {
  if (err instanceof TypeError) {
    console.error(`[agent-visualizer] FATAL: Invalid HUB_URL: ${HUB_URL}`);
    process.exit(1);
  }
  // Re-throw our own validation errors
  if (err instanceof Error && err.message.startsWith("HUB_URL")) {
    console.error(`[agent-visualizer] FATAL: ${err.message}`);
    process.exit(1);
  }
}
const API_KEY = process.env.API_KEY;
const BASE_ID = process.env.AGENT_ID || "default";
const AGENT_ID = `${BASE_ID}-${Math.random().toString(36).slice(2, 6)}`;
let agentName = process.env.AGENT_NAME || "Agent";
const AGENT_SPRITE = process.env.AGENT_SPRITE || "";
const repo = detectRepo();
const OWNER_ID = process.env.OWNER_ID || repo.id;
const OWNER_NAME = process.env.OWNER_NAME || repo.name;

async function reportToHub(
  state: AgentState,
  detail: string,
  agentId = AGENT_ID,
  nameOverride = agentName,
  parentAgentId: string | null = null,
  spriteOverride?: string,
  note?: string
) {
  const group = getGroup(state);
  try {
    await fetch(`${HUB_URL}/api/state`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(API_KEY && { Authorization: `Bearer ${API_KEY}` }),
      },
      body: JSON.stringify({
        agent_id: agentId,
        agent_name: nameOverride,
        state,
        detail,
        group,
        sprite: spriteOverride || AGENT_SPRITE,
        owner_id: OWNER_ID,
        owner_name: OWNER_NAME,
        parent_agent_id: parentAgentId,
        ...(note && { note }),
      }),
    });
  } catch (err) {
    console.error("[agent-visualizer] Failed to report to hub:", err);
  }
}

/** Helper for authenticated hub requests. */
function hubHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    ...(API_KEY && { Authorization: `Bearer ${API_KEY}` }),
  };
}

// --- MCP Server ---
const server = new McpServer({
  name: "agent-visualizer",
  version: "1.0.0",
});

server.tool(
  "get_village_info",
  "Get a compact onboarding summary of The Agents visualization system. Call once at the start of a session to understand available states, tools, and conventions.",
  {},
  async () => {
    const info = [
      "# The Agents — Quick Reference",
      "",
      "## Built-in States",
      "Your character walks to furniture tagged with the matching station name.",
      "",
      "| State | Group | Description |",
      "|-------|-------|-------------|",
      "| thinking | reasoning | Analyzing a problem, reasoning through logic |",
      "| planning | reasoning | Designing an approach or architecture |",
      "| reflecting | reasoning | Reviewing work, reconsidering approach |",
      "| searching | gathering | Searching for files or code patterns |",
      "| reading | gathering | Reading files or documentation |",
      "| querying | gathering | Querying databases or APIs |",
      "| browsing | gathering | Browsing the web |",
      "| writing_code | creating | Writing or editing code |",
      "| writing_text | creating | Writing text, docs, or messages |",
      "| generating | creating | Generating assets or output |",
      "| talking | communicating | Answering or talking to the user |",
      "| idle | idle | Finished or waiting for input |",
      "",
      "## Custom States",
      "Any station name tagged on property furniture works as a state.",
      "Example: if furniture has station=\"debugging\", call update_state({ state: \"debugging\" }).",
      "",
      "## Conventions",
      "- Update state at EVERY transition (reading → writing_code, etc.)",
      "- Use concise but descriptive detail strings",
      "- Add a note when you discover something non-obvious (max 2 sentences)",
      "- Set state to idle when done and awaiting input",
      "",
      "## Tools",
      "- **State**: update_state, update_subagent_state, set_name",
      "- **Property/Assets**: list_assets, add_asset, remove_asset, move_asset, attach_content, read_asset_content, sync_property",
      "- **Bulletin Board**: post_to_board, read_board (cross-hub communication)",
      "- **Signals**: subscribe, check_events, fire_signal",
    ].join("\n");
    return { content: [{ type: "text" as const, text: info }] };
  }
);

server.tool(
  "update_state",
  "Update the agent's visualization state. The character walks to furniture tagged with the matching station name on the property. " +
    "Built-in states: thinking, planning, reflecting (reasoning group); searching, reading, querying, browsing (gathering group); " +
    "writing_code, writing_text, generating (creating group); talking (communicating group); idle. " +
    "Custom states work too — any station name on property furniture is valid.",
  {
    state: z.string().describe(
      "The agent activity state. Built-in: thinking, planning, reflecting, searching, reading, querying, browsing, " +
        "writing_code, writing_text, generating, idle. Custom states supported if matching station exists on property."
    ),
    detail: z.string().describe('Concise description of what the agent is doing, e.g. "Writing authentication module"'),
    note: z.string().optional().describe(
      "Optional reflection note (max 2 sentences) to append to the PREVIOUS station when transitioning. Use for gotchas, learnings, or important observations."
    ),
  },
  async ({ state, detail, note }) => {
    await reportToHub(state, detail, AGENT_ID, agentName, null, undefined, note);
    return {
      content: [{ type: "text" as const, text: `State updated to "${state}" (${getGroup(state)}): ${detail}` }],
    };
  }
);

server.tool(
  "update_subagent_state",
  "Report a subagent's activity state for visualization. Subagents render smaller with cyan name labels, linked to the parent agent. " +
    "Use this when spawning Task agents or subprocesses so they appear as separate characters on the property.",
  {
    subagent_id: z.string().describe("Unique ID for the subagent (e.g. 'sub-search-1')"),
    subagent_name: z.string().describe("Display name for the subagent (e.g. 'Explorer')"),
    state: z.string().describe(
      "The subagent's activity state. Built-in: thinking, planning, reflecting, searching, reading, querying, browsing, " +
        "writing_code, writing_text, generating, idle. Custom states supported if matching station exists on property."
    ),
    detail: z.string().describe("What the subagent is doing"),
    sprite: z.string().optional().describe("Character sprite name (e.g. 'Xavier', 'Yuki'). Defaults to parent agent's sprite."),
  },
  async ({ subagent_id, subagent_name, state, detail, sprite }) => {
    await reportToHub(state, detail, `${AGENT_ID}:${subagent_id}`, subagent_name, AGENT_ID, sprite);
    return {
      content: [{ type: "text" as const, text: `Subagent "${subagent_name}" (${subagent_id}) state: "${state}" — ${detail}` }],
    };
  }
);

server.tool(
  "set_name",
  "Set this agent's display name at runtime. Useful when the agent's .md file specifies a role name.",
  {
    name: z.string().describe('The display name, e.g. "DevLead"'),
  },
  async ({ name }) => {
    agentName = name;
    await reportToHub("idle", `Renamed to ${name}`);
    return { content: [{ type: "text" as const, text: `Agent name set to "${name}"` }] };
  }
);

// --- Property reads (read-only, safe) ---

interface Asset {
  id: string;
  name?: string;
  position: { x: number; y: number } | null;
  station?: string;
  content?: { type: string; data: string; source?: string; publishedAt?: string };
  trigger?: string;
  trigger_interval?: number;
}

async function fetchPropertyFromHub(): Promise<{ assets: Asset[]; [key: string]: unknown }> {
  const response = await fetch(`${HUB_URL}/api/property`, {
    headers: API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {},
  });
  if (!response.ok) throw new Error(`Hub returned ${response.status}`);
  return await response.json();
}

// --- Asset Management Tools (granular hub endpoints) ---

server.tool(
  "sync_property",
  "Sync property to hub after making changes",
  {},
  async () => {
    try {
      const property = await fetchPropertyFromHub();
      const assetCount = property.assets?.length || 0;
      return { content: [{ type: "text" as const, text: `Property synced (${assetCount} assets)` }] };
    } catch (err) {
      return { content: [{ type: "text" as const, text: `Sync failed: ${err}` }] };
    }
  }
);

server.tool(
  "list_assets",
  "List all assets on your property",
  {},
  async () => {
    try {
      const property = await fetchPropertyFromHub();
      const assets = property.assets || [];
      if (assets.length === 0) {
        return { content: [{ type: "text" as const, text: "No assets on property" }] };
      }
      const list = assets.map((a: Asset) => {
        const pos = a.position ? `(${a.position.x}, ${a.position.y})` : "inventory";
        const sta = a.station ? ` [station: ${a.station}]` : "";
        return `- ${a.name || a.id} — ${pos}${sta}`;
      }).join("\n");
      return { content: [{ type: "text" as const, text: list }] };
    } catch (err) {
      return { content: [{ type: "text" as const, text: `Failed to fetch property: ${err}` }] };
    }
  }
);

server.tool(
  "add_asset",
  "Add a new asset to your property",
  {
    name: z.string().describe("Display name for the asset"),
    tileset: z.string().optional().describe("Tileset name (e.g. 'interiors')"),
    tx: z.number().optional().describe("Tile X in tileset"),
    ty: z.number().optional().describe("Tile Y in tileset"),
    x: z.number().optional().describe("X position on property (omit for inventory)"),
    y: z.number().optional().describe("Y position on property (omit for inventory)"),
    station: z.string().optional().describe("Agent state when at this asset"),
    approach: z.enum(["above", "below", "left", "right"]).optional().describe("Approach direction"),
    collision: z.boolean().optional().describe("Block movement"),
    remote_url: z.string().optional().describe("Remote hub URL for remote board assets"),
    remote_station: z.string().optional().describe("Station name on the remote hub to read"),
  },
  async ({ name, tileset, tx, ty, x, y, station, approach, collision, remote_url, remote_station }) => {
    try {
      const body: Record<string, unknown> = { name };
      if (tileset !== undefined) body.tileset = tileset;
      if (tx !== undefined) body.tx = tx;
      if (ty !== undefined) body.ty = ty;
      if (x !== undefined) body.x = x;
      if (y !== undefined) body.y = y;
      if (station) body.station = station;
      if (approach) body.approach = approach;
      if (collision !== undefined) body.collision = collision;
      if (remote_url) body.remote_url = remote_url;
      if (remote_station) body.remote_station = remote_station;

      const res = await fetch(`${HUB_URL}/api/assets`, {
        method: "POST",
        headers: hubHeaders(),
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        return { content: [{ type: "text" as const, text: `Failed to add asset: ${(err as { error: string }).error}` }] };
      }
      const { asset } = await res.json() as { asset: Asset };
      const posStr = asset.position ? `at (${asset.position.x}, ${asset.position.y})` : "in inventory";
      return { content: [{ type: "text" as const, text: `Added asset "${name}" (${asset.id}) ${posStr}` }] };
    } catch (err) {
      return { content: [{ type: "text" as const, text: `Failed to add asset: ${err}` }] };
    }
  }
);

server.tool(
  "remove_asset",
  "Remove an asset from your property",
  {
    asset_id: z.string().describe("ID of asset to remove"),
  },
  async ({ asset_id }) => {
    try {
      const res = await fetch(`${HUB_URL}/api/assets/${encodeURIComponent(asset_id)}`, {
        method: "DELETE",
        headers: hubHeaders(),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        return { content: [{ type: "text" as const, text: `Failed to remove asset: ${(err as { error: string }).error}` }] };
      }
      const { removed } = await res.json() as { removed: Asset };
      return { content: [{ type: "text" as const, text: `Removed asset "${removed.name || removed.id}"` }] };
    } catch (err) {
      return { content: [{ type: "text" as const, text: `Failed to remove asset: ${err}` }] };
    }
  }
);

server.tool(
  "move_asset",
  "Move an asset to a new position",
  {
    asset_id: z.string().describe("ID of asset to move"),
    x: z.number().describe("New X position"),
    y: z.number().describe("New Y position"),
  },
  async ({ asset_id, x, y }) => {
    try {
      const res = await fetch(`${HUB_URL}/api/assets/${encodeURIComponent(asset_id)}`, {
        method: "PATCH",
        headers: hubHeaders(),
        body: JSON.stringify({ position: { x, y } }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        return { content: [{ type: "text" as const, text: `Failed to move asset: ${(err as { error: string }).error}` }] };
      }
      const { asset } = await res.json() as { asset: Asset };
      return { content: [{ type: "text" as const, text: `Moved "${asset.name || asset.id}" to (${x}, ${y})` }] };
    } catch (err) {
      return { content: [{ type: "text" as const, text: `Failed to move asset: ${err}` }] };
    }
  }
);

server.tool(
  "attach_content",
  "Attach content to an asset from a local file",
  {
    asset_id: z.string().describe("ID of asset to attach content to"),
    file_path: z.string().describe("Path to file to attach"),
  },
  async ({ asset_id, file_path }) => {
    try {
      // C3: Restrict file reads to the current working directory
      const projectRoot = resolve(process.cwd());
      const resolved = resolve(file_path);
      if (!resolved.startsWith(projectRoot + sep) && resolved !== projectRoot) {
        return { content: [{ type: "text" as const, text: "Error: path must be within project directory" }] };
      }

      const data = await readFile(file_path, "utf-8");
      const ext = file_path.split(".").pop() || "txt";
      const type = ext === "md" ? "markdown" : ext === "json" ? "json" : "text";

      const res = await fetch(`${HUB_URL}/api/assets/${encodeURIComponent(asset_id)}`, {
        method: "PATCH",
        headers: hubHeaders(),
        body: JSON.stringify({
          content: { type, data, source: file_path, publishedAt: new Date().toISOString() },
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        return { content: [{ type: "text" as const, text: `Failed to attach: ${(err as { error: string }).error}` }] };
      }
      const { asset } = await res.json() as { asset: Asset };
      return { content: [{ type: "text" as const, text: `Attached ${file_path} to "${asset.name || asset.id}"` }] };
    } catch (err) {
      return { content: [{ type: "text" as const, text: `Failed to attach content: ${err}` }] };
    }
  }
);

server.tool(
  "read_asset_content",
  "Read content attached to an asset on your property by name or ID",
  {
    name: z.string().describe("Asset name or ID (fuzzy match)"),
  },
  async ({ name }) => {
    try {
      const property = await fetchPropertyFromHub();
      const asset = findAsset(property.assets || [], name);
      if (!asset) {
        return { content: [{ type: "text" as const, text: `Asset "${name}" not found. Use list_assets to see available assets.` }] };
      }
      if (!asset.content) {
        return { content: [{ type: "text" as const, text: `Asset "${asset.name || asset.id}" has no content attached.` }] };
      }
      const header = `# ${asset.name || asset.id}\n\n`;
      const footer = asset.content.source ? `\n\n---\n*Source: ${asset.content.source}*` : "";
      return { content: [{ type: "text" as const, text: header + asset.content.data + footer }] };
    } catch (err) {
      return { content: [{ type: "text" as const, text: `Failed to fetch property: ${err}` }] };
    }
  }
);

// --- Bulletin board tools ---

server.tool(
  "post_to_board",
  "Post content to a station's bulletin board. Simpler than attach_content — just a string to a station name. " +
    "The station must exist as an asset on the property.",
  {
    station: z.string().describe('Station name, e.g. "News Desk" or "writing_code"'),
    data: z.string().describe("Content to post (max 10KB)"),
    type: z.enum(["text", "markdown", "json"]).optional().describe("Content type (default: text)"),
  },
  async ({ station, data, type }) => {
    try {
      const body: Record<string, unknown> = { data };
      if (type) body.type = type;
      const res = await fetch(`${HUB_URL}/api/board/${encodeURIComponent(station)}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(API_KEY && { Authorization: `Bearer ${API_KEY}` }),
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        return { content: [{ type: "text" as const, text: `Post failed: ${(err as { error: string }).error}` }] };
      }
      await reportToHub(station, `Posted to board: ${data.slice(0, 80)}`);
      return { content: [{ type: "text" as const, text: `Posted to "${station}" board (${data.length} chars)` }] };
    } catch (err) {
      return { content: [{ type: "text" as const, text: `Post failed: ${err}` }] };
    }
  }
);

server.tool(
  "read_board",
  "Read a bulletin board from any hub (local or remote). Returns the station's content and activity log. " +
    "Use this for cross-hub communication — read boards on other hubs without downloading their entire property.",
  {
    station: z.string().describe('Station name to read, e.g. "News Desk"'),
    url: z.string().optional().describe("Hub URL (defaults to local hub). Must be http/https."),
  },
  async ({ station, url }) => {
    const hubUrl = url || HUB_URL;
    // Validate URL protocol to prevent SSRF
    try {
      const parsed = new URL(hubUrl);
      if (!["http:", "https:"].includes(parsed.protocol)) {
        return { content: [{ type: "text" as const, text: "Error: URL must use http or https protocol" }] };
      }
    } catch {
      return { content: [{ type: "text" as const, text: `Error: Invalid URL "${hubUrl}"` }] };
    }

    try {
      const res = await fetch(`${hubUrl}/api/board/${encodeURIComponent(station)}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        return { content: [{ type: "text" as const, text: `Read failed: ${(err as { error: string }).error}` }] };
      }
      const board = await res.json() as { station: string; content: { type: string; data: string; publishedAt?: string } | null; log: string | null };

      const parts: string[] = [`# Board: ${board.station}`];
      if (board.content) {
        parts.push("", `## Content (${board.content.type})`, board.content.data);
        if (board.content.publishedAt) parts.push(`\n*Published: ${board.content.publishedAt}*`);
      } else {
        parts.push("", "*No content posted yet.*");
      }
      if (board.log) {
        parts.push("", "## Activity Log", board.log);
      }

      if (!url || url === HUB_URL) {
        await reportToHub(station, `Reading board`);
      }
      return { content: [{ type: "text" as const, text: parts.join("\n") }] };
    } catch (err) {
      return { content: [{ type: "text" as const, text: `Read failed: ${err}` }] };
    }
  }
);

// --- Signal system ---

interface SignalMessage {
  type: string;
  station: string;
  trigger: string;
  timestamp: number;
  payload?: unknown;
}

let signalWs: WebSocket | null = null;
let subscribedStation: string | null = null;
let pendingResolve: ((msg: SignalMessage) => void) | null = null;

// Signal queue to buffer signals while agent is working
const signalQueue: SignalMessage[] = [];
const MAX_QUEUE_SIZE = 50;

function connectSignalWs() {
  const wsUrl = HUB_URL.replace(/^http/, "ws");
  signalWs = new WebSocket(wsUrl);
  signalWs.on("message", (raw: Buffer) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.type === "signal" && msg.station === subscribedStation) {
        // If someone is waiting, resolve immediately
        if (pendingResolve) {
          const resolve = pendingResolve;
          pendingResolve = null;
          resolve(msg);
        }
        // Otherwise, add to queue
        else {
          signalQueue.push(msg);

          // Prevent queue from growing too large
          if (signalQueue.length > MAX_QUEUE_SIZE) {
            signalQueue.shift(); // Remove oldest
            console.warn(`[mcp] Signal queue full (${MAX_QUEUE_SIZE}), dropped oldest signal`);
          }
        }
      }
    } catch {}
  });
  signalWs.on("close", () => {
    signalWs = null;
    if (subscribedStation) setTimeout(connectSignalWs, 3_000);
  });
  signalWs.on("error", () => {});
}

// Format signal message as JSON event
function formatSignalEvent(msg: SignalMessage): string {
  const event = {
    timestamp: msg.timestamp,
    time: new Date(msg.timestamp).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }),
    trigger: msg.trigger,
    station: subscribedStation,
    payload: msg.payload,
    queueSize: signalQueue.length
  };
  return JSON.stringify(event, null, 2);
}

async function waitForSignal(): Promise<string> {
  const keepAlive = setInterval(() => {
    reportToHub(subscribedStation!, "Listening for signal");
  }, 30_000);
  try {
    // Check queue first - return immediately if signals are buffered
    if (signalQueue.length > 0) {
      const msg = signalQueue.shift()!; // Get oldest signal (FIFO)
      return formatSignalEvent(msg);
    }

    // No queued signals - wait for next one
    const msg = await new Promise<SignalMessage>((resolve, reject) => {
      pendingResolve = resolve;
      // Safety timeout: 10 minutes
      setTimeout(() => {
        if (pendingResolve === resolve) {
          pendingResolve = null;
          reject(new Error("timeout"));
        }
      }, 10 * 60_000);
    });

    return formatSignalEvent(msg);
  } finally {
    clearInterval(keepAlive);
  }
}

server.tool(
  "subscribe",
  "Subscribe to a signal asset on the property. The agent walks to the signal station and blocks until an event fires. " +
    "Signals are property assets with a trigger type (heartbeat/interval or manual). After subscribing, call check_events to wait for the next event.",
  {
    name: z.string().describe('The signal station name, e.g. "Gold Watch". Must match an asset with a trigger on the property.'),
  },
  async ({ name }) => {
    // Fetch property from hub to find the signal asset
    try {
      const property = await fetchPropertyFromHub();
      const asset = (property.assets || []).find(
        (a: Asset) => a.station === name && a.trigger
      );
      if (!asset) {
        return { content: [{ type: "text" as const, text: `No signal named "${name}" found on property` }] };
      }
      subscribedStation = name;
      if (!signalWs || signalWs.readyState !== WebSocket.OPEN) connectSignalWs();
      await reportToHub(name, `Listening for ${asset.trigger} signal`);
      const interval = asset.trigger_interval || 1;
      return { content: [{ type: "text" as const, text: `Subscribed to "${name}" (${asset.trigger} every ${interval} min)` }] };
    } catch (err) {
      return { content: [{ type: "text" as const, text: `Subscribe failed: ${err}` }] };
    }
  }
);

server.tool(
  "check_events",
  "Block until the subscribed signal fires (up to 10 min timeout). Returns JSON with timestamp, trigger type, station, and payload. " +
    "Call subscribe first to choose which signal to listen to. Buffered signals are returned immediately (FIFO).",
  {},
  async () => {
    if (!subscribedStation) {
      return { content: [{ type: "text" as const, text: "Not subscribed to any signal. Call subscribe first." }] };
    }
    if (!signalWs || signalWs.readyState !== WebSocket.OPEN) connectSignalWs();
    try {
      const result = await waitForSignal();
      return { content: [{ type: "text" as const, text: result }] };
    } catch {
      return { content: [{ type: "text" as const, text: "No events (timeout)" }] };
    }
  }
);

server.tool(
  "fire_signal",
  "Fire a signal on the property. All agents subscribed to this signal station will receive the event via check_events. " +
    "Use this for inter-agent communication or to trigger workflows.",
  {
    name: z.string().describe('The signal station name to fire, e.g. "Deploy Check"'),
    payload: z.any().optional().describe('Optional payload data (requires ALLOW_SIGNAL_PAYLOADS=true on hub)'),
  },
  async ({ name, payload }) => {
    try {
      const body: Record<string, unknown> = { station: name };
      if (payload !== undefined) body.payload = payload;
      const res = await fetch(`${HUB_URL}/api/signals/fire`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(API_KEY && { Authorization: `Bearer ${API_KEY}` }),
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) return { content: [{ type: "text" as const, text: `Fire failed: ${res.statusText}` }] };
      return { content: [{ type: "text" as const, text: `Fired signal "${name}"` }] };
    } catch (err) {
      return { content: [{ type: "text" as const, text: `Fire failed: ${err}` }] };
    }
  }
);

// --- Main ---

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[agent-visualizer] MCP server connected via stdio");
  console.error(`[agent-visualizer] Reporting to hub at ${HUB_URL} as "${agentName}" (${AGENT_ID})`);

  // Register main agent and residents as idle
  await reportToHub("idle", "Agent connected");

  // Register residents from property (if any)
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

main().catch((err) => {
  console.error("[agent-visualizer] Fatal error:", err);
  process.exit(1);
});
