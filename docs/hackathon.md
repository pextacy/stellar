# AgentMesh — Hackathon Strategy

## Why This Wins

Hackathon judges evaluate on three axes: originality, technical depth, and real Stellar integration. AgentMesh scores on all three in ways that competing submissions cannot easily replicate.

### Originality
The agent-to-agent economy concept is novel. AlphaClaw (Base Sepolia), MicroPay (cross-chain), and RoboBazaar (robots + humans) are adjacent but none of them implement programmable spending policy in a smart contract on Stellar. That combination — x402 + Soroban spending limits + reputation scoring — has not been built before.

### Technical Depth
- Soroban contracts written in Rust, deployed to testnet, verified on-chain
- x402 protocol implemented end-to-end (not just described)
- Real multi-agent orchestration: coordinator plans, discovers, pays, tracks
- Reputation scoring with on-chain history

### Real Stellar Integration
- Native USDC transfers (not bridged, not simulated)
- Soroban for programmable guarantees (not just payments)
- Horizon API for dashboard data
- Stellar SDK used throughout
- All transactions verifiable on testnet explorer

## Differentiator vs Competing Projects

| Project | What it does | What it lacks |
|---------|-------------|---------------|
| AlphaClaw | Agent marketplace via x402 on Base Sepolia | Not on Stellar, no Soroban |
| MicroPay | Cross-chain agent micropayments | No Soroban spending policy |
| RoboBazaar | Robots posting bounties to humans | Not autonomous agent-to-agent |
| toku.agency | Agent service marketplace | Fiat + wallet-to-wallet, no smart contract policy |

AgentMesh is the only submission with **contract-level spending enforcement** on Stellar. "Spend no more than $0.05 on the data agent this session" is not an application rule that can be bypassed — it is enforced by the Soroban contract before the payment is authorized.

## Demo Script

The demo must be reproducible by a judge with no setup. Target: judge opens browser, watches terminal, sees money move.

### Setup (pre-demo)
```bash
# 1. Deploy Soroban contracts
cd soroban-contracts && stellar contract deploy --network testnet

# 2. Fund agent wallets via Friendbot
stellar account fund --network testnet G...COORDINATOR
stellar account fund --network testnet G...DATA_AGENT
stellar account fund --network testnet G...COMPUTE_AGENT

# 3. Start specialist agents
cd specialist-agents && docker compose up

# 4. Start registry
cd registry && npm start

# 5. Open dashboard
cd dashboard && npm run dev
```

### Live Demo Flow
1. Submit goal: "Research the top 5 Stellar DeFi protocols and summarize TVL trends"
2. Budget: 0.50 USDC
3. Coordinator plans: data fetch → compute analysis → action (format report)
4. Watch dashboard: agents appear, payments fire, spend ticks up
5. Force a spend cap: pre-configure data agent cap at $0.05, try to trigger second call
6. Contract rejects overspend — coordinator routes to cheaper agent
7. Session ends: remainder returned to user wallet
8. Show testnet explorer: every tx hash visible, contract state readable

### What Judges Verify
- Click any tx hash in dashboard → Stellar testnet explorer shows real USDC transfer
- Read contract state: `stellar contract read --id $CONTRACT_ID` shows spend ledger
- Reputation scores on-chain: `stellar contract invoke --fn get_score --arg G...DATA_AGENT`

## Technical Risks and Mitigations

| Risk | Mitigation |
|------|-----------|
| Soroban contract bugs | Write tests first, use `soroban-sdk` test harness, deploy early (day 2) |
| x402 latency over 10s | Use Stellar testnet (fast), batch reputation writes async |
| Dashboard shows stale data | Use Horizon streaming API (EventSource), not polling |
| Testnet congestion | Use dedicated funded wallets, not shared |
| x402 spec edge cases | Pin to `@stellar/x402` version used in official starter template |

## Related Resources

- x402 official spec and SDK: x402.org
- Stellar x402 starter: developers.stellar.org/docs/build/apps/x402
- Soroban contract examples: soroban.stellar.org/docs
- AlphaClaw reference implementation: github.com/diassique/alphaclaw
- Stellar Horizon streaming API: developers.stellar.org/api/horizon

## Judging Criteria Mapping

| Criterion | How AgentMesh addresses it |
|-----------|---------------------------|
| Stellar integration depth | Native USDC, Soroban contracts, Horizon API, x402 on Stellar |
| Smart contract usage | SpendingPolicy + ReputationRegistry — not cosmetic, load-bearing |
| Innovation | First agent-to-agent economy with Soroban spending policy |
| Working demo | End-to-end testnet flow, live explorer links, no mocks |
| Code quality | Typed, tested contracts; documented agent interfaces |

## Repo Structure

```
agentmesh/
├── coordinator-agent/      # Node.js, @stellar/sdk, x402 client
├── specialist-agents/
│   ├── data-agent/         # Python + FastAPI + x402 middleware
│   ├── compute-agent/      # Python + FastAPI + x402 middleware
│   └── action-agent/       # Python + FastAPI + x402 middleware
├── soroban-contracts/
│   ├── spending-policy/    # Rust, soroban-sdk
│   └── reputation/         # Rust, soroban-sdk
├── registry/               # Node.js, SQLite
├── dashboard/              # React, @stellar/sdk, Tailwind, no gradients
└── docs/
    ├── overview.md
    ├── prd.md
    ├── hackathon.md
    └── claude.md
```
