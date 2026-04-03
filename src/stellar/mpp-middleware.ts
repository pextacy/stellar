/**
 * MPP-powered x402 middleware for AgentMesh
 *
 * Uses @stellar/mpp charge client for outbound agent calls.
 * Integrates Soroban spending policy + reputation on top of MPP.
 */

import { Keypair } from '@stellar/stellar-sdk';
import { MppChargeClient } from './mpp-client.js';
import { SpendingPolicyClient } from './spending-policy.js';
import { ReputationRegistryClient } from './reputation.js';
import type { MppProgressEvent } from './mpp-client.js';

export interface MppMiddlewareConfig {
  readonly coordinatorSecret: string;
  readonly spendingPolicyContractId: string;
  readonly reputationContractId: string;
  readonly rpcUrl?: string;
  readonly onProgress?: (event: MppProgressEvent) => void;
}

export interface MppAgentCallContext {
  readonly agentEndpoint: string;
  readonly agentStellarAddress: string;
  readonly agentPriceUsdc: string;
  readonly sessionId: string;
  readonly task: string;
  readonly capability: string;
  readonly previousResult?: unknown;
}

export interface MppAgentCallResult {
  readonly success: boolean;
  readonly data: unknown;
  readonly latencyMs: number;
  readonly amountPaid?: string;
  readonly error?: string;
}

export class MppMiddleware {
  private readonly mppClient: MppChargeClient;
  private readonly spendingPolicy: SpendingPolicyClient;
  private readonly reputationRegistry: ReputationRegistryClient;
  private readonly keypair: Keypair;

  constructor(config: MppMiddlewareConfig) {
    this.keypair = Keypair.fromSecret(config.coordinatorSecret);

    this.mppClient = new MppChargeClient({
      secretKey: config.coordinatorSecret,
      mode: 'pull',
      onProgress: config.onProgress,
    });

    this.spendingPolicy = new SpendingPolicyClient({
      contractId: config.spendingPolicyContractId,
      secretKey: config.coordinatorSecret,
      rpcUrl: config.rpcUrl,
    });

    this.reputationRegistry = new ReputationRegistryClient({
      contractId: config.reputationContractId,
      secretKey: config.coordinatorSecret,
      rpcUrl: config.rpcUrl,
    });
  }

  get coordinatorAddress(): string {
    return this.keypair.publicKey();
  }

  async callAgent(ctx: MppAgentCallContext): Promise<MppAgentCallResult> {
    // 1. Check spending policy
    const canSpend = await this.spendingPolicy.canSpend(
      ctx.sessionId,
      ctx.agentStellarAddress,
      ctx.agentPriceUsdc,
    );

    if (!canSpend) {
      return {
        success: false,
        data: null,
        latencyMs: 0,
        error: `Spending policy rejected: cap exceeded for ${ctx.agentStellarAddress}`,
      };
    }

    // 2. Call agent via MPP (402 → pay → retry happens automatically)
    try {
      const result = await this.mppClient.callAgent(ctx.agentEndpoint, {
        task: ctx.task,
        capability: ctx.capability,
        sessionId: ctx.sessionId,
        previousResult: ctx.previousResult,
      });

      // 3. Fire-and-forget reputation update
      this.reputationRegistry
        .record(ctx.agentStellarAddress, result.latencyMs, result.status === 200)
        .catch(() => {});

      return {
        success: result.status === 200,
        data: result.data,
        latencyMs: result.latencyMs,
        amountPaid: ctx.agentPriceUsdc,
      };
    } catch (err) {
      this.reputationRegistry
        .record(ctx.agentStellarAddress, 0, false)
        .catch(() => {});

      return {
        success: false,
        data: null,
        latencyMs: 0,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async lockBudget(amount: string, sessionId: string): Promise<string> {
    return this.spendingPolicy.lockBudget(amount, sessionId);
  }

  async releaseRemainder(sessionId: string, recipient: string): Promise<void> {
    return this.spendingPolicy.releaseRemainder(sessionId, recipient);
  }

  async getSessionLedger(sessionId: string) {
    return this.spendingPolicy.getSessionLedger(sessionId);
  }

  async getAgentScore(agentAddress: string): Promise<number> {
    return this.reputationRegistry.getScore(agentAddress);
  }
}
