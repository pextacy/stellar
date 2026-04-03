/**
 * MPP-based x402 payment client for AgentMesh
 *
 * Uses @stellar/mpp (Machine Payments Protocol) for production-grade
 * x402 payment handling on Stellar. Replaces the hand-rolled x402.ts
 * with the official Stellar MPP SDK.
 *
 * The Mppx.create() polyfills global fetch so every fetch() call
 * automatically handles 402 → sign → pay → retry.
 */

import { Keypair } from '@stellar/stellar-sdk';
import { Mppx } from 'mppx/client';
import { stellar } from '@stellar/mpp/charge/client';

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
}

export class MppChargeClient {
  private readonly keypair: Keypair;

  constructor(config: MppClientConfig) {
    this.keypair = Keypair.fromSecret(config.secretKey);

    // Polyfill global fetch with automatic 402 handling
    Mppx.create({
      methods: [
        stellar.charge({
          keypair: this.keypair,
          mode: config.mode ?? 'pull',
          onProgress: config.onProgress,
        }),
      ],
    });
  }

  get publicKey(): string {
    return this.keypair.publicKey();
  }

  /**
   * Call an agent endpoint. If the agent returns 402, Mppx automatically
   * signs a Stellar payment, sends it, and retries — all transparently.
   */
  async callAgent<T = unknown>(
    url: string,
    body: Record<string, unknown>,
  ): Promise<MppCallResult<T>> {
    const startTime = Date.now();

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const data = await response.json() as T;
    const latencyMs = Date.now() - startTime;

    return { status: response.status, data, latencyMs };
  }
}
