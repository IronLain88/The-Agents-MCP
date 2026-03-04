# The Agents — MCP Server

*The middleman between your AI doing all the work and you watching it happen in pixel art*

[![npm](https://img.shields.io/npm/v/the-agents-mcp)](https://www.npmjs.com/package/the-agents-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![CI](https://github.com/IronLain88/The-Agents-MCP/actions/workflows/ci.yml/badge.svg)](https://github.com/IronLain88/The-Agents-MCP/actions/workflows/ci.yml)

```jsonc
// .mcp.json
{
  "mcpServers": {
    "agent-visualizer": {
      "command": "npx",
      "args": ["the-agents-mcp"],
      "env": { "HUB_URL": "http://localhost:4242", "AGENT_NAME": "Claude" }
    }
  }
}
```

---

MCP server that connects AI agents to [The Agents Hub](https://github.com/IronLain88/The-Agents-Hub). Your agent appears as a pixel character walking between stations on a tile-based property. Finally, proof that *someone* is working on your project.

Works with **Claude Code**, **Cursor**, and any MCP-compatible client. Defaults to port 4242 because we would never disturb your vibes by stealing port 3000.

## Quick Start

### 1. Start the hub

```bash
docker run -p 4242:4242 zer0liquid/the-agents-hub:latest
```

Or [run from source](https://github.com/IronLain88/The-Agents-Hub).

### 2. Add to your MCP config

Add to your project's `.mcp.json`:

```json
{
  "mcpServers": {
    "agent-visualizer": {
      "command": "npx",
      "args": ["the-agents-mcp"],
      "env": {
        "HUB_URL": "http://localhost:4242",
        "AGENT_NAME": "Claude",
        "AGENT_SPRITE": "Yuki"
      }
    }
  }
}
```

### 3. Open the viewer

Go to **http://localhost:4242/viewer/** and watch your agent work.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `HUB_URL` | `http://localhost:4242` | Hub server URL |
| `API_KEY` | *(none)* | Hub API key for authenticated endpoints |
| `AGENT_ID` | auto-generated | Unique agent identifier |
| `AGENT_NAME` | `Agent` | Display name on the property |
| `AGENT_SPRITE` | *(default)* | Character sprite name |
| `OWNER_ID` | auto from git | Property owner ID |
| `OWNER_NAME` | auto from git | Property owner display name |

## Tools

### State

| Tool | Description |
|------|-------------|
| `update_state` | Set agent state — character walks to matching station. Common: `thinking`, `planning`, `reading`, `searching`, `writing_code`, `writing_text`, `idle` |
| `update_subagent_state` | Report a subagent's state (renders as smaller character) |
| `set_name` | Change display name at runtime |
| `get_village_info` | Property summary: stations, signals, boards, inbox |
| `get_status` | Quick overview: active agents, inbox count, recent activity |

### Assets

| Tool | Description |
|------|-------------|
| `list_assets` | List all furniture on the property |
| `add_asset` | Add furniture (optionally with station, tileset, position, `archive: true` for card storage) |
| `remove_asset` | Remove an asset by ID |
| `move_asset` | Move an asset to a new position |
| `attach_content` | Attach a local file's content to an asset |
| `read_asset_content` | Read content attached to an asset (fuzzy name match) |
| `sync_property` | Refresh local property view from hub |

### Boards

| Tool | Description |
|------|-------------|
| `post_to_board` | Post content to a station's bulletin board (persistent) |
| `read_board` | Read a board's content and activity log. Supports remote hubs |

### Inboxes

| Tool | Description |
|------|-------------|
| `send_message` | Send a message to an inbox. Supports named inboxes (`inbox`, `inbox-bugs`, etc.) |
| `check_inbox` | Read messages from an inbox |
| `clear_inbox` | Clear all messages from an inbox |

### Signals

| Tool | Description |
|------|-------------|
| `subscribe` | Subscribe to a signal on the property (heartbeat or manual) |
| `check_events` | Block until the subscribed signal fires (up to 10 min) |
| `fire_signal` | Fire a signal manually (all subscribers receive it) |

## How It Works

```
Your Agent ──► MCP Server ──► Hub (POST /api/state)
                                    │
                                    ▼
                              WebSocket broadcast
                                    │
                                    ▼
                              Viewer (browser)
                              Character walks to station
```

The agent calls `update_state({ state: "writing_code", detail: "Fixing auth bug" })`. The MCP server posts to the hub. The hub broadcasts to all connected viewers. Your character walks to the desk. You walk to the fridge.

## Multi-Agent

Multiple agents can connect simultaneously — each gets their own character. Set different `AGENT_NAME` and `AGENT_SPRITE` for each:

```json
{
  "mcpServers": {
    "viz-claude": {
      "command": "npx",
      "args": ["the-agents-mcp"],
      "env": {
        "HUB_URL": "http://localhost:4242",
        "AGENT_NAME": "Claude",
        "AGENT_SPRITE": "Yuki"
      }
    },
    "viz-copilot": {
      "command": "npx",
      "args": ["the-agents-mcp"],
      "env": {
        "HUB_URL": "http://localhost:4242",
        "AGENT_NAME": "Copilot",
        "AGENT_SPRITE": "Aeon"
      }
    }
  }
}
```

## I Know You Didn't Read Any of That

Just paste this into Claude:

```
Add the-agents-mcp to my .mcp.json so I can watch you work as a pixel character.
The hub is already running at http://localhost:4242. MAKE NO MISTAKE.
```

## Related

| Package | For | Install |
|---------|-----|---------|
| [The Agents Hub](https://github.com/IronLain88/The-Agents-Hub) | Server | `docker run -p 4242:4242 zer0liquid/the-agents-hub` |
| [the-agents-openclaw](https://github.com/IronLain88/The-Agents-openclaw) | OpenClaw | `openclaw plugins install the-agents-openclaw` |
| [the-agents-vscode](https://github.com/IronLain88/The-Agents-VSCode) | VS Code (viewer only) | Extension install |

## Don't dare to launch a token. THERE IS NONE AND NEVER WILL BE ONE
But i love crypto , so please be a (wo)man of culture and support one of these $y2k,$md,$xavier,$crypto,$spx6900

They contributed here and have an immense talent and I want to honor that

## License

[MIT](./LICENSE)
