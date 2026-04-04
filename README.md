# AgentMesh

An open-source agent-to-agent economy where autonomous AI agents purchase services from each other via x402 micropayments on Stellar, governed by Soroban smart contracts that enforce spending limits and reputation scores.

---

## Architecture

```
User Goal + USDC Budget
        │
        ▼
┌────────────────────┐
│   omx mesh run     │  ← CLI coordinator
│  (plans + pays)    │
└────────┬───────────┘
         │  x402 over HTTP
    ┌────┼──────────────┐
    ▼    ▼              ▼
 data  compute       action
 agent  agent         agent
 :3010  :3011         :3012
    │      │              │
    └──────┴──────────────┘
              │
     Soroban Contracts
     ├─ SpendingPolicy    ← enforces per-agent caps
     └─ ReputationRegistry ← records accuracy + latency
              │
       Dashboard :5173
       (live Horizon + Soroban reads)
```

**Payment flow per agent call:**
1. Coordinator → `POST /` to agent
2. Agent → `402 Payment Required` with USDC amount + Stellar address
3. Coordinator checks Soroban spending cap → signs Stellar payment → sends `X-Payment` header
4. Agent verifies payment on Horizon → returns result
5. Coordinator records spend + reputation on-chain

All payments are native USDC on Stellar testnet. Every transaction is verifiable at [stellar.expert/explorer/testnet](https://stellar.expert/explorer/testnet).

---

## Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| Node.js | 20+ | [nodejs.org](https://nodejs.org) |
| Python | 3.11+ | [python.org](https://python.org) |
| Stellar CLI | latest | `cargo install --locked stellar-cli --features opt` |
| Rust + cargo | stable | [rustup.rs](https://rustup.rs) |

---

## Quickstart

### 1. Generate keypairs

```bash
node -e "
const { Keypair } = require('@stellar/stellar-sdk');
for (const name of ['coordinator', 'data', 'compute', 'action']) {
  const k = Keypair.random();
  console.log(name + ' SECRET=' + k.secret());
  console.log(name + ' PUBLIC=' + k.publicKey());
  console.log();
}
"
```

### 2. Fund wallets + add USDC trustlines

```bash
export COORDINATOR_ADDRESS=G...   COORDINATOR_SECRET=S...
export DATA_AGENT_ADDRESS=G...    DATA_AGENT_SECRET=S...
export COMPUTE_AGENT_ADDRESS=G... COMPUTE_AGENT_SECRET=S...
export ACTION_AGENT_ADDRESS=G...  ACTION_AGENT_SECRET=S...

./scripts/fund-wallets.sh
```

Then send testnet USDC to the coordinator wallet via [Stellar Laboratory](https://laboratory.stellar.org/#account-creator?network=test) (asset: `USDC`, issuer: `GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5`).

### 3. Deploy Soroban contracts

```bash
export DEPLOYER_SECRET=$COORDINATOR_SECRET
./scripts/deploy.sh
source contracts.env   # sets SPENDING_POLICY_CONTRACT_ID, REPUTATION_CONTRACT_ID
```

### 4. Configure environment

```bash
# coordinator-agent/.env
cp coordinator-agent/.env.example coordinator-agent/.env
# Fill: COORDINATOR_SECRET, SPENDING_POLICY_CONTRACT_ID, REPUTATION_CONTRACT_ID

# specialist agents
for agent in data compute action; do
  cp specialist-agents/${agent}-agent/.env.example specialist-agents/${agent}-agent/.env
  # Fill: AGENT_SECRET (use the matching agent secret)
done

# dashboard
cp dashboard/.env.example dashboard/.env
# Fill: VITE_SPENDING_POLICY_CONTRACT_ID, VITE_REPUTATION_CONTRACT_ID, VITE_COORDINATOR_ADDRESS
```

### 5. Start all services

```bash
export COORDINATOR_SECRET=S...
export DATA_AGENT_SECRET=S...
export COMPUTE_AGENT_SECRET=S...
export ACTION_AGENT_SECRET=S...

./scripts/demo.sh
```

This starts: registry (:3001), data-agent (:3010), compute-agent (:3011), action-agent (:3012), dashboard (:5173), and registers all agents.

### 6. Run a task

In a second terminal:

```bash
omx mesh run --task "Research Stellar DeFi protocols and summarize TVL trends" --budget 0.50
```

The coordinator will:
1. Lock 0.50 USDC in the SpendingPolicy contract
2. Discover agents from the registry
3. Call data-agent → compute-agent → action-agent, paying each via x402
4. Enforce the per-agent spending cap on-chain
5. Return the result and release unused budget

Copy the printed session ID (e.g. `mesh-1714000000000`).

### 7. Open the dashboard

Go to [http://localhost:5173](http://localhost:5173)

- Paste the **coordinator address** and **session ID** → click **Load**
- Budget gauge reads live from the SpendingPolicy Soroban contract
- Payments table links each tx to the testnet explorer
- Reputation board shows live scores from the ReputationRegistry contract

---

## Verify on-chain

Every payment is verifiable at:
```
https://stellar.expert/explorer/testnet/tx/<TX_HASH>
```

Read contract state directly:
```bash
source contracts.env

# Session spend ledger
stellar contract invoke \
  --id $SPENDING_POLICY_CONTRACT_ID \
  --network testnet \
  --source $COORDINATOR_SECRET \
  -- get_session_ledger \
  --session_id mesh-1714000000000

# Agent reputation score
stellar contract invoke \
  --id $REPUTATION_CONTRACT_ID \
  --network testnet \
  --source $COORDINATOR_SECRET \
  -- get_score \
  --agent G...DATA_AGENT_ADDRESS
```

---

## Local test (no payments)

```bash
./scripts/demo.sh   # start services

omx mesh run --task "Research Stellar DeFi" --budget 0.50 --local
# Calls agents directly without x402 or Soroban — useful for checking the pipeline
```

---

## Project structure

```
agentmesh/
├── src/
│   ├── cli/mesh.ts                  # omx mesh CLI (run/agents/status)
│   ├── pipeline/stages/             # discover + pay-and-execute stages
│   └── stellar/                     # StellarClient, X402PaymentClient,
│                                    # SpendingPolicyClient, ReputationRegistryClient,
│                                    # X402Middleware (payment + policy + reputation)
├── soroban-contracts/
│   ├── spending-policy/             # Rust: budget locking + per-agent caps
│   └── reputation/                  # Rust: rolling accuracy + latency scores
├── specialist-agents/
│   ├── shared/x402_middleware.py    # FastAPI x402 middleware (on-chain verify)
│   ├── data-agent/                  # Fetches live Horizon data
│   ├── compute-agent/               # Analyzes data-agent output
│   └── action-agent/                # Formats markdown report
├── registry/server.js               # Agent discovery (SQLite)
├── dashboard/                       # React + Tailwind, live Soroban + Horizon reads
├── scripts/
│   ├── deploy.sh                    # Build + deploy Soroban contracts
│   ├── fund-wallets.sh              # Friendbot + USDC trustlines
│   ├── register-agents.sh           # POST agents to registry
│   └── demo.sh                      # Start everything
└── docs/                            # overview, prd, hackathon strategy, plan
```

---

## Why Stellar

- **5-second finality** — agent calls don't block on confirmations
- **~$0.00001/tx** — micropayments at $0.001/call are economically viable
- **Native USDC** — no bridging, real stablecoin settlement
- **Soroban** — programmable spending policy without a trusted intermediary; the spending cap is enforced at the contract level, not the application level
