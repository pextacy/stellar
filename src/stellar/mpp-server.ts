/**
 * x402 paywall middleware for AgentMesh specialist agents (Express)
 *
 * Gates all routes behind Stellar USDC payment verification.
 * On unauthenticated request: returns 402 with Stellar payment instructions.
 * On request with X-Payment header: verifies payment on Stellar Horizon,
 * then forwards to the route handler.
 *
 * Usage:
 *   import { createMppPaywall } from './mpp-server.js';
 *   app.use(createMppPaywall({ recipient: 'G...', priceUsdc: '0.001', secretKey: 'S...' }));
 */

import { StellarClient } from './client.js';
import type { Request, Response, NextFunction } from 'express';

export interface MppPaywallConfig {
  readonly recipient: string;
  readonly priceUsdc: string;
  readonly secretKey: string;
  readonly network?: 'stellar:testnet' | 'stellar:pubnet';
}

export function createMppPaywall(config: MppPaywallConfig) {
  const stellarClient = new StellarClient({ secretKey: config.secretKey });
  const network = config.network ?? 'stellar:testnet';

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    // Health check bypasses payment
    if (req.path === '/health') {
      next();
      return;
    }

    const paymentTxHash = req.headers['x-payment'] as string | undefined;
    const paymentNetwork = req.headers['x-payment-network'] as string | undefined;

    if (!paymentTxHash) {
      res.status(402).json({
        amount: config.priceUsdc,
        currency: 'USDC',
        network,
        payTo: config.recipient,
        memo: `agent-${req.path}-${Date.now()}`,
      });
      return;
    }

    if (paymentNetwork && paymentNetwork !== network) {
      res.status(400).json({ error: `Unsupported network: ${paymentNetwork}` });
      return;
    }

    const verified = await stellarClient
      .verifyPayment(paymentTxHash, config.priceUsdc, config.recipient)
      .catch(() => false);

    if (!verified) {
      res.status(402).json({
        error: 'Payment verification failed',
        amount: config.priceUsdc,
        currency: 'USDC',
        network,
        payTo: config.recipient,
        memo: `retry-${Date.now()}`,
      });
      return;
    }

    next();
  };
}
