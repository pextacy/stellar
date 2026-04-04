/**
 * AgentMesh Coordinator
 *
 * Orchestrates the AI agent task pipeline with x402 micropayments on Stellar.
 *
 * Flow per task:
 *   1. Lock budget in SpendingPolicy Soroban contract
 *   2. Discover agents from registry by capability
 *   3. For each pipeline step (data → compute → action):
 *      a. Check can_spend via contract simulation
 *      b. Probe agent endpoint → receive 402 with payTo/amount/memo
 *      c. Send real USDC payment on Stellar testnet
 *      d. Re-call agent with X-Payment: <txHash>
 *      e. Record spend in SpendingPolicy contract
 *      f. Record reputation in ReputationRegistry contract
 *   4. Release unspent remainder back to coordinator wallet
 *
 * Soroban contract calls are optional: if contract IDs are not configured
 * the pipeline still runs — payments are real but spend enforcement is skipped.
 */

import express from 'express';
import * as StellarSdk from '@stellar/stellar-sdk';
import { randomUUID } from 'crypto';

// ── Startup validation ────────────────────────────────────────────────────────

if (!process.env.COORDINATOR_SECRET) {
  console.error('[coordinator] FATAL: COORDINATOR_SECRET environment variable is required');
  process.exit(1);
}

let keypair;
try {
  keypair = StellarSdk.Keypair.fromSecret(process.env.COORDINATOR_SECRET);
} catch {
  console.error('[coordinator] FATAL: COORDINATOR_SECRET is not a valid Stellar secret key (must start with S)');
  process.exit(1);
}

// ── Config ────────────────────────────────────────────────────────────────────

const PORT = parseInt(process.env.PORT || '3000', 10);
const SPENDING_POLICY_CONTRACT_ID = process.env.SPENDING_POLICY_CONTRACT_ID || '';
const REPUTATION_CONTRACT_ID = process.env.REPUTATION_CONTRACT_ID || '';
const REGISTRY_URL = process.env.REGISTRY_URL || 'http://localhost:3001';
const HORIZON_URL = process.env.HORIZON_URL || 'https://horizon-testnet.stellar.org';
const SOROBAN_RPC_URL = process.env.SOROBAN_RPC_URL || 'https://soroban-testnet.stellar.org';

const USDC_ISSUER = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
const USDC_ASSET = new StellarSdk.Asset('USDC', USDC_ISSUER);
const NETWORK_PASSPHRASE = StellarSdk.Networks.TESTNET;

const horizonServer = new StellarSdk.Horizon.Server(HORIZON_URL);
const sorobanServer = new StellarSdk.rpc.Server(SOROBAN_RPC_URL);

// ── Stellar payment helper ────────────────────────────────────────────────────

/** Send USDC from coordinator wallet to destination. Returns the tx hash. */
async function sendUsdcPayment(destination, amountUsdc, memo) {
  const account = await horizonServer.loadAccount(keypair.publicKey());
  const tx = new StellarSdk.TransactionBuilder(account, {
    fee: StellarSdk.BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      StellarSdk.Operation.payment({
        destination,
        asset: USDC_ASSET,
        amount: amountUsdc,
      }),
    )
    .addMemo(StellarSdk.Memo.text(memo.slice(0, 28)))
    .setTimeout(30)
    .build();

  tx.sign(keypair);
  const result = await horizonServer.submitTransaction(tx);
  return result.hash;
}

// ── Soroban helpers ───────────────────────────────────────────────────────────

/**
 * Build, prepare, sign and submit a Soroban transaction.
 * Polls until confirmed or throws on failure/timeout.
 */
async function submitSorobanTx(contractId, method, args) {
  const account = await sorobanServer.getAccount(keypair.publicKey());
  const contract = new StellarSdk.Contract(contractId);
  const tx = new StellarSdk.TransactionBuilder(account, {
    fee: StellarSdk.BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(contract.call(method, ...args))
    .setTimeout(30)
    .build();

  const prepared = await sorobanServer.prepareTransaction(tx);
  prepared.sign(keypair);

  const sendResult = await sorobanServer.sendTransaction(prepared);
  if (sendResult.status === 'ERROR') {
    throw new Error(`Soroban send error: ${JSON.stringify(sendResult.errorResult)}`);
  }

  const hash = sendResult.hash;
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const status = await sorobanServer.getTransaction(hash);
    if (status.status === StellarSdk.rpc.Api.GetTransactionStatus.SUCCESS) return status;
    if (status.status === StellarSdk.rpc.Api.GetTransactionStatus.FAILED) {
      throw new Error(`Soroban tx failed: ${hash}`);
    }
  }
  throw new Error(`Soroban tx timed out: ${hash}`);
}

/** Simulate a read-only Soroban contract call and return the native JS value. */
async function simulateSorobanRead(contractId, method, args) {
  const account = await sorobanServer.getAccount(keypair.publicKey());
  const contract = new StellarSdk.Contract(contractId);
  const tx = new StellarSdk.TransactionBuilder(account, {
    fee: StellarSdk.BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(contract.call(method, ...args))
    .setTimeout(30)
    .build();

  const result = await sorobanServer.simulateTransaction(tx);
  if ('error' in result) throw new Error(`Contract error: ${result.error}`);
  if (!('result' in result) || !result.result) return undefined;
  return StellarSdk.scValToNative(result.result.retval);
}

// ── Spending policy wrappers ──────────────────────────────────────────────────

function usdcToContractUnits(amountUsdc) {
  return BigInt(Math.round(parseFloat(amountUsdc) * 10_000_000));
}

async function lockBudget(sessionId, amountUsdc) {
  if (!SPENDING_POLICY_CONTRACT_ID) return;
  await submitSorobanTx(SPENDING_POLICY_CONTRACT_ID, 'lock_budget', [
    StellarSdk.nativeToScVal(keypair.publicKey(), { type: 'address' }),
    StellarSdk.nativeToScVal(usdcToContractUnits(amountUsdc), { type: 'i128' }),
    StellarSdk.nativeToScVal(sessionId, { type: 'symbol' }),
  ]);
}

async function canSpend(sessionId, agentAddress, amountUsdc) {
  if (!SPENDING_POLICY_CONTRACT_ID) return true;
  return simulateSorobanRead(SPENDING_POLICY_CONTRACT_ID, 'can_spend', [
    StellarSdk.nativeToScVal(sessionId, { type: 'symbol' }),
    StellarSdk.nativeToScVal(agentAddress, { type: 'address' }),
    StellarSdk.nativeToScVal(usdcToContractUnits(amountUsdc), { type: 'i128' }),
  ]);
}

async function recordSpend(sessionId, agentAddress, amountUsdc, txHash) {
  if (!SPENDING_POLICY_CONTRACT_ID) return;
  await submitSorobanTx(SPENDING_POLICY_CONTRACT_ID, 'record_spend', [
    StellarSdk.nativeToScVal(sessionId, { type: 'symbol' }),
    StellarSdk.nativeToScVal(agentAddress, { type: 'address' }),
    StellarSdk.nativeToScVal(usdcToContractUnits(amountUsdc), { type: 'i128' }),
    StellarSdk.xdr.ScVal.scvBytes(Buffer.from(txHash, 'hex')),
  ]);
}

async function releaseRemainder(sessionId) {
  if (!SPENDING_POLICY_CONTRACT_ID) return;
  await submitSorobanTx(SPENDING_POLICY_CONTRACT_ID, 'release_remainder', [
    StellarSdk.nativeToScVal(sessionId, { type: 'symbol' }),
    StellarSdk.nativeToScVal(keypair.publicKey(), { type: 'address' }),
  ]);
}

// ── Reputation wrapper ────────────────────────────────────────────────────────

async function recordReputation(agentAddress, latencyMs, success) {
  if (!REPUTATION_CONTRACT_ID) return;
  await submitSorobanTx(REPUTATION_CONTRACT_ID, 'record', [
    StellarSdk.nativeToScVal(agentAddress, { type: 'address' }),
    StellarSdk.nativeToScVal(keypair.publicKey(), { type: 'address' }),
    StellarSdk.nativeToScVal(BigInt(latencyMs), { type: 'u64' }),
    StellarSdk.nativeToScVal(success, { type: 'bool' }),
  ]);
}

// ── Registry helper ───────────────────────────────────────────────────────────

/** Fetch agents by capability, sorted cheapest-first. */
async function getAgentByCapability(capability) {
  const resp = await fetch(
    `${REGISTRY_URL}/agents?capability=${encodeURIComponent(capability)}`,
  );
  if (!resp.ok) throw new Error(`Registry error: ${resp.status}`);
  const agents = await resp.json();
  if (agents.length === 0) throw new Error(`No agents registered for capability: ${capability}`);
  return agents.sort((a, b) => parseFloat(a.priceUsdc) - parseFloat(b.priceUsdc))[0];
}

// ── x402 agent call ───────────────────────────────────────────────────────────

/**
 * Call an agent endpoint using the x402 payment protocol.
 * 1. Probe the endpoint → expect 402 with payment instructions.
 * 2. Send real USDC payment on Stellar.
 * 3. Retry with X-Payment header containing the tx hash.
 */
async function callAgentWithPayment(agent, body, sessionId) {
  const url = agent.endpointUrl;
  const startMs = Date.now();

  // Step 1: probe for payment instructions
  const probe = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (probe.ok) {
    // Agent accepted without payment (test mode / already funded)
    return { result: await probe.json(), txHash: null, latencyMs: Date.now() - startMs };
  }

  if (probe.status !== 402) {
    const detail = await probe.json().catch(() => ({}));
    throw new Error(`Agent probe returned ${probe.status}: ${JSON.stringify(detail)}`);
  }

  const instructions = await probe.json();
  const payTo = instructions.payTo || agent.stellarAddress;
  const amount = instructions.amount || agent.priceUsdc;
  const memo = (instructions.memo || `mesh-${sessionId}`).slice(0, 28);

  // Step 2: send USDC
  console.log(`[coordinator] → paying ${amount} USDC to ${payTo.slice(0, 8)}... (${url})`);
  const txHash = await sendUsdcPayment(payTo, amount, memo);
  console.log(`[coordinator] ✓ payment tx: ${txHash}`);

  // Step 3: call agent with payment proof
  const paid = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Payment': txHash,
      'X-Payment-Network': 'stellar:testnet',
    },
    body: JSON.stringify(body),
  });

  if (!paid.ok) {
    const detail = await paid.json().catch(() => ({}));
    throw new Error(`Agent rejected after payment (${paid.status}): ${JSON.stringify(detail)}`);
  }

  return {
    result: await paid.json(),
    txHash,
    payTo,
    amount,
    latencyMs: Date.now() - startMs,
  };
}

// ── Pipeline execution ────────────────────────────────────────────────────────

const PIPELINE = ['data', 'compute', 'action'];

async function executeTask({ task, budgetUsdc, sessionId }) {
  const log = [];
  const steps = [];
  let previousResult = null;

  // Lock budget
  try {
    await lockBudget(sessionId, budgetUsdc);
    log.push({ step: 'lock_budget', status: 'ok', budget: budgetUsdc });
  } catch (err) {
    log.push({ step: 'lock_budget', status: 'skipped', reason: err.message });
  }

  for (const capability of PIPELINE) {
    // Discover agent
    let agent;
    try {
      agent = await getAgentByCapability(capability);
    } catch (err) {
      log.push({ step: capability, status: 'skipped', reason: err.message });
      continue;
    }

    // Spending policy check
    let allowed;
    try {
      allowed = await canSpend(sessionId, agent.stellarAddress, agent.priceUsdc);
    } catch (err) {
      log.push({ step: capability, status: 'warning', reason: `can_spend check failed: ${err.message}` });
      allowed = true; // continue if contract unavailable
    }

    if (!allowed) {
      console.log(`[coordinator] ✗ ${capability}: spending cap exceeded, routing skipped`);
      log.push({ step: capability, status: 'blocked', agent: agent.endpointUrl, reason: 'spending cap exceeded' });
      continue;
    }

    // Call agent
    let callResult;
    try {
      callResult = await callAgentWithPayment(
        agent,
        { task, capability, sessionId, previousResult },
        sessionId,
      );
    } catch (err) {
      console.error(`[coordinator] ✗ ${capability} agent error:`, err.message);
      log.push({ step: capability, status: 'error', agent: agent.endpointUrl, error: err.message });
      await recordReputation(agent.stellarAddress, 0, false).catch(() => {});
      continue;
    }

    const { result, txHash, payTo, amount, latencyMs } = callResult;

    // Record spend in contract
    if (txHash) {
      try {
        await recordSpend(sessionId, payTo || agent.stellarAddress, amount || agent.priceUsdc, txHash);
      } catch (err) {
        log.push({ step: `${capability}_record_spend`, status: 'warning', error: err.message });
      }
    }

    // Record reputation (fire-and-forget, never blocks the pipeline)
    recordReputation(agent.stellarAddress, latencyMs, true).catch(() => {});

    steps.push({ capability, agent: agent.endpointUrl, txHash, latencyMs });
    log.push({ step: capability, status: 'ok', agent: agent.endpointUrl, txHash, latencyMs });
    previousResult = result?.result ?? result;
  }

  // Release remainder
  try {
    await releaseRemainder(sessionId);
    log.push({ step: 'release_remainder', status: 'ok' });
  } catch (err) {
    log.push({ step: 'release_remainder', status: 'skipped', reason: err.message });
  }

  return { sessionId, steps, log, finalResult: previousResult };
}

// ── HTTP API ──────────────────────────────────────────────────────────────────

const app = express();
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    coordinator: keypair.publicKey(),
    contracts: {
      spendingPolicy: SPENDING_POLICY_CONTRACT_ID || null,
      reputation: REPUTATION_CONTRACT_ID || null,
    },
    registry: REGISTRY_URL,
  });
});

app.post('/execute', async (req, res) => {
  const { task, budget_usdc, session_id } = req.body ?? {};

  if (!task || typeof task !== 'string' || !task.trim()) {
    return res.status(400).json({ error: 'task is required' });
  }
  if (!budget_usdc || isNaN(parseFloat(budget_usdc)) || parseFloat(budget_usdc) <= 0) {
    return res.status(400).json({ error: 'budget_usdc must be a positive numeric string' });
  }

  const sessionId = (typeof session_id === 'string' && session_id.trim())
    ? session_id.trim()
    : `mesh-${randomUUID().slice(0, 8)}`;

  console.log(`[coordinator] session=${sessionId} task="${task}" budget=${budget_usdc} USDC`);

  try {
    const result = await executeTask({
      task: task.trim(),
      budgetUsdc: budget_usdc,
      sessionId,
    });
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error(`[coordinator] session ${sessionId} fatal error:`, err);
    res.status(500).json({ error: err.message, sessionId });
  }
});

app.listen(PORT, () => {
  console.log(`[coordinator] ready on http://localhost:${PORT}`);
  console.log(`[coordinator] wallet: ${keypair.publicKey()}`);
  if (!SPENDING_POLICY_CONTRACT_ID) {
    console.warn('[coordinator] WARNING: SPENDING_POLICY_CONTRACT_ID not set — contract enforcement disabled');
  }
  if (!REPUTATION_CONTRACT_ID) {
    console.warn('[coordinator] WARNING: REPUTATION_CONTRACT_ID not set — reputation tracking disabled');
  }
});
