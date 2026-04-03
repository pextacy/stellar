/**
 * MPP server middleware for AgentMesh specialist agents
 *
 * Express middleware that uses @stellar/mpp charge server
 * to gate endpoints behind Stellar USDC payments.
 *
 * Usage:
 *   import { createMppPaywall } from './mpp-server.js';
 *   app.use(createMppPaywall({ recipient: 'G...', priceUsdc: '0.001' }));
 */

import { Mppx, Store } from 'mppx/server';
import { stellar } from '@stellar/mpp/charge/server';
import { USDC_SAC_TESTNET } from '@stellar/mpp';
import type { Request, Response, NextFunction } from 'express';

export interface MppPaywallConfig {
  readonly recipient: string;
  readonly priceUsdc: string;
  readonly secretKey?: string;
  readonly network?: 'stellar:testnet' | 'stellar:pubnet';
}

export function createMppPaywall(config: MppPaywallConfig) {
  const mppx = Mppx.create({
    secretKey: config.secretKey,
    methods: [
      stellar.charge({
        recipient: config.recipient,
        currency: USDC_SAC_TESTNET,
        network: config.network ?? 'stellar:testnet',
        store: Store.memory(),
      }),
    ],
  });

  return async (req: Request, res: Response, next: NextFunction) => {
    // Skip health check
    if (req.path === '/health') {
      next();
      return;
    }

    const webReq = new globalThis.Request(`http://${req.headers.host}${req.url}`, {
      method: req.method,
      headers: new globalThis.Headers(req.headers as Record<string, string>),
    });

    const result = await mppx.charge({
      amount: config.priceUsdc,
      description: `AgentMesh agent call: ${req.path}`,
    })(webReq);

    if (result.status === 402) {
      const challenge = result.challenge;
      res.status(challenge.status);
      challenge.headers.forEach((v: string, k: string) => res.setHeader(k, v));
      res.send(await challenge.text());
      return;
    }

    // Payment verified — let the route handler respond
    next();
  };
}
