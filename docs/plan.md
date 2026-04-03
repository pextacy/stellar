# AgentMesh — Plan

_Last updated: 2026-04-04_

---

## Code Status — All Green

| Component | Status |
|-----------|--------|
| Soroban SpendingPolicy contract | ✅ Full + 5 tests |
| Soroban ReputationRegistry contract | ✅ Full + 4 tests |
| StellarClient, X402PaymentClient | ✅ Real Stellar SDK, no mocks |
| SpendingPolicyClient, ReputationRegistryClient | ✅ All contract methods |
| X402Middleware + transferRemainder | ✅ Reads ledger → sends actual USDC back |
| MppChargeClient, MppMiddleware, createMppPaywall | ✅ Compiles clean (broken @stellar/mpp import fixed) |
| data-agent | ✅ Real Horizon calls: latest ledger + USDC asset + fee stats |
| compute-agent | ✅ Real analysis from data-agent output |
| action-agent | ✅ Real markdown report with metrics and timestamp |
| x402_middleware.py | ✅ On-chain payment verification |
| Registry server | ✅ SQLite, full CRUD |
| Pipeline: discover + pay-and-execute | ✅ transferRemainder wired in |
| `omx mesh` CLI | ✅ run / agents / status |
| Dashboard hooks: usePayments, useAgents | ✅ Live Horizon + registry |
| Dashboard hooks: useSessionLedger, useAgentScores | ✅ Live Soroban RPC reads |
| Dashboard: BudgetGauge, SpendTable, ReputationBoard | ✅ All live data, no gradients, no mocks |
| Dashboard App: session ID input + live budget | ✅ No hardcoded values |
| Scripts: deploy, fund-wallets (with USDC trustlines), register, demo | ✅ |
| Root TypeScript — `tsc --noEmit` | ✅ Zero errors |
| Dashboard TypeScript — `tsc --noEmit` | ✅ Zero errors |

---

## What To Do Now (ordered)

### 1. Write README.md — REQUIRED for submission

No root `README.md` exists. Judges need this to run the demo. Must cover:
- What AgentMesh is (2 sentences)
- Architecture diagram
- Prerequisites (Node 20, Python 3.11, Stellar CLI, Rust/cargo)
- Step-by-step quickstart: generate keys → fund wallets → deploy contracts → start services → run task → open dashboard
- Demo script (what to show judges)
- Link to testnet explorer

File: `README.md` at repo root.

---

### 2. Deploy Soroban contracts to testnet — REQUIRED for live demo

Contracts are written and tested but not deployed. Without deployed contract IDs the coordinator cannot run in non-local mode.

```bash
# Install Stellar CLI if not present
# https://developers.stellar.org/docs/tools/developer-tools/cli/install-and-setup

# Generate coordinator keypair
node -e "const{Keypair}=require('@stellar/stellar-sdk'); const k=Keypair.random(); console.log('SECRET:',k.secret()); console.log('PUBLIC:',k.publicKey())"

# Fund via Friendbot
curl "https://friendbot.stellar.org?addr=<COORDINATOR_ADDRESS>"

# Deploy both contracts — writes contracts.env
export DEPLOYER_SECRET=<COORDINATOR_SECRET>
./scripts/deploy.sh
```

After deploy: `contracts.env` will contain `SPENDING_POLICY_CONTRACT_ID` and `REPUTATION_CONTRACT_ID`.

---

### 3. Fill all .env files

After step 2, fill in:

**`coordinator-agent/.env`** (copy from `.env.example`):
```
COORDINATOR_SECRET=<from step 2>
SPENDING_POLICY_CONTRACT_ID=<from contracts.env>
REPUTATION_CONTRACT_ID=<from contracts.env>
```

**`specialist-agents/data-agent/.env`**, `compute-agent/.env`, `action-agent/.env`:
```
AGENT_SECRET=<each agent's own secret key>
```

**`dashboard/.env`** (copy from `.env.example`):
```
VITE_SPENDING_POLICY_CONTRACT_ID=<from contracts.env>
VITE_REPUTATION_CONTRACT_ID=<from contracts.env>
VITE_COORDINATOR_ADDRESS=<coordinator public key>
```

---

### 4. Fund wallets + add USDC trustlines + get testnet USDC

```bash
export COORDINATOR_ADDRESS=G...  export COORDINATOR_SECRET=S...
export DATA_AGENT_ADDRESS=G...   export DATA_AGENT_SECRET=S...
export COMPUTE_AGENT_ADDRESS=G...  export COMPUTE_AGENT_SECRET=S...
export ACTION_AGENT_ADDRESS=G...   export ACTION_AGENT_SECRET=S...
./scripts/fund-wallets.sh
```

Then add testnet USDC to the coordinator wallet at:
https://laboratory.stellar.org/#account-creator?network=test
(Use the "Send" tab, asset USDC, issuer `GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5`)

---

### 5. Run the demo end-to-end

```bash
# Terminal 1 — start all services
export COORDINATOR_SECRET=S...
export DATA_AGENT_SECRET=S...
export COMPUTE_AGENT_SECRET=S...
export ACTION_AGENT_SECRET=S...
./scripts/demo.sh

# Terminal 2 — run a task
omx mesh run --task "Research Stellar DeFi protocols and summarize TVL trends" --budget 0.50

# Copy the session ID printed (e.g. mesh-1714000000000)
# Open dashboard: http://localhost:5173
# Paste coordinator address + session ID → click Load
```

Verify on testnet explorer: every tx hash in SpendTable is clickable and shows a real USDC payment.

---

## Commands Cheat Sheet

```bash
# TypeScript type checks (already pass)
node_modules/.bin/tsc --noEmit                          # root
cd dashboard && node_modules/.bin/tsc --noEmit          # dashboard

# Soroban tests (requires cargo / Rust toolchain)
cd soroban-contracts/spending-policy && cargo test
cd soroban-contracts/reputation && cargo test

# Deploy contracts
export DEPLOYER_SECRET=S...
./scripts/deploy.sh && source contracts.env

# Fund wallets + trustlines
./scripts/fund-wallets.sh

# Run everything
./scripts/demo.sh

# Task execution
omx mesh run --task "Research Stellar DeFi protocols" --budget 0.50
omx mesh run --task "..." --budget 0.50 --local    # no payments (local test)
omx mesh agents                                     # list registry
omx mesh status --session mesh-1234567890           # read Soroban ledger
```
