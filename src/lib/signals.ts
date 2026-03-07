import WebSocket from "ws";
import { HUB_URL, API_KEY, AGENT_ID } from "./config.js";
import { fetchPropertyFromHub, hubHeaders, type Asset } from "./hub.js";

interface SignalMessage {
  type: string;
  station: string;
  trigger: string;
  timestamp: number;
  payload?: unknown;
}

let signalWs: WebSocket | null = null;
let subscribedStations: string[] = [];
let pendingResolve: ((msg: SignalMessage) => void) | null = null;
const signalQueue: SignalMessage[] = [];
const MAX_QUEUE_SIZE = 50;

export function getSubscribedStations(): string[] { return subscribedStations; }
export function setSubscribedStations(stations: string[]): void { subscribedStations = stations; }
export function isWsOpen(): boolean { return !!signalWs && signalWs.readyState === WebSocket.OPEN; }

export function connectSignalWs(): void {
  const wsUrl = HUB_URL.replace(/^http/, "ws");
  signalWs = new WebSocket(wsUrl);
  signalWs.on("message", (raw: Buffer) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.type === "signal" && subscribedStations.includes(msg.station)) {
        if (pendingResolve) {
          const resolve = pendingResolve;
          pendingResolve = null;
          resolve(msg);
        } else {
          signalQueue.push(msg);
          if (signalQueue.length > MAX_QUEUE_SIZE) {
            signalQueue.shift();
            console.warn(`[mcp] Signal queue full (${MAX_QUEUE_SIZE}), dropped oldest signal`);
          }
        }
      }
    } catch {}
  });
  signalWs.on("close", () => {
    signalWs = null;
    if (subscribedStations.length > 0) setTimeout(connectSignalWs, 3_000);
  });
  signalWs.on("error", () => {});
}

function formatSignalEvent(msg: SignalMessage): string {
  return JSON.stringify({
    timestamp: msg.timestamp,
    time: new Date(msg.timestamp).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }),
    trigger: msg.trigger,
    station: msg.station,
    payload: msg.payload,
    queueSize: signalQueue.length,
  }, null, 2);
}

export async function waitForSignal(): Promise<string> {
  if (signalQueue.length > 0) return formatSignalEvent(signalQueue.shift()!);
  const msg = await new Promise<SignalMessage>((resolve, reject) => {
    pendingResolve = resolve;
    setTimeout(() => {
      if (pendingResolve === resolve) { pendingResolve = null; reject(new Error("timeout")); }
    }, 10 * 60_000);
  });
  return formatSignalEvent(msg);
}

export async function tryClaimPendingTask(station: string): Promise<string | null> {
  try {
    const property = await fetchPropertyFromHub();
    const asset = (property.assets || []).find((a: Asset) => a.station === station && a.task);
    if (!asset) return null;
    let state = { status: "idle" } as Record<string, unknown>;
    try { if (asset.content?.data) state = JSON.parse(asset.content.data); } catch {}
    if (state.status !== "pending") return null;

    await fetch(`${HUB_URL}/api/task/${encodeURIComponent(station)}/claim`, {
      method: "POST",
      headers: hubHeaders(),
      body: JSON.stringify({ agent_id: AGENT_ID }),
    });

    const parts: string[] = [`# Task: ${station}\n`];
    const instructions = (asset as any).instructions;
    const prompt = state.prompt as string | undefined;
    if (instructions && prompt) { parts.push(`## Instructions\n${instructions}\n`, `## Request\n${prompt}\n`); }
    else if (instructions) { parts.push(`## Instructions\n${instructions}\n`); }
    else if (prompt) { parts.push(`## Instructions\n${prompt}\n`); }
    parts.push(`## Required steps`);
    parts.push(`1. Call update_state before EVERY step so viewers see you working (e.g. searching, reading, writing_code, thinking). This is mandatory.`);
    parts.push(`2. Do the work described in the instructions above`);
    parts.push(`3. Call answer_task("${station}", "<h2>Result</h2><p>your HTML result</p>")`);
    parts.push(`4. Then call check_events() again to wait for the next task`);
    return parts.join("\n");
  } catch { return null; }
}
