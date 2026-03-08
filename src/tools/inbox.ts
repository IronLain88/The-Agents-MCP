import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { HUB_URL, API_KEY, agentState } from "../lib/config.js";
import { hubHeaders, reportToHub } from "../lib/hub.js";

interface Dto {
  id: string;
  type: string;
  created_at: string;
  trail: { station: string; by: string; at: string; data: string }[];
}

export function register(server: McpServer): void {
  server.tool(
    "check_inbox",
    "Check your inbox for messages from humans or other agents. " +
      "Returns formatted messages with sender, time, and text.",
    { name: z.string().optional().describe('Inbox name (default: "inbox").') },
    async ({ name }) => {
      const inbox = name || "inbox";
      try {
        const res = await fetch(`${HUB_URL}/api/queue/${encodeURIComponent(inbox)}`, {
          headers: API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {},
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: res.statusText }));
          return { content: [{ type: "text" as const, text: `Inbox check failed: ${(err as { error: string }).error}` }] };
        }
        const { dtos } = await res.json() as { dtos: Dto[] };
        await reportToHub(inbox, "Checking inbox");
        if (dtos.length === 0) return { content: [{ type: "text" as const, text: `${inbox} is empty.` }] };
        const lines = dtos.map(dto => {
          const first = dto.trail[0];
          const time = first?.at
            ? new Date(first.at).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })
            : "";
          return `- ${first?.by || "unknown"}${time ? ` (${time})` : ""}: ${first?.data || "(empty)"}`;
        });
        return { content: [{ type: "text" as const, text: `${dtos.length} message(s):\n${lines.join("\n")}` }] };
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
      inbox: z.string().optional().describe('Target inbox name (default: "inbox").'),
    },
    async ({ text, inbox }) => {
      const target = inbox || "inbox";
      try {
        const res = await fetch(`${HUB_URL}/api/queue/${encodeURIComponent(target)}`, {
          method: "POST", headers: hubHeaders(),
          body: JSON.stringify({ by: agentState.name, data: text }),
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
    { name: z.string().optional().describe('Inbox name to clear (default: "inbox").') },
    async ({ name }) => {
      const target = name || "inbox";
      try {
        const res = await fetch(`${HUB_URL}/api/queue/${encodeURIComponent(target)}`, { method: "DELETE", headers: hubHeaders() });
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
}
