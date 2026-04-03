# AgentMesh — Implementation Plan & Next Steps

## What's Done

### Infrastructure (all building clean)
- **oh-my-codex fork** — full CLI with `omx mesh` command wired in
- **src/stellar/** — 9 TypeScript modules: Stellar client, x402, MPP integration, Soroban contract clients, middleware
- **src/pipeline/stages/** — discover + pay-and-execute stages plugged into omx pipeline
- **soroban-contracts/** — SpendingPolicy + ReputationRegistry in Rust, 9/9 tests pass
- **specialist-agents/** — 3 Python/FastAPI agents (data, compute, action) with x402 middleware
- **registry/** — Express + SQLite agent discovery service
- **dashboard/** — React + Tailwind scaffold (components, hooks, pages)
- **scripts/** — deploy.sh, fund-wallets.sh, register-agents.sh, demo.sh
- **Stellar CLI** installed (v25.2.0)
- **@stellar/mpp** SDK integrated for production-grade x402 payment handling

### Tested Locally
- Registry: starts, registers agents, queries by capability
- Specialist agents: x402 middleware works (402 on unpaid, health free)
- `omx mesh agents` — lists registered agents
- `omx mesh run --task "..." --local` — full pipeline: discover → call agents → collect results
- Soroban contracts: all test cases pass (spend caps, budget enforcement, reputation scoring)

---

## Next Steps (ordered by priority)

### Phase 1: Testnet Deployment (Day 1)
**Owner:** whoever has Stellar CLI + funded testnet account

1. **Generate & fund 4 testnet wallets**
   ```bash
   # Generate keypairs
   node -e "const{Keypair}=require('@stellar/stellar-sdk');for(let n of['coordinator','data','compute','action']){const k=Keypair.random();console.log(n+':',k.publicKey(),k.secret())}"
   
   # Fund via Friendbot
   ./scripts/fund-wallets.sh
   ```

2. **Deploy Soroban contracts**
   ```bash
   export DEPLOYER_SECRET=S...  # coordinator secret
   ./scripts/deploy.sh
   # Writes SPENDING_POLICY_CONTRACT_ID and REPUTATION_CONTRACT_ID to contracts.env
   ```

3. **Verify contracts on testnet**
   ```bash
   source contracts.env
   stellar contract invoke --id $SPENDING_POLICY_CONTRACT_ID --fn lock_budget -- \
     --coordinator G... --amount 1000000 --session_id test1
   stellar contract read --id $SPENDING_POLICY_CONTRACT_ID
   ```

### Phase 2: End-to-End Testnet Flow (Day 1-2)
**Owner:** backend person

1. **Set up USDC trustlines** — each agent wallet needs a USDC trustline on testnet
   ```bash
   # Use Stellar Laboratory or SDK to add USDC trustline for each agent
   ```

2. **Run full `omx mesh run` with real payments**
   ```bash
   source contracts.env
   export COORDINATOR_SECRET=S...
   omx mesh run --task "Research Stellar DeFi protocols" --budget 0.50
   ```
   Expected: coordinator pays each agent via x402, Soroban enforces caps, reputation recorded

3. **Test spending cap enforcement** — set low per-agent cap, try to exceed it
   - The contract sets `per_agent_cap = budget / 10` by default
   - Try calling same agent 11 times — should get rejected

4. **Test remainder release** — verify unspent budget returns to coordinator

### Phase 3: Real Agent Logic (Day 2-3)
**Owner:** whoever is doing the AI/data work

Right now agents return stub data. Make them do real work:

1. **data-agent** — wire up to a real API (CoinGecko, DeFi Llama, or Stellar Horizon itself)
   - File: `specialist-agents/data-agent/main.py`
   - The `execute_task` function needs to actually fetch data based on `req.task`

2. **compute-agent** — wire up to an LLM or analysis pipeline
   - File: `specialist-agents/compute-agent/main.py`
   - Takes `previousResult` from data-agent, runs analysis, returns insights

3. **action-agent** — format output into a report
   - File: `specialist-agents/action-agent/main.py`
   - Takes analysis from compute-agent, produces markdown/structured output

### Phase 4: Dashboard (Day 3-4)
**Owner:** frontend person

1. **Install and run**
   ```bash
   cd dashboard && npm install && npm run dev
   ```

2. **Wire up Soroban contract reads** — the hooks are stubbed, need to call:
   - `SpendingPolicyClient.getSessionLedger()` for live spend data
   - `ReputationRegistryClient.getScore()` for agent scores
   - Use the Soroban RPC URL from env

3. **Add streaming** — use Horizon EventSource for real-time payment updates instead of polling
   ```typescript
   const es = new EventSource(`${HORIZON_URL}/accounts/${address}/payments?cursor=now`);
   es.onmessage = (event) => { /* update state */ };
   ```

4. **Verify no gradients** — check all components use flat colors only (Tailwind utility classes, no `from-`, `via-`, `to-`, no `linear-gradient`)

### Phase 5: Polish & Demo (Day 5-6)

1. **README.md** — write setup instructions, architecture diagram, demo video link

2. **Demo script rehearsal** — follow `docs/hackathon.md` demo flow:
   - Submit goal + budget
   - Watch dashboard as payments fire
   - Force spend cap rejection
   - Show testnet explorer links
   - Read contract state via CLI

3. **Record demo video** — screen recording of the full flow

4. **.env.example audit** — make sure all required vars are documented

---

## Architecture Quick Reference

```
User Goal + Budget
       │
       ▼
┌─────────────────────┐
│  omx mesh run       │  ← CLI entry point
│  (coordinator)      │
└────────┬────────────┘
         │
    ┌────┴────┐
    ▼         ▼
 Discover   Pay & Execute
 (registry)  (x402 + Soroban)
    │         │
    │    ┌────┼─────────────┐
    │    ▼    ▼             ▼
    │  Data  Compute     Action
    │  Agent Agent       Agent
    │  :3010 :3011       :3012
    │    │      │           │
    └────┴──────┴───────────┘
              │
         Soroban Contracts
         ├─ SpendingPolicy
         └─ ReputationRegistry
              │
          Dashboard :5173
          (Horizon + Soroban reads)
```

## Key Files to Edit

| What | File | Language |
|------|------|----------|
| Coordinator pipeline | `src/cli/mesh.ts` | TypeScript |
| x402 client | `src/stellar/mpp-client.ts` | TypeScript |
| Spending policy client | `src/stellar/spending-policy.ts` | TypeScript |
| Reputation client | `src/stellar/reputation.ts` | TypeScript |
| Agent middleware | `specialist-agents/shared/x402_middleware.py` | Python |
| Data agent logic | `specialist-agents/data-agent/main.py` | Python |
| Compute agent logic | `specialist-agents/compute-agent/main.py` | Python |
| Action agent logic | `specialist-agents/action-agent/main.py` | Python |
| Registry | `registry/server.js` | JavaScript |
| Dashboard app | `dashboard/src/pages/App.tsx` | TypeScript/React |
| Dashboard hooks | `dashboard/src/hooks/useStellar.ts` | TypeScript |
| SpendingPolicy contract | `soroban-contracts/spending-policy/src/lib.rs` | Rust |
| Reputation contract | `soroban-contracts/reputation/src/lib.rs` | Rust |
| Deploy script | `scripts/deploy.sh` | Bash |
| Demo launcher | `scripts/demo.sh` | Bash |

## Commands Cheat Sheet

```bash
# Build
npm run build                    # TypeScript
cd soroban-contracts/spending-policy && cargo test  # Rust tests
cd soroban-contracts/reputation && cargo test        # Rust tests

# Run locally
cd registry && node server.js                        # Registry :3001
cd specialist-agents && .venv/bin/python3 data-agent/main.py      # :3010
cd specialist-agents && .venv/bin/python3 compute-agent/main.py   # :3011
cd specialist-agents && .venv/bin/python3 action-agent/main.py    # :3012
cd dashboard && npx vite                             # :5173

# Or all at once
./scripts/demo.sh

# CLI
omx mesh agents                                      # List agents
omx mesh run --task "..." --budget 0.50 --local      # Local (no payments)
omx mesh run --task "..." --budget 0.50              # Testnet (x402 + Soroban)

# Testnet
./scripts/deploy.sh              # Deploy contracts
./scripts/fund-wallets.sh        # Fund wallets
./scripts/register-agents.sh     # Register agents
```
