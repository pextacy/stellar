# AgentMesh — Product Requirements Document

## Problem Statement

AI agents calling external services today require either:
1. Pre-negotiated API keys (manual setup, per-provider)
2. Human approval for each payment (breaks autonomy)
3. Trust in a platform intermediary (centralized, opaque)

None of these work for autonomous multi-agent workflows at scale. A coordinator agent that needs to call 50 specialist agents during one session cannot be pre-credentialed with all of them, cannot wait for human authorization on each call, and should not route all money through a third party.

x402 solves the credential problem. Stellar solves the payment cost and speed problem. Soroban solves the trust problem. AgentMesh assembles them into a working system.

## Goals

1. Demonstrate end-to-end autonomous agent task execution funded by USDC on Stellar testnet
2. Show Soroban spending policy enforced at the contract level — not just application logic
3. Make all agent calls, payments, and reputation updates verifiable on-chain
4. Produce a reusable x402 middleware package that any agent can adopt

## Non-Goals

- Production mainnet deployment (testnet is sufficient for the hackathon)
- Support for non-Stellar payment networks
- Marketplace UI for listing/discovering agents publicly (registry is local for demo)
- Agent training or fine-tuning

## Users

**Primary:** Hackathon judges evaluating Stellar integration depth and originality.

**Secondary (post-hackathon):** Developers building multi-agent workflows who want pay-per-call economics without platform lock-in.

## Functional Requirements

### FR-1: Budget Locking
- User specifies a USDC amount and session goal
- Coordinator locks budget in SpendingPolicy Soroban contract
- Contract enforces per-agent caps (e.g., max $0.05 to any single agent per session)
- Unspent budget is returned to user when session ends

### FR-2: Agent Discovery
- Registry stores agent endpoint, capability tags, pricing, and Stellar address
- Coordinator queries Registry to identify agents needed for a given goal
- Registry returns agents sorted by reputation score descending

### FR-3: x402 Payment Flow
- Every specialist agent runs x402 middleware
- On unauthenticated request: returns 402 with Stellar payment instructions
- Coordinator reads 402 response, checks spending policy, signs and sends payment
- Agent verifies payment on Stellar before returning result

### FR-4: Soroban Spending Policy
- Contract stores: budget, per-agent cap, session expiry, coordinator address
- `can_spend(agent_address, amount)` — returns bool, callable by coordinator
- `record_spend(agent_address, amount, tx_hash)` — updates session ledger
- `release_remainder()` — callable after session end, returns unspent USDC to user

### FR-5: Reputation Scoring
- After each successful call: coordinator calls `ReputationRegistry.record(agent, latency_ms, success: bool)`
- Score is a weighted rolling average (accuracy × 0.7 + speed_score × 0.3)
- Score is readable by anyone (public view function)
- Coordinator uses score to break ties between agents with same capability

### FR-6: Dashboard
- Shows live session state fetched from Soroban contract + Stellar Horizon API
- Per-agent spend table with tx hash links to testnet explorer
- Reputation leaderboard
- Budget gauge (locked / spent / remaining)
- No polling mock data — all reads hit real Stellar testnet

## Non-Functional Requirements

### NFR-1: Frontend
- No CSS gradients anywhere in the UI
- No mock/hardcoded data — all state from live Stellar testnet
- Flat, utility-first styling (Tailwind or plain CSS)

### NFR-2: Latency
- x402 round-trip (coordinator → payment → result) must complete in under 10 seconds for demo viability
- Soroban contract calls must not be on the critical path of agent responses (fire-and-forget for reputation writes)

### NFR-3: Testnet
- All USDC transfers use Stellar testnet
- Friendbot used for initial XLM funding of agent wallets
- Contract deployed to testnet before demo

### NFR-4: Verifiability
- Every payment traceable on Stellar testnet explorer via session memo
- Contract address published and readable
- Dashboard links each spend row to its Horizon transaction

## User Stories

**As a user**, I submit a goal and a $1 USDC budget. I watch the coordinator break it into tasks, call specialist agents, pay each one, and return a result — all without me approving individual transactions.

**As a specialist agent operator**, I add x402 middleware to my HTTP service, register in the AgentMesh registry with my Stellar address and price, and start earning USDC for each call automatically.

**As a hackathon judge**, I open the dashboard, see real transaction hashes, click through to the Stellar testnet explorer, and verify that money actually moved and that the Soroban contract actually enforced the spending cap.

## Milestones

| Week | Deliverable |
|------|-------------|
| 1, days 1–2 | Soroban contracts written, tested, deployed to testnet |
| 1, days 3–4 | x402 middleware for specialist agents, basic payment flow working |
| 1, days 5–7 | Coordinator agent: planning + x402 client + registry queries |
| 2, days 1–3 | Three specialist agents live on testnet, end-to-end flow working |
| 2, days 4–5 | Dashboard: live data, spend table, reputation leaderboard |
| 2, days 6–7 | Polish, demo script, README, submission |

## Success Criteria

- End-to-end demo runs without human intervention after goal submission
- At least 5 x402 payments settle on Stellar testnet during the demo
- Soroban spending cap is visibly enforced (coordinator is blocked from overspending)
- Dashboard shows live data with real testnet explorer links
- All source code is in the repo with no mock data paths
