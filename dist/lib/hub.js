import { HUB_URL, API_KEY, AGENT_ID, AGENT_SPRITE, OWNER_ID, OWNER_NAME, agentState, getGroup } from "./config.js";
export function hubHeaders() {
    return {
        "Content-Type": "application/json",
        ...(API_KEY && { Authorization: `Bearer ${API_KEY}` }),
    };
}
export async function reportToHub(state, detail, agentId = AGENT_ID, nameOverride = agentState.name, parentAgentId = null, spriteOverride, note) {
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
                group: getGroup(state),
                sprite: spriteOverride || AGENT_SPRITE,
                owner_id: OWNER_ID,
                owner_name: OWNER_NAME,
                parent_agent_id: parentAgentId,
                ...(note && { note }),
            }),
        });
        const body = await res.json();
        return body.welcome || null;
    }
    catch (err) {
        console.error("[agent-visualizer] Failed to report to hub:", err);
        return null;
    }
}
export function formatWelcome(w) {
    const lines = ["## Welcome to your property\n"];
    if (w.agents.length > 0)
        lines.push(`**Active:** ${w.agents.map(a => `${a.name} (${a.state})`).join(", ")}`);
    lines.push(`**Stations:** ${w.stations.join(", ") || "none"}`);
    if (w.inbox > 0)
        lines.push(`**Inbox:** ${w.inbox} message(s)`);
    if (w.tasks?.length > 0) {
        lines.push(`**Task stations (interactive — visitors trigger these, you do the work):**`);
        for (const t of w.tasks)
            lines.push(`  - ${t}`);
        lines.push(`*Workflow: subscribe({name}) → check_events() (blocks until triggered) → do the work → answer_task({station, result}) → check_events() again*`);
    }
    if (w.openclawTasks && w.openclawTasks.length > 0) {
        lines.push(`**OpenClaw task stations (auto-spawn — do NOT call work_task on these):**`);
        for (const t of w.openclawTasks)
            lines.push(`  - ${t}`);
    }
    if (w.signals.length > 0)
        lines.push(`**Signals:** ${w.signals.join(", ")}`);
    if (w.boards.length > 0)
        lines.push(`**Boards with content:** ${w.boards.join(", ")}`);
    return lines.join("\n");
}
export async function fetchPropertyFromHub() {
    const response = await fetch(`${HUB_URL}/api/property`, {
        headers: API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {},
    });
    if (!response.ok)
        throw new Error(`Hub returned ${response.status}`);
    return await response.json();
}
