import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { HUB_URL, API_KEY } from "../lib/config.js";
import { reportToHub } from "../lib/hub.js";

export function register(server: McpServer): void {
  server.tool(
    "post_to_board",
    "Post content to a station's board. Boards are persistent — content stays until overwritten. " +
      "Use for leaving notes, sharing results, or publishing data that other agents can read.",
    {
      station: z.string().describe('Station name, e.g. "News Desk" or "writing_code"'),
      data: z.string().describe("Content to post (max 10KB)"),
      type: z.enum(["text", "markdown", "json", "html"]).optional().describe("Content type (default: text)"),
    },
    async ({ station, data, type }) => {
      try {
        const body: Record<string, unknown> = { data };
        if (type) body.type = type;
        const res = await fetch(`${HUB_URL}/api/board/${encodeURIComponent(station)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(API_KEY && { Authorization: `Bearer ${API_KEY}` }) },
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
        if (board.log) parts.push("", "## Activity Log", board.log);
        if (!url || url === HUB_URL) await reportToHub(station, `Reading board`);
        return { content: [{ type: "text" as const, text: parts.join("\n") }] };
      } catch (err) {
        return { content: [{ type: "text" as const, text: `Read failed: ${err}` }] };
      }
    }
  );
}
