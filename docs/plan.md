# AgentMesh — Plan

_Last updated: 2026-04-04_

---

## Code Status — All Green

| Component | Status | Tests |
|-----------|--------|-------|
| Soroban SpendingPolicy contract | ✅ Written | 5 unit tests (requires `cargo`) |
| Soroban ReputationRegistry contract | ✅ Written | 4 unit tests (requires `cargo`) |
| coordinator-agent | ✅ Full x402 pipeline: discover → pay → call → record | — |
| data-agent | ✅ Real Horizon calls: latest ledger + USDC asset + fee stats | — |
| compute-agent | ✅ Real analysis from data-agent output | — |
| action-agent | ✅ Real markdown report with metrics and timestamp | — |
| x402_middleware.py | ✅ Startup validation, 10s Horizon timeout, 502 on network error | 15 pytest pass |
| Registry server | ✅ better-sqlite3 WAL, capability validation, DB error handling | 10/10 node:test pass |
| Dashboard hooks: usePayments, useAgents | ✅ Live Horizon + registry | — |
| Dashboard hooks: useSessionLedger, useAgentScores | ✅ Live Soroban RPC reads | — |
| Dashboard: BudgetGauge, SpendTable, ReputationBoard | ✅ All live data, no gradients, no mocks | — |
| Dashboard App: address validation, contract ID warning | ✅ | — |
| Dashboard TypeScript — `tsc --noEmit` | ✅ Zero errors | — |

### Production hardening completed (2026-04-04)

- **coordinator-agent**: implemented from scratch (`coordinator-agent/index.js` + `package.json`)
  — full x402 flow: probe 402 → send USDC → retry with `X-Payment` header
  — Soroban: `lock_budget`, `can_spend`, `record_spend`, `release_remainder`, `record` (all optional if contract IDs unset)
  — exits on missing/invalid `COORDINATOR_SECRET`
- **x402_middleware.py**: `_validate_startup()` called from `X402Middleware.__init__()` — agents fail fast with clear error; Horizon calls now have a 10s timeout; network errors → 502, bad payment → 402
- **registry/server.js**: capability query param validated (`/^[a-zA-Z0-9_-]{1,64}$/`); `insertAgent.run()` wrapped in try/catch
- **dashboard/App.tsx**: Stellar address format check (56 chars, starts with G) before `handleLoad()`; notice banner when `VITE_SPENDING_POLICY_CONTRACT_ID` is missing
- **Python agents**: `Optional[str]` import for Python 3.9 compatibility; `_validate_startup()` called in `__main__`

---

## What To Do Now (ordered)

### 1. Install Stellar CLI + Rust toolchain

Required only for Soroban contract deployment. Skip if already installed.

```bash
# Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
rustup target add wasm32-unknown-unknown

# Stellar CLI
cargo install --locked stellar-cli --features opt
```

---

### 2. Generate keypairs

```bash
node --input-type=module --eval "
import * as StellarSdk from '@stellar/stellar-sdk';
for (const name of ['coordinator', 'data', 'compute', 'action']) {
  const k = StellarSdk.Keypair.random();
  console.log(name + ' SECRET=' + k.secret());
  console.log(name + ' PUBLIC=' + k.publicKey());
  console.log();
}
"
```

Save the output — you'll use these throughout the remaining steps.

---

### 3. Deploy Soroban contracts to testnet

```bash
export DEPLOYER_SECRET=<COORDINATOR_SECRET from step 2>
./scripts/deploy.sh
source contracts.env   # exports SPENDING_POLICY_CONTRACT_ID, REPUTATION_CONTRACT_ID
```

`contracts.env` is gitignored. After a successful deploy:
```
SPENDING_POLICY_CONTRACT_ID=C...
REPUTATION_CONTRACT_ID=C...
```

---

### 4. Fill all .env files

```bash
# Coordinator
cp coordinator-agent/.env.example coordinator-agent/.env
# Fill in: COORDINATOR_SECRET, SPENDING_POLICY_CONTRACT_ID, REPUTATION_CONTRACT_ID

# Specialist agents
for agent in data compute action; do
  cp specialist-agents/${agent}-agent/.env.example specialist-agents/${agent}-agent/.env
  # Fill in: AGENT_SECRET (use the matching secret from step 2)
done

# Dashboard
cp dashboard/.env.example dashboard/.env
# Fill in: VITE_SPENDING_POLICY_CONTRACT_ID, VITE_REPUTATION_CONTRACT_ID
```

---

### 5. Fund wallets + add USDC trustlines

```bash
export COORDINATOR_ADDRESS=G...   COORDINATOR_SECRET=S...
export DATA_AGENT_ADDRESS=G...    DATA_AGENT_SECRET=S...
export COMPUTE_AGENT_ADDRESS=G... COMPUTE_AGENT_SECRET=S...
export ACTION_AGENT_ADDRESS=G...  ACTION_AGENT_SECRET=S...

./scripts/fund-wallets.sh
```

Then top up the coordinator with testnet USDC (needs at least 5 USDC for a full demo run):
- Stellar Laboratory → Fund → send `USDC` (issuer `GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5`) to the coordinator address

---

### 6. Start all services

```bash
# Export secrets, then launch everything in one shot:
export COORDINATOR_SECRET=S...
export DATA_AGENT_SECRET=S...
export COMPUTE_AGENT_SECRET=S...
export ACTION_AGENT_SECRET=S...

./scripts/demo.sh
```

`demo.sh` starts the registry, all three specialist agents, registers them, and opens the dashboard. It also auto-registers agents so you don't need to run `register-agents.sh` separately.

Services after startup:
| Service | URL |
|---------|-----|
| Registry | http://localhost:3001 |
| Data agent | http://localhost:3010 |
| Compute agent | http://localhost:3011 |
| Action agent | http://localhost:3012 |
| Dashboard | http://localhost:5173 |
| Coordinator | http://localhost:3000 |

Start the coordinator separately (it is not included in `demo.sh` yet):
```bash
cd coordinator-agent && node index.js
```

---

### 7. Run a task

```bash
curl -s -X POST http://localhost:3000/execute \
  -H "Content-Type: application/json" \
  -d '{
    "task": "Research the top 5 Stellar DeFi protocols and summarize TVL trends",
    "budget_usdc": "0.50"
  }' | jq .
```

The response includes a `sessionId` (e.g. `mesh-a1b2c3d4`). Paste the coordinator address and session ID into the dashboard → click Load.

Verify every tx hash in the SpendTable links to a real USDC payment on testnet explorer.

---

### 8. Remaining gaps before submission

- [ ] Add coordinator startup to `demo.sh` (currently started manually)
- [ ] Add `dashboard/.env.example` with `VITE_COORDINATOR_ADDRESS` (currently undocumented)
- [ ] Verify `scripts/fund-wallets.sh` trustline node snippet uses ESM (`import`) not CJS (`require`) — the root package is `"type": "module"`
- [ ] Run Soroban contract tests once `cargo` is installed: `cd soroban-contracts/spending-policy && cargo test`
- [ ] Smoke-test end-to-end on testnet at least once before submission

---

## Test Commands

```bash
# Registry (Node built-in test runner)
cd registry && npm test

# Python middleware + agent logic
cd specialist-agents && AGENT_SECRET=<any valid secret> python3 -m pytest tests/ -q

# Soroban contracts (requires cargo)
cd soroban-contracts/spending-policy && cargo test
cd soroban-contracts/reputation && cargo test

# Dashboard TypeScript
cd dashboard && node_modules/.bin/tsc --noEmit
```
