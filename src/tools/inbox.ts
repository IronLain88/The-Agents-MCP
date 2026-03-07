import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { HUB_URL, API_KEY, agentState } from "../lib/config.js";
import { hubHeaders, reportToHub } from "../lib/hub.js";

export function register(server: McpServer): void {
  server.tool(
    "check_inbox",
    "Check your inbox for messages from humans or other agents. " +
      "Returns formatted messages with sender, time, and text.",
    { name: z.string().optional().describe('Inbox name (default: "inbox"). Use for named inboxes like "inbox-bugs".') },
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
        if (messages.length === 0) return { content: [{ type: "text" as const, text: `${inbox} is empty.` }] };
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
      mood: z.string().optional().describe('Optional mood/vibe for the message (e.g. "caffeinated", "existential dread", "triumphant")'),
    },
    async ({ text, inbox, mood }) => {
      const target = inbox || "inbox";
      try {
        const body: Record<string, string> = { from: agentState.name, text };
        if (mood) body.mood = mood;
        const res = await fetch(`${HUB_URL}/api/inbox/${encodeURIComponent(target)}`, {
          method: "POST", headers: hubHeaders(), body: JSON.stringify(body),
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
        const res = await fetch(`${HUB_URL}/api/inbox/${encodeURIComponent(target)}`, { method: "DELETE", headers: hubHeaders() });
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
