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

const HUB_URL = (process.env.HUB_URL || "http://localhost:4242").replace(/\/+$/, "");
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

interface WelcomeData {
  stations: string[];
  signals: string[];
  boards: string[];
  inbox: number;
  agents: { name: string; state: string }[];
}

async function reportToHub(
  state: AgentState,
  detail: string,
  agentId = AGENT_ID,
  nameOverride = agentName,
  parentAgentId: string | null = null,
  spriteOverride?: string,
  note?: string
): Promise<WelcomeData | null> {
  const group = getGroup(state);
  try {
    const res = await fetch(`${HUB_URL}/api/state`, {
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
    const body = await res.json() as { ok: boolean; welcome?: WelcomeData };
    return body.welcome || null;
  } catch (err) {
    console.error("[agent-visualizer] Failed to report to hub:", err);
    return null;
  }
}

function formatWelcome(w: WelcomeData): string {
  const lines: string[] = ["## Welcome to your property\n"];
  if (w.agents.length > 0) {
    const others = w.agents.map(a => `${a.name} (${a.state})`).join(", ");
    lines.push(`**Active:** ${others}`);
  }
  lines.push(`**Stations:** ${w.stations.join(", ") || "none"}`);
  if (w.inbox > 0) lines.push(`**Inbox:** ${w.inbox} message(s)`);
  if (w.signals.length > 0) lines.push(`**Signals:** ${w.signals.join(", ")}`);
  if (w.boards.length > 0) lines.push(`**Boards with content:** ${w.boards.join(", ")}`);
  return lines.join("\n");
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
  "Get a summary of your property: available stations, signals, boards, and inbox. Called automatically on first connect, but useful to refresh.",
  {},
  async () => {
    const lines = [
      "# The Agents",
      "",
      "You have a property — a tile grid with furniture. Each furniture piece can be tagged with a **station** name.",
      "When you call `update_state({ state, detail })`, your character walks to the matching station.",
      "Update state at EVERY transition. Set idle when done.",
      "",
    ];

    // Dynamic: scan property for what's actually there
    try {
      const property = await fetchPropertyFromHub();
      const assets = property.assets || [];
      const stations: string[] = [];
      const signals: string[] = [];
      const boards: string[] = [];
      let inboxCount = 0;

      const tasks: string[] = [];

      for (const a of assets) {
        if (!a.station) continue;
        if ((a as any).task) {
          tasks.push(`${a.station} — ${(a as any).instructions || "(no instructions)"}`);
          continue;
        }
        if (a.trigger) {
          signals.push(`${a.name || a.station} (${a.trigger}, every ${a.trigger_interval || 1} min)`);
        } else if (a.station === "inbox" && a.content?.data) {
          try {
            const msgs = JSON.parse(a.content.data);
            if (Array.isArray(msgs)) inboxCount += msgs.length;
          } catch {}
          if (!stations.includes(a.station)) stations.push(a.station);
        } else {
          if (!stations.includes(a.station)) stations.push(a.station);
          if (a.content?.data) boards.push(a.name || a.station);
        }
      }

      lines.push(`## Your Property`);
      lines.push(`**Stations:** ${stations.join(", ") || "none"}`);
      if (inboxCount > 0) lines.push(`**Inbox:** ${inboxCount} message(s)`);
      if (tasks.length > 0) {
        lines.push(`**Tasks:** ${tasks.join(", ")}`);
        lines.push(`*To work on a task: subscribe({name}) → check_events() → do the work → answer_task({station, result})*`);
      }
      if (signals.length > 0) lines.push(`**Signals:** ${signals.join(", ")}`);
      if (boards.length > 0) lines.push(`**Boards with content:** ${boards.join(", ")}`);
      lines.push(`**Total assets:** ${assets.length}`);
    } catch {
      lines.push("*(Could not fetch property)*");
    }

    return { content: [{ type: "text" as const, text: lines.join("\n") }] };
  }
);

server.tool(
  "get_status",
  "Get a quick status overview: active agents, inbox messages, and recent activity.",
  {},
  async () => {
    try {
      const res = await fetch(`${HUB_URL}/api/status`, {
        headers: API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {},
      });
      if (!res.ok) throw new Error(`Hub returned ${res.status}`);
      const status = await res.json() as {
        agents: { name: string; state: string; detail: string; idle: boolean; sub?: boolean }[];
        inbox: { count: number; latest: string | null };
        activity: { agent: string; state: string; detail: string; t: number }[];
        stations: string[];
      };
      const lines: string[] = [];
      lines.push(`## Property Status\n`);
      lines.push(`**Agents (${status.agents.length}):**`);
      for (const a of status.agents) {
        const tag = a.sub ? " (sub)" : "";
        lines.push(`- ${a.name}${tag}: ${a.state} — ${a.detail || "idle"}`);
      }
      if (status.inbox.count > 0) {
        lines.push(`\n**Inbox: ${status.inbox.count} message(s)**`);
      } else {
        lines.push(`\n**Inbox: empty**`);
      }
      if (status.activity.length > 0) {
        lines.push(`\n**Recent Activity:**`);
        for (const e of status.activity) {
          lines.push(`- ${e.agent}: ${e.detail}`);
        }
      }
      lines.push(`\n**Active Stations:** ${status.stations.join(", ") || "none"}`);
      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    } catch (err) {
      return { content: [{ type: "text" as const, text: `Status check failed: ${err}` }] };
    }
  }
);

server.tool(
  "update_state",
  "Update your agent's state. Your character walks to the matching station on the property. " +
    "Call this at EVERY work transition (e.g. reading -> writing_code -> idle). " +
    "Common states: thinking, planning, searching, reading, writing_code, writing_text, idle. " +
    "Any station name on your property furniture also works as a custom state.",
  {
    state: z.string().describe(
      "The activity state — matches a station name on your property. " +
        "Common: thinking, planning, reading, searching, writing_code, idle."
    ),
    detail: z.string().describe('What you are doing, e.g. "Reading auth module"'),
    note: z.string().optional().describe(
      "Reflection note (max 2 sentences) logged to the PREVIOUS station. Use for gotchas or learnings."
    ),
  },
  async ({ state, detail, note }) => {
    const welcome = await reportToHub(state, detail, AGENT_ID, agentName, null, undefined, note);
    const msg = `State updated to "${state}" (${getGroup(state)}): ${detail}`;
    const text = welcome ? `${msg}\n\n${formatWelcome(welcome)}` : msg;
    return { content: [{ type: "text" as const, text }] };
  }
);

server.tool(
  "update_subagent_state",
  "Report a subagent's state. Subagents appear as smaller characters linked to you. " +
    "Use when spawning Task agents or subprocesses.",
  {
    subagent_id: z.string().describe("Unique ID, e.g. 'sub-search-1'"),
    subagent_name: z.string().describe("Display name, e.g. 'Explorer'"),
    state: z.string().describe("Activity state — same as update_state"),
    detail: z.string().describe("What the subagent is doing"),
    sprite: z.string().optional().describe("Character sprite name. Defaults to parent's sprite."),
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
  "Refresh your local view of the property from the hub.",
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
  "Add furniture to your property. Set 'station' to make it a place your agent can walk to. " +
    "Omit x/y to add to inventory instead of placing on the grid.",
  {
    name: z.string().describe("Display name for the asset"),
    tileset: z.string().optional().describe("Tileset name (e.g. 'interiors')"),
    tx: z.number().optional().describe("Tile X in tileset"),
    ty: z.number().optional().describe("Tile Y in tileset"),
    x: z.number().optional().describe("X grid position (omit for inventory)"),
    y: z.number().optional().describe("Y grid position (omit for inventory)"),
    station: z.string().optional().describe("Station name — your agent walks here when in this state"),
    approach: z.enum(["above", "below", "left", "right"]).optional().describe("Which side the agent stands on"),
    collision: z.boolean().optional().describe("Block movement through this tile"),
    remote_url: z.string().optional().describe("Remote hub URL to read a board from another property"),
    remote_station: z.string().optional().describe("Station name on the remote hub"),
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
  "Post content to a station's board. Boards are persistent — content stays until overwritten. " +
    "Use for leaving notes, sharing results, or publishing data that other agents can read.",
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
  "Read a station's board content and activity log. Can also read boards on other properties by providing a URL.",
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

// --- Inbox tools ---

server.tool(
  "check_inbox",
  "Check your inbox for messages from humans or other agents. " +
    "Returns formatted messages with sender, time, and text.",
  {
    name: z.string().optional().describe('Inbox name (default: "inbox"). Use for named inboxes like "inbox-bugs".'),
  },
  async ({ name }) => {
    const inbox = name || "inbox";
    try {
      const res = await fetch(`${HUB_URL}/api/board/${encodeURIComponent(inbox)}`, {
        headers: API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {},
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        return { content: [{ type: "text" as const, text: `Inbox check failed: ${(err as { error: string }).error}` }] };
      }
      const board = await res.json() as { content: { data: string } | null };

      let messages: { from: string; text: string; timestamp?: string }[] = [];
      try {
        if (board.content?.data) {
          const parsed = JSON.parse(board.content.data);
          if (Array.isArray(parsed)) messages = parsed;
        }
      } catch {}

      await reportToHub(inbox, "Checking inbox");

      if (messages.length === 0) {
        return { content: [{ type: "text" as const, text: `${inbox} is empty.` }] };
      }

      const lines = messages.map(m => {
        const time = m.timestamp
          ? new Date(m.timestamp).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })
          : "";
        return `- ${m.from}${time ? ` (${time})` : ""}: ${m.text}`;
      });

      return { content: [{ type: "text" as const, text: `${messages.length} message(s):\n${lines.join("\n")}` }] };
    } catch (err) {
      return { content: [{ type: "text" as const, text: `Inbox check failed: ${err}` }] };
    }
  }
);

server.tool(
  "send_message",
  "Send a message to the inbox. Your agent name is used as the sender. " +
    "Use to leave notes for the human or other agents.",
  {
    text: z.string().describe("The message to send"),
    inbox: z.string().optional().describe('Target inbox name (default: "inbox"). Use for named inboxes like "inbox-bugs".'),
  },
  async ({ text, inbox }) => {
    const target = inbox || "inbox";
    try {
      const res = await fetch(`${HUB_URL}/api/inbox/${encodeURIComponent(target)}`, {
        method: "POST",
        headers: hubHeaders(),
        body: JSON.stringify({ from: agentName, text }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        return { content: [{ type: "text" as const, text: `Send failed: ${(err as { error: string }).error}` }] };
      }
      const { count } = await res.json() as { count: number };
      return { content: [{ type: "text" as const, text: `Message sent to ${target} (${count} total)` }] };
    } catch (err) {
      return { content: [{ type: "text" as const, text: `Send failed: ${err}` }] };
    }
  }
);

server.tool(
  "clear_inbox",
  "Clear all messages from the inbox. Call after reading messages you've handled.",
  {
    name: z.string().optional().describe('Inbox name to clear (default: "inbox").'),
  },
  async ({ name }) => {
    const target = name || "inbox";
    try {
      const res = await fetch(`${HUB_URL}/api/inbox/${encodeURIComponent(target)}`, {
        method: "DELETE",
        headers: hubHeaders(),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        return { content: [{ type: "text" as const, text: `Clear failed: ${(err as { error: string }).error}` }] };
      }
      return { content: [{ type: "text" as const, text: `${target} cleared` }] };
    } catch (err) {
      return { content: [{ type: "text" as const, text: `Clear failed: ${err}` }] };
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
}

server.tool(
  "subscribe",
  "Subscribe to a signal or task station. For tasks: subscribe → check_events (returns instructions) → do work → answer_task. " +
    "Signals fire on a timer (heartbeat) or manually.",
  {
    name: z.string().describe('The signal station name, e.g. "Gold Watch". Must match an asset with a trigger on the property.'),
  },
  async ({ name }) => {
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
      const interval = asset.trigger_interval || 1;
      return { content: [{ type: "text" as const, text: `Subscribed to "${name}" (${asset.trigger} every ${interval} min)` }] };
    } catch (err) {
      return { content: [{ type: "text" as const, text: `Subscribe failed: ${err}` }] };
    }
  }
);

server.tool(
  "check_events",
  "Wait for the next event on your subscribed station (up to 10 min). For tasks, the event payload contains " +
    "{station, instructions, prompt} telling you what to do. Call subscribe first.",
  {},
  async () => {
    if (!subscribedStation) {
      return { content: [{ type: "text" as const, text: "Not subscribed to any signal. Call subscribe first." }] };
    }
    if (!signalWs || signalWs.readyState !== WebSocket.OPEN) connectSignalWs();
    try {
      const result = await waitForSignal();
      return { content: [{ type: "text" as const, text: result + "\n\nRemember to call update_state for your next activity." }] };
    } catch {
      return { content: [{ type: "text" as const, text: "No events (timeout). Remember to call update_state for your next activity." }] };
    }
  }
);

server.tool(
  "fire_signal",
  "Fire a signal. All agents subscribed to this signal will receive the event. " +
    "Use for inter-agent communication or triggering workflows.",
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

// --- Reception tools ---

server.tool(
  "read_reception",
  "Read a reception station's private instructions and current Q&A state. " +
    "Use this after walking to a reception station to get your instructions and check for pending questions.",
  {
    station: z.string().describe('The reception station name, e.g. "Help Desk"'),
  },
  async ({ station }) => {
    try {
      const property = await fetchPropertyFromHub();
      const asset = (property.assets || []).find(
        (a: Asset) => a.station === station && (a as any).reception
      );
      if (!asset) {
        return { content: [{ type: "text" as const, text: `No reception station "${station}" found` }] };
      }

      const parts: string[] = [`# Reception: ${station}\n`];

      // Instructions (private to agent)
      const instructions = (asset as any).instructions;
      if (instructions) {
        parts.push(`## Instructions\n${instructions}\n`);
      }

      // Current Q&A state
      let state = { status: "idle", question: null as string | null, answer: null as string | null };
      try {
        if (asset.content?.data) state = JSON.parse(asset.content.data);
      } catch {}

      parts.push(`## Status: ${state.status}`);
      if (state.status === "pending" && state.question) {
        parts.push(`\n## Question\n${state.question}`);
      } else if (state.status === "answered") {
        parts.push(`\nQuestion: ${state.question}`);
        parts.push(`Answer already posted.`);
      } else {
        parts.push(`\nNo pending questions. Subscribe and wait for visitors.`);
      }

      return { content: [{ type: "text" as const, text: parts.join("\n") }] };
    } catch (err) {
      return { content: [{ type: "text" as const, text: `Failed: ${err}` }] };
    }
  }
);

server.tool(
  "answer_reception",
  "Post an HTML answer to a pending reception question. " +
    "The answer is rendered as rich HTML in the viewer. Use headings, lists, code blocks, etc.",
  {
    station: z.string().describe('The reception station name, e.g. "Help Desk"'),
    answer: z.string().describe('HTML answer to display to the visitor, e.g. "<h2>Answer</h2><p>Here is the info...</p>"'),
  },
  async ({ station, answer }) => {
    try {
      const res = await fetch(`${HUB_URL}/api/reception/${encodeURIComponent(station)}/answer`, {
        method: "POST",
        headers: hubHeaders(),
        body: JSON.stringify({ answer }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        return { content: [{ type: "text" as const, text: `Answer failed: ${(err as { error: string }).error}` }] };
      }
      return { content: [{ type: "text" as const, text: `Answer posted to "${station}"` }] };
    } catch (err) {
      return { content: [{ type: "text" as const, text: `Answer failed: ${err}` }] };
    }
  }
);

// --- Task tools ---

server.tool(
  "read_task",
  "Read a task station's instructions and current status. " +
    "Use get_village_info to discover available tasks first.",
  {
    station: z.string().describe('The task station name, e.g. "Reddit Spy"'),
  },
  async ({ station }) => {
    try {
      const property = await fetchPropertyFromHub();
      const asset = (property.assets || []).find(
        (a: any) => a.station === station && a.task
      );
      if (!asset) {
        return { content: [{ type: "text" as const, text: `No task station "${station}" found` }] };
      }

      const parts: string[] = [`# Task: ${station}\n`];

      const instructions = (asset as any).instructions;
      if (instructions) {
        parts.push(`## Instructions\n${instructions}\n`);
      }

      let state = { status: "idle", result: null as string | null };
      try {
        if (asset.content?.data) state = JSON.parse(asset.content.data);
      } catch {}

      parts.push(`## Status: ${state.status}`);
      if (state.status === "pending") {
        parts.push("\nTask is running. Wait for completion or post a result with answer_task.");
      } else if (state.status === "done" && state.result) {
        parts.push("\nResult already posted.");
      } else {
        parts.push("\nIdle. Subscribe and wait for a visitor to click Run.");
      }

      return { content: [{ type: "text" as const, text: parts.join("\n") }] };
    } catch (err) {
      return { content: [{ type: "text" as const, text: `Failed: ${err}` }] };
    }
  }
);

server.tool(
  "answer_task",
  "Post your result (HTML) to a task station after completing the work from check_events. " +
    "Rendered as rich HTML in the viewer. Use headings, lists, links, etc.",
  {
    station: z.string().describe('The task station name, e.g. "Reddit y2k"'),
    result: z.string().describe('HTML result to display, e.g. "<h2>Results</h2><ul><li>...</li></ul>"'),
  },
  async ({ station, result }) => {
    try {
      const res = await fetch(`${HUB_URL}/api/task/${encodeURIComponent(station)}/result`, {
        method: "POST",
        headers: hubHeaders(),
        body: JSON.stringify({ result }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        return { content: [{ type: "text" as const, text: `Task result failed: ${(err as { error: string }).error}` }] };
      }
      return { content: [{ type: "text" as const, text: `Result posted to "${station}"` }] };
    } catch (err) {
      return { content: [{ type: "text" as const, text: `Task result failed: ${err}` }] };
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
