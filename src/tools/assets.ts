import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { readFile } from "fs/promises";
import { resolve, sep } from "path";
import { HUB_URL } from "../lib/config.js";
import { hubHeaders, fetchPropertyFromHub, type Asset } from "../lib/hub.js";
import { findAsset } from "../lib/asset-lookup.js";

export function register(server: McpServer): void {
  server.tool(
    "sync_property",
    "Refresh your local view of the property from the hub.",
    {},
    async () => {
      try {
        const property = await fetchPropertyFromHub();
        return { content: [{ type: "text" as const, text: `Property synced (${property.assets?.length || 0} assets)` }] };
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
        if (assets.length === 0) return { content: [{ type: "text" as const, text: "No assets on property" }] };
        const list = assets.map((a: Asset) => {
          const pos = a.position ? `(${a.position.x}, ${a.position.y})` : "inventory";
          return `- ${a.name || a.id} — ${pos}${a.station ? ` [station: ${a.station}]` : ""}`;
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
      remote_url: z.string().optional().describe("Remote hub URL"),
      remote_station: z.string().optional().describe("Station name on the remote hub"),
      openclaw_task: z.boolean().optional().describe("Mark as an OpenClaw auto-spawn task station"),
      archive: z.boolean().optional().describe("Mark as an archive station"),
      welcome: z.boolean().optional().describe("Mark as a welcome board"),
    },
    async ({ name, tileset, tx, ty, x, y, station, approach, collision, remote_url, remote_station, openclaw_task, archive, welcome }) => {
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
        if (openclaw_task) body.openclaw_task = true;
        if (archive) body.archive = true;
        if (welcome) body.welcome = true;

        const res = await fetch(`${HUB_URL}/api/assets`, { method: "POST", headers: hubHeaders(), body: JSON.stringify(body) });
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
    { asset_id: z.string().describe("ID of asset to remove") },
    async ({ asset_id }) => {
      try {
        const res = await fetch(`${HUB_URL}/api/assets/${encodeURIComponent(asset_id)}`, { method: "DELETE", headers: hubHeaders() });
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
          method: "PATCH", headers: hubHeaders(), body: JSON.stringify({ position: { x, y } }),
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
        const projectRoot = resolve(process.cwd());
        const resolved = resolve(file_path);
        if (!resolved.startsWith(projectRoot + sep) && resolved !== projectRoot) {
          return { content: [{ type: "text" as const, text: "Error: path must be within project directory" }] };
        }
        const data = await readFile(file_path, "utf-8");
        const ext = file_path.split(".").pop() || "txt";
        const type = ext === "md" ? "markdown" : ext === "json" ? "json" : "text";
        const res = await fetch(`${HUB_URL}/api/assets/${encodeURIComponent(asset_id)}`, {
          method: "PATCH", headers: hubHeaders(),
          body: JSON.stringify({ content: { type, data, source: file_path, publishedAt: new Date().toISOString() } }),
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
    { name: z.string().describe("Asset name or ID (fuzzy match)") },
    async ({ name }) => {
      try {
        const property = await fetchPropertyFromHub();
        const asset = findAsset(property.assets || [], name);
        if (!asset) return { content: [{ type: "text" as const, text: `Asset "${name}" not found. Use list_assets to see available assets.` }] };
        if (!asset.content) return { content: [{ type: "text" as const, text: `Asset "${asset.name || asset.id}" has no content attached.` }] };
        const footer = asset.content.source ? `\n\n---\n*Source: ${asset.content.source}*` : "";
        return { content: [{ type: "text" as const, text: `# ${asset.name || asset.id}\n\n${asset.content.data}${footer}` }] };
      } catch (err) {
        return { content: [{ type: "text" as const, text: `Failed to fetch property: ${err}` }] };
      }
    }
  );
}
