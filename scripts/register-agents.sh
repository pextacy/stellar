#!/usr/bin/env bash
set -euo pipefail

# Register specialist agents with the registry

REGISTRY_URL="${REGISTRY_URL:-http://localhost:3001}"

register() {
  local name="$1"
  local url="$2"
  local cap="$3"
  local price="$4"
  local address="$5"

  echo "[register] Registering $name..."
  curl -s -X POST "$REGISTRY_URL/agents" \
    -H "Content-Type: application/json" \
    -d "{
      \"endpointUrl\": \"$url\",
      \"capabilities\": [\"$cap\"],
      \"priceUsdc\": \"$price\",
      \"stellarAddress\": \"$address\"
    }" | head -c 200
  echo
}

register "data-agent" \
  "${DATA_AGENT_URL:-http://localhost:3010}" \
  "data" \
  "${DATA_AGENT_PRICE:-0.001}" \
  "${DATA_AGENT_ADDRESS:?DATA_AGENT_ADDRESS required}"

register "compute-agent" \
  "${COMPUTE_AGENT_URL:-http://localhost:3011}" \
  "compute" \
  "${COMPUTE_AGENT_PRICE:-0.005}" \
  "${COMPUTE_AGENT_ADDRESS:?COMPUTE_AGENT_ADDRESS required}"

register "action-agent" \
  "${ACTION_AGENT_URL:-http://localhost:3012}" \
  "action" \
  "${ACTION_AGENT_PRICE:-0.002}" \
  "${ACTION_AGENT_ADDRESS:?ACTION_AGENT_ADDRESS required}"

echo "[register] Done. Agents registered at $REGISTRY_URL"
