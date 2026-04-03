#!/usr/bin/env bash
set -euo pipefail

# ═══════════════════════════════════════════════════════════
# AgentMesh Demo — launches all services for live demo
#
# Prerequisites:
#   - Node.js 20+
#   - Python 3.11+ with pip
#   - Stellar CLI (for contract deploy)
#   - Funded testnet wallets
#
# Usage:
#   export COORDINATOR_SECRET=S...
#   export DATA_AGENT_SECRET=S...
#   export COMPUTE_AGENT_SECRET=S...
#   export ACTION_AGENT_SECRET=S...
#   ./scripts/demo.sh
# ═══════════════════════════════════════════════════════════

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

log() { echo -e "${GREEN}[demo]${NC} $1"; }
info() { echo -e "${BLUE}[demo]${NC} $1"; }

# Check env
if [ -z "${COORDINATOR_SECRET:-}" ]; then
  echo "Missing COORDINATOR_SECRET. Generate keypairs first:"
  echo "  node -e \"const{Keypair}=require('@stellar/stellar-sdk');const k=Keypair.random();console.log('Secret:',k.secret(),'\\nPublic:',k.publicKey())\""
  exit 1
fi

PIDS=()
cleanup() {
  log "Stopping services..."
  for pid in "${PIDS[@]}"; do
    kill "$pid" 2>/dev/null || true
  done
  wait 2>/dev/null
  log "Done."
}
trap cleanup EXIT

# ── 1. Registry ──
log "Starting registry..."
cd "$PROJECT_ROOT/registry"
npm install --silent 2>/dev/null
node server.js &
PIDS+=($!)
sleep 1
info "Registry: http://localhost:3001"

# ── 2. Specialist agents ──
log "Installing Python dependencies..."
cd "$PROJECT_ROOT/specialist-agents"
pip install -q -r shared/requirements.txt 2>/dev/null || pip3 install -q -r shared/requirements.txt 2>/dev/null

log "Starting data-agent..."
cd "$PROJECT_ROOT/specialist-agents/data-agent"
AGENT_SECRET="${DATA_AGENT_SECRET:-$COORDINATOR_SECRET}" \
  AGENT_PRICE_USDC=0.001 \
  PORT=3010 \
  python3 main.py &
PIDS+=($!)

log "Starting compute-agent..."
cd "$PROJECT_ROOT/specialist-agents/compute-agent"
AGENT_SECRET="${COMPUTE_AGENT_SECRET:-$COORDINATOR_SECRET}" \
  AGENT_PRICE_USDC=0.005 \
  PORT=3011 \
  python3 main.py &
PIDS+=($!)

log "Starting action-agent..."
cd "$PROJECT_ROOT/specialist-agents/action-agent"
AGENT_SECRET="${ACTION_AGENT_SECRET:-$COORDINATOR_SECRET}" \
  AGENT_PRICE_USDC=0.002 \
  PORT=3012 \
  python3 main.py &
PIDS+=($!)

sleep 2
info "Data agent:    http://localhost:3010"
info "Compute agent: http://localhost:3011"
info "Action agent:  http://localhost:3012"

# ── 3. Register agents ──
log "Registering agents..."

# Derive public keys from secrets
DATA_ADDR=$(node -e "const{Keypair}=require('@stellar/stellar-sdk');console.log(Keypair.fromSecret(process.env.DATA_AGENT_SECRET||process.env.COORDINATOR_SECRET).publicKey())")
COMPUTE_ADDR=$(node -e "const{Keypair}=require('@stellar/stellar-sdk');console.log(Keypair.fromSecret(process.env.COMPUTE_AGENT_SECRET||process.env.COORDINATOR_SECRET).publicKey())")
ACTION_ADDR=$(node -e "const{Keypair}=require('@stellar/stellar-sdk');console.log(Keypair.fromSecret(process.env.ACTION_AGENT_SECRET||process.env.COORDINATOR_SECRET).publicKey())")

curl -s -X POST http://localhost:3001/agents \
  -H "Content-Type: application/json" \
  -d "{\"endpointUrl\":\"http://localhost:3010\",\"capabilities\":[\"data\"],\"priceUsdc\":\"0.001\",\"stellarAddress\":\"$DATA_ADDR\"}" > /dev/null

curl -s -X POST http://localhost:3001/agents \
  -H "Content-Type: application/json" \
  -d "{\"endpointUrl\":\"http://localhost:3011\",\"capabilities\":[\"compute\"],\"priceUsdc\":\"0.005\",\"stellarAddress\":\"$COMPUTE_ADDR\"}" > /dev/null

curl -s -X POST http://localhost:3001/agents \
  -H "Content-Type: application/json" \
  -d "{\"endpointUrl\":\"http://localhost:3012\",\"capabilities\":[\"action\"],\"priceUsdc\":\"0.002\",\"stellarAddress\":\"$ACTION_ADDR\"}" > /dev/null

info "Agents registered."

# ── 4. Dashboard ──
log "Starting dashboard..."
cd "$PROJECT_ROOT/dashboard"
npm install --silent 2>/dev/null
npx vite --port 5173 &
PIDS+=($!)
sleep 2
info "Dashboard: http://localhost:5173"

# ── Ready ──
echo
log "══════════════════════════════════════════"
log "  AgentMesh demo running"
log ""
log "  Registry:  http://localhost:3001"
log "  Data:      http://localhost:3010"
log "  Compute:   http://localhost:3011"
log "  Action:    http://localhost:3012"
log "  Dashboard: http://localhost:5173"
log ""
log "  Run a task:"
log "    omx mesh run --task \"Research Stellar DeFi\" --budget 0.50"
log ""
log "  Press Ctrl+C to stop all services"
log "══════════════════════════════════════════"

wait
