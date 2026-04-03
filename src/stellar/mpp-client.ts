/**
 * MPP-style x402 payment client for AgentMesh
 *
 * Wraps X402PaymentClient with automatic 402-handling semantics.
 * The fetch polyfill pattern intercepts 402 responses, signs a Stellar USDC
 * payment, and retries — all transparently.
 */

import { Keypair } from '@stellar/stellar-sdk';
import { StellarClient } from './client.js';
import { X402PaymentClient } from './x402.js';

export interface MppClientConfig {
  readonly secretKey: string;
  readonly mode?: 'pull' | 'push';
  readonly onProgress?: (event: MppProgressEvent) => void;
}

export interface MppProgressEvent {
  readonly type: 'challenge' | 'signing' | 'signed' | 'paying' | 'confirming' | 'paid';
  readonly [key: string]: unknown;
}

export interface MppCallResult<T = unknown> {
  readonly status: number;
  readonly data: T;
  readonly latencyMs: number;
  readonly txHash?: string;
}

export class MppChargeClient {
  private readonly keypair: Keypair;
  private readonly x402Client: X402PaymentClient;
  private readonly onProgress?: (event: MppProgressEvent) => void;

  constructor(config: MppClientConfig) {
    this.keypair = Keypair.fromSecret(config.secretKey);
    this.onProgress = config.onProgress;

    const stellarClient = new StellarClient({ secretKey: config.secretKey });
    this.x402Client = new X402PaymentClient(stellarClient);
  }

  get publicKey(): string {
    return this.keypair.publicKey();
  }

  /**
   * Call an agent endpoint. If the agent returns 402, automatically
   * signs a Stellar USDC payment, sends it, and retries.
   */
  async callAgent<T = unknown>(
    url: string,
    body: Record<string, unknown>,
  ): Promise<MppCallResult<T>> {
    const startTime = Date.now();

    this.onProgress?.({ type: 'challenge' });

    const response = await this.x402Client.request<T>({
      url,
      method: 'POST',
      body,
    });

    const latencyMs = Date.now() - startTime;

    if (response.txHash) {
      this.onProgress?.({ type: 'paid', txHash: response.txHash, amount: response.paymentAmount });
    }

    return {
      status: response.status,
      data: response.data,
      latencyMs,
      txHash: response.txHash,
    };
  }
}
