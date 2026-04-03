#!/usr/bin/env bash
set -euo pipefail

# Fund agent wallets on Stellar testnet via Friendbot

echo "[fund] Funding wallets on testnet..."

fund_wallet() {
  local name="$1"
  local address="$2"
  echo "[fund] Funding $name ($address)..."
  curl -s "https://friendbot.stellar.org?addr=$address" > /dev/null
  echo "[fund] $name funded."
}

if [ -n "${COORDINATOR_ADDRESS:-}" ]; then
  fund_wallet "Coordinator" "$COORDINATOR_ADDRESS"
fi

if [ -n "${DATA_AGENT_ADDRESS:-}" ]; then
  fund_wallet "Data Agent" "$DATA_AGENT_ADDRESS"
fi

if [ -n "${COMPUTE_AGENT_ADDRESS:-}" ]; then
  fund_wallet "Compute Agent" "$COMPUTE_AGENT_ADDRESS"
fi

if [ -n "${ACTION_AGENT_ADDRESS:-}" ]; then
  fund_wallet "Action Agent" "$ACTION_AGENT_ADDRESS"
fi

echo "[fund] Done."
