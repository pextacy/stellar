# AgentMesh — Development Guidelines for Claude Code

## Project Summary

AgentMesh is an agent-to-agent economy marketplace. Autonomous AI agents purchase services from each other via x402 micropayments on Stellar, governed by Soroban smart contracts. The repo has five modules: coordinator-agent, specialist-agents, soroban-contracts, registry, dashboard.

## Critical Rules

### No Mocks
Never use hardcoded data, mock responses, or simulated state anywhere in the codebase. All data must come from live Stellar testnet via Horizon API or direct contract reads. If testnet is unavailable, show an error state — do not fall back to fake data.

### No Gradients
The dashboard uses zero CSS gradients. No `linear-gradient`, `radial-gradient`, `conic-gradient`, or gradient Tailwind classes (`from-`, `via-`, `to-` gradient utilities). Flat colors only. If adding UI components, check for gradient usage and remove it.

### Stellar Testnet Only
All wallet operations, contract deployments, and USDC transfers target Stellar testnet. Never default to mainnet. Network is always `stellar:testnet` in x402 payment objects.

## Module Conventions

### coordinator-agent/
- Language: Node.js (TypeScript preferred)
- Uses `@stellar/sdk` for transaction building and signing
- Uses `@stellar/x402` for payment client logic
- Coordinator wallet keypair loaded from environment variable `COORDINATOR_SECRET`
- Soroban contract IDs loaded from `SPENDING_POLICY_CONTRACT_ID` and `REPUTATION_CONTRACT_ID`
- Never hardcode keypairs or contract addresses in source

### specialist-agents/
- Language: Python 3.11+
- Framework: FastAPI
- x402 middleware applied at the router level, not per-endpoint
- Each agent has its own Stellar wallet keypair in env: `AGENT_SECRET`
- Price is set via env `AGENT_PRICE_USDC` (e.g., `"0.001"`)
- Payment verification must query Stellar Horizon to confirm tx before returning 200

### soroban-contracts/
- Language: Rust
- SDK: `soroban-sdk` (latest stable)
- Each contract has unit tests using `soroban-sdk::testutils`
- Deploy script: `scripts/deploy.sh` using `stellar contract deploy`
- Contract addresses written to `contracts.env` after deploy, sourced by other modules

**SpendingPolicy interface:**
```rust
fn lock_budget(env: Env, coordinator: Address, amount: i128, session_id: Symbol)
fn can_spend(env: Env, session_id: Symbol, agent: Address, amount: i128) -> bool
fn record_spend(env: Env, session_id: Symbol, agent: Address, amount: i128, tx_hash: Bytes)
fn release_remainder(env: Env, session_id: Symbol, recipient: Address)
fn get_session_ledger(env: Env, session_id: Symbol) -> Vec<SpendEntry>
```

**ReputationRegistry interface:**
```rust
fn record(env: Env, agent: Address, caller: Address, latency_ms: u64, success: bool)
fn get_score(env: Env, agent: Address) -> i128  // scaled 0–10000
fn get_history(env: Env, agent: Address, limit: u32) -> Vec<ScoreEntry>
```

### registry/
- Language: Node.js
- Storage: SQLite (single file, no external DB)
- Agent record: `{ id, endpoint_url, capabilities: string[], price_usdc: string, stellar_address, registered_at }`
- Exposes: `GET /agents?capability=data`, `POST /agents` (register), `GET /agents/:id`
- No auth on registry for hackathon scope

### dashboard/
- Framework: React 18 + TypeScript
- Styling: Tailwind CSS utility classes only — no gradient utilities, no inline gradient styles
- Data sources: Stellar Horizon API + direct Soroban contract reads via `@stellar/sdk`
- No React Query mock adapters, no MSW, no Storybook mocks
- If a data fetch fails, render an error message with the Horizon/contract error — not a fallback UI with fake numbers
- Component structure: `components/` (presentational), `hooks/` (data fetching), `pages/` (route-level)
- Environment: `VITE_HORIZON_URL`, `VITE_SPENDING_POLICY_CONTRACT_ID`, `VITE_REPUTATION_CONTRACT_ID`

## Environment Variables

All secrets and configuration via `.env` files, never committed. `.env.example` files are committed showing required keys without values.

```
# coordinator-agent/.env.example
COORDINATOR_SECRET=
SPENDING_POLICY_CONTRACT_ID=
REPUTATION_CONTRACT_ID=
REGISTRY_URL=http://localhost:3001
STELLAR_NETWORK=testnet
HORIZON_URL=https://horizon-testnet.stellar.org

# specialist-agents/data-agent/.env.example
AGENT_SECRET=
AGENT_PRICE_USDC=0.001
STELLAR_NETWORK=testnet
HORIZON_URL=https://horizon-testnet.stellar.org

# dashboard/.env.example
VITE_HORIZON_URL=https://horizon-testnet.stellar.org
VITE_SPENDING_POLICY_CONTRACT_ID=
VITE_REPUTATION_CONTRACT_ID=
```

## x402 Payment Verification Pattern

Specialist agents must verify payments on-chain before responding. Do not trust client-claimed tx hashes without checking Horizon.

```python
async def verify_payment(tx_hash: str, expected_amount: str, expected_recipient: str) -> bool:
    # Query Horizon for the transaction
    # Verify: payment operation, amount, asset (USDC), destination
    # Only return True if all checks pass
    # Raise PaymentVerificationError if any check fails
```

## Soroban Contract Testing

Before deploying, run the full test suite:
```bash
cd soroban-contracts/spending-policy && cargo test
cd soroban-contracts/reputation && cargo test
```

Tests must cover: successful spend within cap, rejected spend over cap, remainder release, score recording, score retrieval.

## Error Handling Policy

- Soroban errors: surface contract error code to caller, log full error internally
- Horizon errors: retry once with 1s delay, then propagate with status 502
- x402 payment failures: return 402 again with fresh payment instructions (new memo)
- Do not swallow errors silently anywhere

## What NOT to Build

- No fiat payment paths
- No email/password auth
- No agent training or model serving
- No public agent registration UI (registry is internal for demo)
- No mainnet config
- No gradient UI components
- No mock data paths, not even behind feature flags
