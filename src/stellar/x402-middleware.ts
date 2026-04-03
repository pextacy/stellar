/**
 * x402 middleware hook for AgentMesh
 *
 * Plugs into the oh-my-codex hook system (PreToolUse / PostToolUse)
 * to intercept agent-to-agent calls and inject Stellar x402 payments.
 *
 * When an agent call is intercepted:
 * 1. Check Soroban spending policy (can_spend)
 * 2. If allowed, let the x402 client handle 402 → pay → retry
 * 3. Record spend in Soroban contract
 * 4. Fire reputation update
 */

import { StellarClient } from './client.js';
import { X402PaymentClient } from './x402.js';
import { SpendingPolicyClient } from './spending-policy.js';
import { ReputationRegistryClient } from './reputation.js';
import type { SpendingPolicyConfig } from './spending-policy.js';
import type { ReputationRegistryConfig } from './reputation.js';

export interface X402MiddlewareConfig {
  readonly coordinatorSecret: string;
  readonly spendingPolicyContractId: string;
  readonly reputationContractId: string;
  readonly horizonUrl?: string;
  readonly rpcUrl?: string;
}

export interface AgentCallContext {
  readonly agentEndpoint: string;
  readonly agentStellarAddress: string;
  readonly agentPriceUsdc: string;
  readonly sessionId: string;
  readonly task: string;
  readonly capability: string;
  readonly previousResult?: unknown;
}

export interface AgentCallResult {
  readonly success: boolean;
  readonly data: unknown;
  readonly txHash?: string;
  readonly latencyMs: number;
  readonly amountPaid?: string;
  readonly error?: string;
}

export class X402Middleware {
  private readonly stellarClient: StellarClient;
  private readonly x402Client: X402PaymentClient;
  private readonly spendingPolicy: SpendingPolicyClient;
  private readonly reputationRegistry: ReputationRegistryClient;

  constructor(config: X402MiddlewareConfig) {
    this.stellarClient = new StellarClient({
      secretKey: config.coordinatorSecret,
      horizonUrl: config.horizonUrl,
    });

    this.x402Client = new X402PaymentClient(this.stellarClient);

    this.spendingPolicy = new SpendingPolicyClient({
      contractId: config.spendingPolicyContractId,
      secretKey: config.coordinatorSecret,
      horizonUrl: config.horizonUrl,
      rpcUrl: config.rpcUrl,
    });

    this.reputationRegistry = new ReputationRegistryClient({
      contractId: config.reputationContractId,
      secretKey: config.coordinatorSecret,
      rpcUrl: config.rpcUrl,
    });
  }

  get coordinatorAddress(): string {
    return this.stellarClient.publicKey;
  }

  async callAgent(ctx: AgentCallContext): Promise<AgentCallResult> {
    const startTime = Date.now();

    // Check spending policy before paying
    const canSpend = await this.spendingPolicy.canSpend(
      ctx.sessionId,
      ctx.agentStellarAddress,
      ctx.agentPriceUsdc,
    );

    if (!canSpend) {
      return {
        success: false,
        data: null,
        latencyMs: Date.now() - startTime,
        error: `Spending policy rejected: cap exceeded for ${ctx.agentStellarAddress}`,
      };
    }

    // Call agent via x402
    try {
      const response = await this.x402Client.request({
        url: ctx.agentEndpoint,
        method: 'POST',
        body: {
          task: ctx.task,
          capability: ctx.capability,
          sessionId: ctx.sessionId,
          previousResult: ctx.previousResult,
        },
      });

      const latencyMs = Date.now() - startTime;

      // Record spend in Soroban
      if (response.txHash) {
        await this.spendingPolicy.recordSpend(
          ctx.sessionId,
          ctx.agentStellarAddress,
          ctx.agentPriceUsdc,
          response.txHash,
        );
      }

      // Fire-and-forget reputation update
      this.reputationRegistry
        .record(ctx.agentStellarAddress, latencyMs, response.status === 200)
        .catch(() => {});

      return {
        success: response.status === 200,
        data: response.data,
        txHash: response.txHash,
        latencyMs,
        amountPaid: response.paymentAmount,
      };
    } catch (err) {
      const latencyMs = Date.now() - startTime;

      // Fire-and-forget failed reputation update
      this.reputationRegistry
        .record(ctx.agentStellarAddress, latencyMs, false)
        .catch(() => {});

      return {
        success: false,
        data: null,
        latencyMs,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async lockBudget(amount: string, sessionId: string): Promise<string> {
    return this.spendingPolicy.lockBudget(amount, sessionId);
  }

  /**
   * Close a session and transfer the unspent USDC remainder back to the recipient.
   *
   * Steps:
   * 1. Read the session ledger to calculate remainder = budget - spent.
   * 2. Mark the session inactive on-chain via releaseRemainder (emits event).
   * 3. If remainder > 0, send an actual USDC payment to the recipient.
   *
   * Returns the tx hash of the USDC transfer, or undefined if remainder is zero.
   */
  async transferRemainder(sessionId: string, recipientAddress: string): Promise<string | undefined> {
    const session = await this.spendingPolicy.getSessionLedger(sessionId);

    const budgetRaw = BigInt(Math.round(parseFloat(String((session as unknown as { budget: bigint }).budget))));
    const spentRaw = BigInt(Math.round(parseFloat(String((session as unknown as { spent: bigint }).spent))));
    const remainderRaw = budgetRaw - spentRaw;

    // Mark session closed on-chain
    await this.spendingPolicy.releaseRemainder(sessionId, recipientAddress);

    if (remainderRaw <= 0n) {
      return undefined;
    }

    // Convert from stroops (7 decimal places) to USDC string
    const remainderUsdc = (Number(remainderRaw) / 10_000_000).toFixed(7);

    const result = await this.stellarClient.sendPayment({
      destination: recipientAddress,
      amount: remainderUsdc,
      memo: `remainder-${sessionId}`,
    });

    return result.txHash;
  }

  async getSessionLedger(sessionId: string) {
    return this.spendingPolicy.getSessionLedger(sessionId);
  }

  async getAgentScore(agentAddress: string): Promise<number> {
    return this.reputationRegistry.getScore(agentAddress);
  }
}
