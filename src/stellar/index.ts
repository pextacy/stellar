/**
 * Stellar integration layer for AgentMesh
 *
 * Provides: wallet client, x402 payment protocol, Soroban contract clients
 * for SpendingPolicy and ReputationRegistry, and MPP integration.
 */

export { StellarClient } from './client.js';
export type { StellarClientConfig, PaymentParams, PaymentResult } from './client.js';

export { X402PaymentClient } from './x402.js';
export type { X402PaymentInstructions, X402RequestOptions, X402Response } from './x402.js';

export { SpendingPolicyClient } from './spending-policy.js';
export type { SpendingPolicyConfig, SpendEntry, SessionLedger } from './spending-policy.js';

export { ReputationRegistryClient } from './reputation.js';
export type { ReputationRegistryConfig, ScoreEntry } from './reputation.js';

// MPP integration (@stellar/mpp)
export { MppChargeClient } from './mpp-client.js';
export type { MppClientConfig, MppProgressEvent, MppCallResult } from './mpp-client.js';

export { MppMiddleware } from './mpp-middleware.js';
export type { MppMiddlewareConfig, MppAgentCallContext, MppAgentCallResult } from './mpp-middleware.js';

export { createMppPaywall } from './mpp-server.js';
export type { MppPaywallConfig } from './mpp-server.js';
