import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { HUB_URL, API_KEY, agentState } from "../lib/config.js";
import { hubHeaders } from "../lib/hub.js";

interface DtoTrailEntry {
  station: string;
  by: string;
  at: string;
  data: string;
}

interface Dto {
  id: string;
  type: string;
  created_at: string;
  trail: DtoTrailEntry[];
}

export function register(server: McpServer): void {
  server.tool(
    "create_dto",
    "Create a DTO (data transfer object) at a station queue. " +
      "DTOs travel through stations, each stop appending to a trail of results. " +
      "Use forward_dto to send it to the next station.",
    {
      station: z.string().describe("Station to place the DTO at"),
      data: z.string().describe("Initial payload data"),
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
    "Receive (pop) the next DTO from a station queue. Returns the DTO with its full trail. " +
      "After processing, call forward_dto to send it to the next station.",
    {
      station: z.string().describe("Station to receive from"),
    },
    async ({ station }) => {
      try {
        const res = await fetch(`${HUB_URL}/api/queue/${encodeURIComponent(station)}`, {
          headers: API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {},
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: res.statusText }));
          return { content: [{ type: "text" as const, text: `Failed: ${(err as { error: string }).error}` }] };
        }
        const { dtos } = await res.json() as { dtos: Dto[] };
        if (dtos.length === 0) return { content: [{ type: "text" as const, text: `No DTOs waiting at "${station}"` }] };

        const dto = dtos[0];
        const trail = dto.trail.map(e => `  - ${e.station} (${e.by}): ${e.data}`).join("\n");
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
