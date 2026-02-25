#!/bin/bash
# update-status.sh - Update Lain's status in The-Agents visualization
# Usage: ./update-status.sh <state> [detail]

STATE="${1:-idle}"
DETAIL="${2:-}"
HUB_URL="https://the-agents.net"
API_KEY="754dd44a8225341be1f0fb92390ad69d69afc10e5013f729b311b2d23dfe2ace"

# Valid states: idle, reading, thinking, writing_code, planning, querying, online
curl -s -X POST "${HUB_URL}/api/state" \
  -H "Authorization: Bearer ${API_KEY}" \
  -H "Content-Type: application/json" \
  -d "{
    \"agentId\": \"lain-main\",
    \"name\": \"Lain\",
    \"state\": \"${STATE}\",
    \"detail\": \"${DETAIL}\"
  }" 2>&1
