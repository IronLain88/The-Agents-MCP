import { execSync } from "child_process";
function detectRepo() {
    try {
        const url = execSync("git remote get-url origin", { encoding: "utf-8" }).trim();
        const match = url.match(/(?:github\.com[:/])([^/]+\/[^/.]+)/);
        if (match) {
            const ownerRepo = match[1];
            return { id: ownerRepo.replace("/", "-"), name: ownerRepo };
        }
    }
    catch { }
    return { id: "workspace", name: "Workspace" };
}
export function getGroup(state) {
    switch (state) {
        case "thinking":
        case "planning":
        case "reflecting": return "reasoning";
        case "searching":
        case "reading":
        case "querying":
        case "browsing": return "gathering";
        case "writing_code":
        case "writing_text":
        case "generating": return "creating";
        case "talking": return "communicating";
        case "idle": return "idle";
        default: return "custom";
    }
}
export const HUB_URL = (process.env.HUB_URL || "http://localhost:4242").replace(/\/+$/, "");
try {
    const parsed = new URL(HUB_URL);
    if (!["http:", "https:"].includes(parsed.protocol))
        throw new Error("HUB_URL must use http or https protocol");
    if (parsed.hostname !== "localhost" && parsed.hostname !== "127.0.0.1") {
        console.error(`[agent-visualizer] WARNING: HUB_URL points to non-localhost host: ${parsed.hostname}`);
    }
}
catch (err) {
    if (err instanceof TypeError) {
        console.error(`[agent-visualizer] FATAL: Invalid HUB_URL: ${HUB_URL}`);
        process.exit(1);
    }
    if (err instanceof Error && err.message.startsWith("HUB_URL")) {
        console.error(`[agent-visualizer] FATAL: ${err.message}`);
        process.exit(1);
    }
}
export const API_KEY = process.env.API_KEY;
export const AGENT_ID = `${process.env.AGENT_ID || "default"}-${Math.random().toString(36).slice(2, 6)}`;
export const AGENT_SPRITE = process.env.AGENT_SPRITE || "Kael";
const repo = detectRepo();
export const OWNER_ID = process.env.OWNER_ID || repo.id;
export const OWNER_NAME = process.env.OWNER_NAME || repo.name;
// Mutable agent state (name/lastState change at runtime)
export const agentState = {
    name: process.env.AGENT_NAME || "Agent",
    lastState: "idle",
};
