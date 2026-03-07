import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { HUB_URL } from "../lib/config.js";
import { fetchPropertyFromHub, hubHeaders, type Asset } from "../lib/hub.js";

export function register(server: McpServer): void {
  server.tool(
    "read_reception",
    "Read a reception station's private instructions and current Q&A state. " +
      "Use this after walking to a reception station to get your instructions and check for pending questions.",
    { station: z.string().describe('The reception station name, e.g. "Help Desk"') },
    async ({ station }) => {
      try {
        const property = await fetchPropertyFromHub();
        const asset = (property.assets || []).find((a: Asset) => a.station === station && (a as any).reception);
        if (!asset) return { content: [{ type: "text" as const, text: `No reception station "${station}" found` }] };

        const parts: string[] = [`# Reception: ${station}\n`];
        const instructions = (asset as any).instructions;
        if (instructions) parts.push(`## Instructions\n${instructions}\n`);

        let state = { status: "idle", question: null as string | null, answer: null as string | null };
        try { if (asset.content?.data) state = JSON.parse(asset.content.data); } catch {}

        parts.push(`## Status: ${state.status}`);
        if (state.status === "pending" && state.question) {
          parts.push(`\n## Question\n${state.question}`);
        } else if (state.status === "answered") {
          parts.push(`\nQuestion: ${state.question}`, `Answer already posted.`);
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
          method: "POST", headers: hubHeaders(), body: JSON.stringify({ answer }),
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
}
