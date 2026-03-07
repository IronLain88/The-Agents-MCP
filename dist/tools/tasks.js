import { z } from "zod";
import { HUB_URL, AGENT_ID } from "../lib/config.js";
import { fetchPropertyFromHub, hubHeaders, reportToHub } from "../lib/hub.js";
import { setSubscribedStations, isWsOpen, connectSignalWs, waitForSignal } from "../lib/signals.js";
export function register(server) {
    server.tool("read_task", "Read a task station's instructions and current status. " +
        "Use get_village_info to discover available tasks first.", { station: z.string().describe('The task station name, e.g. "Reddit Spy"') }, async ({ station }) => {
        try {
            const property = await fetchPropertyFromHub();
            const asset = (property.assets || []).find((a) => a.station === station && a.task);
            if (!asset)
                return { content: [{ type: "text", text: `No task station "${station}" found` }] };
            const parts = [`# Task: ${station}\n`];
            let state = { status: "idle", result: null };
            try {
                if (asset.content?.data)
                    state = JSON.parse(asset.content.data);
            }
            catch { }
            if (state.status === "pending") {
                const instructions = asset.instructions;
                if (instructions)
                    parts.push(`## Instructions\n${instructions}\n`);
                parts.push(`## What to do`);
                parts.push(`1. Call update_state before EVERY step so viewers see you working. This is mandatory.`);
                parts.push(`2. Do the work described above`);
                parts.push(`3. Call answer_task("${station}", "<h2>Result</h2><p>your HTML result</p>")`);
                parts.push(`4. answer_task will instruct you to call work_task again — you MUST do so`);
            }
            else {
                parts.push(`Status: ${state.status === "done" ? "done (previous result posted)" : "idle"}`);
                parts.push(`\n## What to do`);
                parts.push(`Call work_task("${station}") — it blocks until a visitor clicks Run, then gives you instructions.`);
                parts.push(`The loop is: work_task → do work → answer_task → work_task → ... (never stop)`);
            }
            return { content: [{ type: "text", text: parts.join("\n") }] };
        }
        catch (err) {
            return { content: [{ type: "text", text: `Failed: ${err}` }] };
        }
    });
    server.tool("work_task", "Wait for a visitor to trigger a task. Blocks until someone clicks Run, then returns the instructions. " +
        "After doing the work, call answer_task with your HTML result, then call work_task again to wait for the next visitor.", { station: z.string().describe('The task station name, e.g. "Task_Table"') }, async ({ station }) => {
        try {
            await reportToHub(station, `Waiting at ${station}`);
            const property = await fetchPropertyFromHub();
            const asset = (property.assets || []).find((a) => a.station === station && a.task);
            if (!asset)
                return { content: [{ type: "text", text: `No task station "${station}" found` }] };
            if (asset.openclaw_task)
                return { content: [{ type: "text", text: `"${station}" is an openclaw_task station — do NOT call work_task on these.` }] };
            if (asset.assigned_to && !AGENT_ID.startsWith(asset.assigned_to)) {
                return { content: [{ type: "text", text: `Task "${station}" is assigned to "${asset.assigned_to}" only. Your agent ID "${AGENT_ID}" does not match.` }] };
            }
            if (!asset.trigger)
                return { content: [{ type: "text", text: `Task station "${station}" has no trigger` }] };
            let state = { status: "idle" };
            try {
                if (asset.content?.data)
                    state = JSON.parse(asset.content.data);
            }
            catch { }
            if (state.status !== "pending") {
                setSubscribedStations([station]);
                if (!isWsOpen())
                    connectSignalWs();
                const keepalive = setInterval(() => reportToHub(station, `Waiting at ${station}`).catch(() => { }), 120_000);
                try {
                    await waitForSignal();
                }
                catch {
                    return { content: [{ type: "text", text: `Timeout waiting for visitor on "${station}". Call work_task again to keep waiting.` }] };
                }
                finally {
                    clearInterval(keepalive);
                }
            }
            const fresh = await fetchPropertyFromHub();
            const freshAsset = (fresh.assets || []).find((a) => a.station === station && a.task);
            const parts = [`# Task: ${station}\n`];
            const instructions = freshAsset?.instructions;
            if (instructions)
                parts.push(`## Instructions\n${instructions}\n`);
            parts.push(`## Required steps`);
            parts.push(`1. Call update_state before EVERY step so viewers see you working. This is mandatory.`);
            parts.push(`2. Do the work described above`);
            parts.push(`3. Call answer_task("${station}", "<h2>Result</h2><p>your HTML</p>")`);
            parts.push(`4. answer_task will tell you to call work_task again — you MUST do so to keep the loop running`);
            return { content: [{ type: "text", text: parts.join("\n") }] };
        }
        catch (err) {
            return { content: [{ type: "text", text: `work_task failed: ${err}` }] };
        }
    });
    server.tool("answer_task", "Post your result (HTML) to a task station after completing the work. " +
        "Rendered as rich HTML in the viewer. Use headings, lists, links, etc. " +
        "IMPORTANT: After this call returns, you MUST immediately call check_events() again to wait for the next task. Never stop the loop.", {
        station: z.string().describe('The task station name, e.g. "Reddit y2k"'),
        result: z.string().describe('HTML result to display, e.g. "<h2>Results</h2><ul><li>...</li></ul>"'),
    }, async ({ station, result }) => {
        try {
            const res = await fetch(`${HUB_URL}/api/task/${encodeURIComponent(station)}/result`, {
                method: "POST", headers: hubHeaders(), body: JSON.stringify({ result }),
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({ error: res.statusText }));
                return { content: [{ type: "text", text: `Task result failed: ${err.error}` }] };
            }
            await reportToHub(station, "Task complete");
            let isOpenclawTask = false;
            try {
                const property = await fetchPropertyFromHub();
                const asset = (property.assets || []).find((a) => a.station === station && a.task);
                if (asset?.openclaw_task)
                    isOpenclawTask = true;
            }
            catch { }
            return { content: [{ type: "text", text: isOpenclawTask
                            ? `Result posted to "${station}".\n\n✅ Your work is done. This is an openclaw_task station — no need to loop. You may exit or go idle.`
                            : `Result posted to "${station}".\n\n⚠️ REQUIRED NEXT STEP: Call check_events() now to wait for the next task. Do not stop — the loop must continue.` }] };
        }
        catch (err) {
            return { content: [{ type: "text", text: `Task result failed: ${err}` }] };
        }
    });
}
