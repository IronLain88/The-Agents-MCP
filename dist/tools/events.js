import { z } from "zod";
import { HUB_URL, API_KEY, AGENT_ID } from "../lib/config.js";
import { fetchPropertyFromHub, reportToHub } from "../lib/hub.js";
import { getSubscribedStations, setSubscribedStations, isWsOpen, connectSignalWs, waitForSignal, tryClaimPendingTask, } from "../lib/signals.js";
export function register(server) {
    server.tool("subscribe", "Subscribe to station(s). After subscribing, call check_events() in a loop. " +
        "With no name: subscribes to ALL task stations you're allowed to work on. " +
        "With a name: subscribes to that specific signal or task station. " +
        "For tasks: check_events returns instructions → do work → answer_task → check_events again. " +
        "For signals: check_events returns the event payload.", { name: z.string().optional().describe("Station name, or omit to subscribe to all your task stations") }, async ({ name }) => {
        try {
            const property = await fetchPropertyFromHub();
            if (!name) {
                const taskStations = (property.assets || []).filter((a) => {
                    if (!a.task || a.openclaw_task)
                        return false;
                    const assignedTo = a.assigned_to;
                    return !assignedTo || AGENT_ID.startsWith(assignedTo);
                });
                if (taskStations.length === 0) {
                    return { content: [{ type: "text", text: "No task stations available for you on this property." }] };
                }
                setSubscribedStations(taskStations.map((a) => a.station).filter((s) => !!s));
                if (!isWsOpen())
                    connectSignalWs();
                const stations = getSubscribedStations();
                const pending = taskStations.filter((a) => {
                    try {
                        return a.content?.data && JSON.parse(a.content.data).status === "pending";
                    }
                    catch {
                        return false;
                    }
                });
                const pendingNote = pending.length > 0 ? ` ${pending.length} task(s) already pending — call check_events() now.` : "";
                return { content: [{ type: "text", text: `Subscribed to ${stations.length} task station(s): ${stations.join(", ")}. Call check_events() to wait for work.${pendingNote}` }] };
            }
            const asset = (property.assets || []).find((a) => a.station === name && (a.trigger || a.task));
            if (!asset)
                return { content: [{ type: "text", text: `No signal or task station "${name}" found on property` }] };
            setSubscribedStations([name]);
            if (!isWsOpen())
                connectSignalWs();
            if (asset.task) {
                let state = { status: "idle" };
                try {
                    if (asset.content?.data)
                        state = JSON.parse(asset.content.data);
                }
                catch { }
                const pending = state.status === "pending" ? " A task is already pending — call check_events() now." : "";
                return { content: [{ type: "text", text: `Subscribed to task station "${name}". Call check_events() to wait for work.${pending}` }] };
            }
            return { content: [{ type: "text", text: `Subscribed to "${name}" (${asset.trigger} every ${asset.trigger_interval || 1} min). Call check_events() to wait.` }] };
        }
        catch (err) {
            return { content: [{ type: "text", text: `Subscribe failed: ${err}` }] };
        }
    });
    server.tool("check_events", "Wait for the next event on your subscribed station(s) (up to 10 min). " +
        "For task stations, automatically claims the task and returns structured instructions. " +
        "Call subscribe first.", {}, async () => {
        const stations = getSubscribedStations();
        if (stations.length === 0)
            return { content: [{ type: "text", text: "Not subscribed to any station. Call subscribe() first." }] };
        if (!isWsOpen())
            connectSignalWs();
        for (const station of stations) {
            const pending = await tryClaimPendingTask(station);
            if (pending)
                return { content: [{ type: "text", text: pending }] };
        }
        const waitMsg = stations.length > 1 ? `On duty (${stations.length} stations)` : `Waiting at ${stations[0]}`;
        const keepalive = setInterval(() => reportToHub(stations[0], waitMsg).catch(() => { }), 120_000);
        try {
            const result = await waitForSignal();
            for (const station of stations) {
                const taskResult = await tryClaimPendingTask(station);
                if (taskResult)
                    return { content: [{ type: "text", text: taskResult }] };
            }
            return { content: [{ type: "text", text: result + "\n\nRemember to call update_state for your next activity." }] };
        }
        catch {
            return { content: [{ type: "text", text: "No events (timeout). Call check_events() again to keep waiting." }] };
        }
        finally {
            clearInterval(keepalive);
        }
    });
    server.tool("fire_signal", "Fire a signal. All agents subscribed to this signal will receive the event. " +
        "Use for inter-agent communication or triggering workflows.", {
        name: z.string().describe('The signal station name to fire, e.g. "Deploy Check"'),
        payload: z.any().optional().describe("Optional payload data (requires ALLOW_SIGNAL_PAYLOADS=true on hub)"),
    }, async ({ name, payload }) => {
        try {
            const body = { station: name };
            if (payload !== undefined)
                body.payload = payload;
            const res = await fetch(`${HUB_URL}/api/signals/fire`, {
                method: "POST",
                headers: { "Content-Type": "application/json", ...(API_KEY && { Authorization: `Bearer ${API_KEY}` }) },
                body: JSON.stringify(body),
            });
            if (!res.ok)
                return { content: [{ type: "text", text: `Fire failed: ${res.statusText}` }] };
            return { content: [{ type: "text", text: `Fired signal "${name}"` }] };
        }
        catch (err) {
            return { content: [{ type: "text", text: `Fire failed: ${err}` }] };
        }
    });
}
