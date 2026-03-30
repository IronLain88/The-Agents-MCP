import { HUB_URL, API_KEY, AGENT_ID, AGENT_SPRITE, OWNER_ID, OWNER_NAME, agentState, getGroup } from "./config.js";

export interface WelcomeData {
  stations: string[];
  signals: string[];
  tasks: string[];
  openclawTasks?: string[];
  inbox: number;
  agents: { name: string; state: string }[];
}

export interface Asset {
  id: string;
  name?: string;
  position: { x: number; y: number } | null;
  station?: string;
  content?: { type: string; data: string; source?: string; publishedAt?: string };
  signal?: { type: string; interval?: number; payload?: unknown; allow_payload?: boolean };
  task?: { type: string; public: boolean; openclaw: boolean; instructions?: string; assigned_to?: string; completion_target?: string };
  prompt?: { template?: string; vars?: Record<string, string> };
  display?: { text?: string; color?: string; bob?: boolean; ox?: number; oy?: number };
  queue?: { max_trail?: number; forward_to?: string };
  remote?: { url: string; station?: string };
  archive?: boolean;
  welcome?: boolean;
  sign?: boolean;
  knowledge?: boolean;
}

export function hubHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    ...(API_KEY && { Authorization: `Bearer ${API_KEY}` }),
  };
}

export async function reportToHub(
  state: string,
  detail: string,
  agentId = AGENT_ID,
  nameOverride = agentState.name,
  parentAgentId: string | null = null,
  spriteOverride?: string,
  note?: string
): Promise<WelcomeData | null> {
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
    const body = await res.json() as { ok: boolean; welcome?: WelcomeData };
    return body.welcome || null;
  } catch (err) {
    console.error("[agent-visualizer] Failed to report to hub:", err);
    return null;
  }
}

export function formatWelcome(w: WelcomeData): string {
  const lines: string[] = ["## Welcome to your property\n"];
  if (w.agents.length > 0) lines.push(`**Active:** ${w.agents.map(a => `${a.name} (${a.state})`).join(", ")}`);
  lines.push(`**Stations:** ${w.stations.join(", ") || "none"}`);
  if (w.inbox > 0) lines.push(`**Inbox:** ${w.inbox} message(s)`);
  if (w.tasks?.length > 0) {
    lines.push(`**Task stations (interactive — visitors trigger these, you do the work):**`);
    for (const t of w.tasks) lines.push(`  - ${t}`);
    lines.push(`*Workflow: subscribe({name}) → check_events() (blocks until triggered) → do the work → answer_task({station, result}) → check_events() again*`);
  }
  if (w.openclawTasks && w.openclawTasks.length > 0) {
    lines.push(`**OpenClaw task stations (auto-spawn — do NOT call work_task on these):**`);
    for (const t of w.openclawTasks) lines.push(`  - ${t}`);
  }
  if (w.signals.length > 0) lines.push(`**Signals:** ${w.signals.join(", ")}`);
  return lines.join("\n");
}

export async function fetchPropertyFromHub(): Promise<{ assets: Asset[]; [key: string]: unknown }> {
  const response = await fetch(`${HUB_URL}/api/property`, {
    headers: API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {},
  });
  if (!response.ok) throw new Error(`Hub returned ${response.status}`);
  return await response.json();
}
