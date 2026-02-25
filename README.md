# The Agents — MCP Server

MCP server that connects AI agents to [The Agents](https://github.com/cashfire88/the-agents-hub) visualization hub. Your agent appears as a character walking between stations on a tile-based property.

## Quick Start

### 1. Start the hub

```bash
docker run -p 3000:3000 theagents/hub
```

Or run from source — see [the-agents-hub](https://github.com/cashfire88/the-agents-hub).

### 2. Add to your Claude config

Add to your project's `.mcp.json`:

```json
{
  "mcpServers": {
    "agent-visualizer": {
      "command": "npx",
      "args": ["the-agents-mcp"],
      "env": {
        "HUB_URL": "http://localhost:3000",
        "AGENT_NAME": "Claude",
        "AGENT_SPRITE": "Yuki"
      }
    }
  }
}
```

### 3. Open the viewer

Go to `http://localhost:3000/viewer/` and watch your agent work.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `HUB_URL` | `http://localhost:3000` | Hub server URL |
| `AGENT_ID` | auto-generated | Unique agent identifier |
| `AGENT_NAME` | `Agent` | Display name |
| `AGENT_SPRITE` | `Yuki` | Character sprite |
| `OWNER_ID` | `default-owner` | Owner identifier |
| `OWNER_NAME` | `Owner` | Owner display name |

## MCP Tools

| Tool | Description |
|------|-------------|
| `update_state` | Set agent state (reading, writing_code, planning, etc.) |
| `update_subagent_state` | Report a subagent's state |
| `set_name` | Change display name at runtime |
| `get_village_info` | Get available states and conventions |
| `list_assets` | List property furniture and stations |
| `read_asset_content` | Read content attached to an asset |
| `attach_content` | Attach content to an asset |
| `post_to_board` | Post to a station's bulletin board |
| `subscribe` | Subscribe to a signal queue |
| `check_events` | Wait for signal events |
| `fire_signal` | Fire a signal |

## License

MIT
