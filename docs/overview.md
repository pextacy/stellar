# AgentMesh — Technical Overview

## What It Is

AgentMesh is an open-source agent-to-agent economy where autonomous AI agents purchase services from each other via x402 micropayments on Stellar, governed by Soroban smart contracts that enforce spending limits and reputation scores.

Every agent is a plain HTTP endpoint. When one agent needs a service from another, it sends a request and receives HTTP 402 Payment Required with a price. It signs a Stellar payment authorization, sends it back, and receives the resource — no accounts, no subscriptions, no API keys. Payments settle on Stellar in under 5 seconds at ~$0.00001 per transaction.

## Architecture

```
User Goal + USDC Budget
        │
        ▼
┌──────────────────┐
│ Coordinator Agent │  ← holds budget in Soroban contract
│  (planner + x402  │  ← discovers agents via Registry
│   payment client) │  ← pays per-call via x402
└────────┬──────────┘
         │ HTTP + x402
    ┌────┼────────────────────────┐
    ▼    ▼                        ▼
Data    Compute              Action
Agent   Agent                Agent
(x402)  (x402)               (x402)
    │         │                   │
    └────────►│◄──────────────────┘
              ▼
     Soroban Contract
     (spending policy +
      reputation scoring)
              │
              ▼
         Dashboard
    (real-time spend +
     reputation UI)
```

## Components

### coordinator-agent/
The orchestrator. Receives a user goal and budget. Plans the task, queries the Registry for capable agents, calls them via x402, and tracks spend against the Soroban spending policy contract. Runs as a Node.js/Python service.

### specialist-agents/
Three reference agent implementations:
- **data-agent** — fetches, cleans, and returns structured data
- **compute-agent** — runs CPU-heavy inference or analysis
- **action-agent** — performs side effects (API calls, writes, notifications)

Each is an HTTP server with x402 middleware. They accept signed Stellar auth entries and return results after on-chain settlement.

### soroban-contracts/
Two contracts written in Rust:

**SpendingPolicy**
- Holds USDC budget locked by the user
- Enforces per-agent spending caps per session
- Releases funds atomically on verified service delivery
- Reverts to user if session expires unused

**ReputationRegistry**
- Records accuracy and latency scores per agent address
- Updated after each settled call
- Read by Coordinator to route to high-reputation agents
- Score history is fully on-chain and verifiable

### registry/
A lightweight agent discovery service. Agents register with their endpoint URL, capability tags, pricing, and Stellar address. The Coordinator queries it to build a task execution plan.

### dashboard/
A real-time web UI showing:
- Per-session spend breakdown by agent
- Reputation scores and history
- On-chain transaction links (testnet explorer)
- Budget remaining vs committed

No mock data. No gradients. All data comes from live Stellar testnet state.

## Payment Flow (per agent call)

```
1. Coordinator → GET /compute?task=...
2. Compute Agent → 402 Payment Required
   { amount: "0.001", currency: "USDC", network: "stellar:testnet",
     payTo: "G...ADDR", memo: "session-abc-call-007" }
3. Coordinator checks Soroban policy (will this exceed cap?)
4. If allowed: signs Stellar auth entry, sends X-Payment header
5. Compute Agent verifies payment on-chain
6. Compute Agent → 200 OK + result
7. Soroban ReputationRegistry.record(agent, score)
```

## Technology Stack

| Layer | Technology |
|-------|-----------|
| Blockchain | Stellar (testnet → mainnet) |
| Stablecoin | USDC (native on Stellar) |
| Payment protocol | x402 |
| Smart contracts | Soroban (Rust) |
| Coordinator | Node.js + @stellar/sdk |
| Specialist agents | Python + FastAPI + x402 middleware |
| Registry | Node.js + SQLite |
| Dashboard | React + @stellar/sdk (no mock data) |

## Key Properties

- **No custodians.** Budget lives in a Soroban contract, not a platform wallet.
- **No API keys.** x402 makes every agent endpoint self-monetizing and permissionless.
- **Verifiable.** Every payment, every reputation update, every budget release is on-chain.
- **Composable.** Any HTTP service can become an agent by adding x402 middleware.

## Stellar Advantages Used

- **5-second finality** — agent calls don't block waiting for confirmations
- **~$0.00001/tx** — micropayments at $0.001 per call are economically sane
- **Native USDC** — no bridging, no wrapping, real stablecoin settlement
- **Soroban** — programmable spending policy without a trusted intermediary
- **Stellar SDK** — first-class x402 support via `@stellar/x402` package
