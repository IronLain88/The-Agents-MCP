import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { HUB_URL, API_KEY, agentState } from "../lib/config.js";
import { hubHeaders } from "../lib/hub.js";

interface DtoTrailEntry {
  station: string;
  by: string;
  at: string;
  data: string | Record<string, unknown>;
}

interface Dto {
  id: string;
  type: string;
  created_at: string;
  trail: DtoTrailEntry[];
}

interface DtoHeader {
  id: string;
  type: string;
  created_at: string;
  agent?: string;
  category?: string;
  tool?: string;
  summary?: string;
}

function dataToText(d: string | Record<string, unknown>): string {
  return typeof d === "object" && d !== null ? JSON.stringify(d) : d;
}

export function register(server: McpServer): void {
  server.tool(
    "create_dto",
    "Create a DTO (data transfer object) at a station queue. " +
      "DTOs travel through stations, each stop appending to a trail of results. " +
      "Use forward_dto to send it to the next station.",
    {
      station: z.string().describe("Station to place the DTO at"),
      data: z.union([z.string(), z.record(z.string(), z.unknown())]).describe("Initial payload data (string or object)"),
      type: z.string().optional().describe('DTO type (default: "message")'),
    },
    async ({ station, data, type }) => {
      try {
        const res = await fetch(`${HUB_URL}/api/queue/${encodeURIComponent(station)}`, {
          method: "POST",
          headers: hubHeaders(),
          body: JSON.stringify({ type: type || "message", by: agentState.name, data }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: res.statusText }));
          return { content: [{ type: "text" as const, text: `Failed to create DTO: ${(err as { error: string }).error}` }] };
        }
        const { dto } = await res.json() as { dto: Dto };
        return { content: [{ type: "text" as const, text: `DTO ${dto.id} created at "${station}"` }] };
      } catch (err) {
        return { content: [{ type: "text" as const, text: `Failed to create DTO: ${err}` }] };
      }
    }
  );

  server.tool(
    "receive_dto",
    "Receive DTOs from a station queue. Returns the DTO(s) with trail. " +
      "Use all=true to get all DTOs at once. Use headers_only=true for compact metadata (saves tokens). " +
      "After processing, call forward_dto to send to the next station.",
    {
      station: z.string().describe("Station to receive from"),
      dto_id: z.string().optional().describe("Optional: specific DTO id to receive (from signal payload)"),
      all: z.boolean().optional().describe("Return all DTOs at this station (default: first only)"),
      headers_only: z.boolean().optional().describe("Return only metadata (id, agent, category, tool, summary) — no trail"),
    },
    async ({ station, dto_id, all, headers_only }) => {
      try {
        const qs = headers_only ? "?headers_only=true" : "";
        const res = await fetch(`${HUB_URL}/api/queue/${encodeURIComponent(station)}${qs}`, {
          headers: API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {},
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: res.statusText }));
          return { content: [{ type: "text" as const, text: `Failed: ${(err as { error: string }).error}` }] };
        }

        if (headers_only) {
          const { dtos } = await res.json() as { dtos: DtoHeader[] };
          if (dtos.length === 0) return { content: [{ type: "text" as const, text: `No DTOs at "${station}"` }] };
          const lines = dtos.map(h => `- ${h.id} [${h.category || h.type}] ${h.agent || "?"}: ${h.summary || h.tool || "no summary"}`);
          return { content: [{ type: "text" as const, text: `${dtos.length} DTOs at "${station}":\n${lines.join("\n")}` }] };
        }

        const { dtos } = await res.json() as { dtos: Dto[] };
        if (dtos.length === 0) return { content: [{ type: "text" as const, text: `No DTOs waiting at "${station}"` }] };

        if (all) {
          const blocks = dtos.map(dto => {
            const trail = dto.trail.map(e => `  - ${e.station} (${e.by}): ${dataToText(e.data)}`).join("\n");
            return `DTO ${dto.id} (type: ${dto.type})\n${trail}`;
          });
          return { content: [{ type: "text" as const, text: `${dtos.length} DTOs at "${station}":\n\n${blocks.join("\n\n")}` }] };
        }

        const dto = dto_id ? dtos.find(d => d.id === dto_id) || dtos[dtos.length - 1] : dtos[0];
        const trail = dto.trail.map(e => `  - ${e.station} (${e.by}): ${dataToText(e.data)}`).join("\n");
        return { content: [{ type: "text" as const, text: `DTO ${dto.id} (type: ${dto.type}) at "${station}"\nTrail:\n${trail}\n\nCall forward_dto to move it to the next station, or delete it to end the pipeline.` }] };
      } catch (err) {
        return { content: [{ type: "text" as const, text: `Failed: ${err}` }] };
      }
    }
  );

  server.tool(
    "forward_dto",
    "Append your result to a DTO's trail and send it to the next station. " +
      "Call receive_dto first to get the DTO id and from_station.",
    {
      dto_id: z.string().describe("The DTO id (from receive_dto)"),
      from_station: z.string().describe("The station the DTO was received from"),
      target_station: z.string().describe("The station to forward to"),
      result: z.string().describe("Your result/contribution to append to the trail"),
    },
    async ({ dto_id, from_station, target_station, result }) => {
      try {
        const res = await fetch(
          `${HUB_URL}/api/queue/${encodeURIComponent(from_station)}/${dto_id}/forward`,
          {
            method: "POST",
            headers: hubHeaders(),
            body: JSON.stringify({ target_station, by: agentState.name, data: result }),
          }
        );
        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: res.statusText }));
          return { content: [{ type: "text" as const, text: `Forward failed: ${(err as { error: string }).error}` }] };
        }
        return { content: [{ type: "text" as const, text: `DTO ${dto_id} forwarded to "${target_station}"` }] };
      } catch (err) {
        return { content: [{ type: "text" as const, text: `Forward failed: ${err}` }] };
      }
    }
  );
}
