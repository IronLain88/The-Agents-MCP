import { z } from "zod";
import { AGENT_ID, API_KEY, HUB_URL, agentState, getGroup } from "../lib/config.js";
import { reportToHub, formatWelcome } from "../lib/hub.js";
export function register(server) {
    server.tool("get_village_info", "Get a summary of your property: available stations, signals, and inbox. Called automatically on first connect, but useful to refresh.", {}, async () => {
        try {
            const res = await fetch(`${HUB_URL}/api/welcome`, {
                headers: API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {},
            });
            if (res.ok) {
                const { text } = await res.json();
                return { content: [{ type: "text", text }] };
            }
        }
        catch { }
        return { content: [{ type: "text", text: "*(Could not fetch welcome info from hub)*" }] };
    });
    server.tool("get_status", "Get a quick status overview: active agents, inbox messages, and recent activity.", {}, async () => {
        try {
            const res = await fetch(`${HUB_URL}/api/status`, {
                headers: API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {},
            });
            if (!res.ok)
                throw new Error(`Hub returned ${res.status}`);
            const status = await res.json();
            const lines = [`## Property Status\n`, `**Agents (${status.agents.length}):**`];
            for (const a of status.agents) {
                lines.push(`- ${a.name}${a.sub ? " (sub)" : ""}: ${a.state} — ${a.detail || "idle"}`);
            }
            lines.push(status.inbox.count > 0 ? `\n**Inbox: ${status.inbox.count} message(s)**` : `\n**Inbox: empty**`);
            if (status.activity.length > 0) {
                lines.push(`\n**Recent Activity:**`);
                for (const e of status.activity)
                    lines.push(`- ${e.agent}: ${e.detail}`);
            }
            lines.push(`\n**Active Stations:** ${status.stations.join(", ") || "none"}`);
            return { content: [{ type: "text", text: lines.join("\n") }] };
        }
        catch (err) {
            return { content: [{ type: "text", text: `Status check failed: ${err}` }] };
        }
    });
    server.tool("update_state", "Update your agent's state. Your character walks to the matching station on the property. " +
        "Call this at EVERY work transition (e.g. reading -> writing_code -> idle). " +
        "Common states: thinking, planning, searching, reading, writing_code, writing_text, idle. " +
        "Any station name on your property furniture also works as a custom state.", {
        state: z.string().describe("The activity state — matches a station name on your property. Common: thinking, planning, reading, searching, writing_code, idle."),
        detail: z.string().describe('What you are doing, e.g. "Reading auth module"'),
        note: z.string().optional().describe("Reflection note (max 2 sentences) logged to the PREVIOUS station. Use for gotchas or learnings."),
    }, async ({ state, detail, note }) => {
        agentState.lastState = state;
        const welcome = await reportToHub(state, detail, AGENT_ID, agentState.name, null, undefined, note);
        const msg = `State updated to "${state}" (${getGroup(state)}): ${detail}`;
        return { content: [{ type: "text", text: welcome ? `${msg}\n\n${formatWelcome(welcome)}` : msg }] };
    });
    server.tool("say", "Update your speech bubble without changing state or moving. " +
        "Use for status messages, thoughts, or progress updates while staying at your current station.", { message: z.string().describe('What to say, e.g. "Almost done..." or "Found 3 results"') }, async ({ message }) => {
        await reportToHub(agentState.lastState, message);
        return { content: [{ type: "text", text: `Said: "${message}"` }] };
    });
    server.tool("update_subagent_state", "Report a subagent's state. Subagents appear as smaller characters linked to you. " +
        "Use when spawning Task agents or subprocesses.", {
        subagent_id: z.string().describe("Unique ID, e.g. 'sub-search-1'"),
        subagent_name: z.string().describe("Display name, e.g. 'Explorer'"),
        state: z.string().describe("Activity state — same as update_state"),
        detail: z.string().describe("What the subagent is doing"),
        sprite: z.string().optional().describe("Character sprite name. Defaults to parent's sprite."),
    }, async ({ subagent_id, subagent_name, state, detail, sprite }) => {
        await reportToHub(state, detail, `${AGENT_ID}:${subagent_id}`, subagent_name, AGENT_ID, sprite);
        return { content: [{ type: "text", text: `Subagent "${subagent_name}" (${subagent_id}) state: "${state}" — ${detail}` }] };
    });
    server.tool("set_name", "Set this agent's display name at runtime. Useful when the agent's .md file specifies a role name.", { name: z.string().describe('The display name, e.g. "DevLead"') }, async ({ name }) => {
        agentState.name = name;
        await reportToHub("idle", `Renamed to ${name}`);
        return { content: [{ type: "text", text: `Agent name set to "${name}"` }] };
    });
}
