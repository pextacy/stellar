/**
 * x402 Payment Protocol client for AgentMesh
 *
 * Implements the x402 payment flow:
 * 1. Client sends request to agent
 * 2. Agent returns 402 with payment instructions
 * 3. Client signs Stellar payment, sends X-Payment header
 * 4. Agent verifies payment on-chain, returns result
 */

import { StellarClient } from './client.js';

export interface X402PaymentInstructions {
  readonly amount: string;
  readonly currency: 'USDC';
  readonly network: 'stellar:testnet';
  readonly payTo: string;
  readonly memo: string;
}

export interface X402RequestOptions {
  readonly url: string;
  readonly method?: string;
  readonly body?: unknown;
  readonly headers?: Record<string, string>;
}

export interface X402Response<T = unknown> {
  readonly status: number;
  readonly data: T;
  readonly txHash?: string;
  readonly paymentAmount?: string;
}

export class X402PaymentClient {
  constructor(private readonly stellarClient: StellarClient) {}

  async request<T = unknown>(options: X402RequestOptions): Promise<X402Response<T>> {
    // Step 1: Send initial request
    const initialResponse = await fetch(options.url, {
      method: options.method ?? 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });

    // If not 402, return directly
    if (initialResponse.status !== 402) {
      const data = await initialResponse.json() as T;
      return { status: initialResponse.status, data };
    }

    // Step 2: Parse 402 payment instructions
    const instructions = await initialResponse.json() as X402PaymentInstructions;

    if (instructions.network !== 'stellar:testnet') {
      throw new Error(`Unsupported network: ${instructions.network}`);
    }
    if (instructions.currency !== 'USDC') {
      throw new Error(`Unsupported currency: ${instructions.currency}`);
    }

    // Step 3: Sign and send payment
    const paymentResult = await this.stellarClient.sendPayment({
      destination: instructions.payTo,
      amount: instructions.amount,
      memo: instructions.memo,
    });

    // Step 4: Retry request with payment proof
    const paidResponse = await fetch(options.url, {
      method: options.method ?? 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-Payment': paymentResult.txHash,
        'X-Payment-Network': 'stellar:testnet',
        ...options.headers,
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });

    const data = await paidResponse.json() as T;
    return {
      status: paidResponse.status,
      data,
      txHash: paymentResult.txHash,
      paymentAmount: instructions.amount,
    };
  }
}
