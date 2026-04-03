/**
 * SpendingPolicy Soroban contract client
 *
 * Wraps the Soroban SpendingPolicy contract that enforces per-agent
 * spending caps per session. Budget is locked in the contract and
 * released atomically on verified service delivery.
 */

import * as StellarSdk from '@stellar/stellar-sdk';

export interface SpendEntry {
  readonly agent: string;
  readonly amount: string;
  readonly txHash: string;
  readonly timestamp: number;
}

export interface SessionLedger {
  readonly sessionId: string;
  readonly totalBudget: string;
  readonly totalSpent: string;
  readonly entries: readonly SpendEntry[];
}

export interface SpendingPolicyConfig {
  readonly contractId: string;
  readonly secretKey: string;
  readonly horizonUrl?: string;
  readonly rpcUrl?: string;
}

const HORIZON_TESTNET = 'https://horizon-testnet.stellar.org';
const SOROBAN_RPC_TESTNET = 'https://soroban-testnet.stellar.org';

export class SpendingPolicyClient {
  private readonly contractId: string;
  private readonly keypair: StellarSdk.Keypair;
  private readonly horizonUrl: string;
  private readonly rpcUrl: string;

  constructor(config: SpendingPolicyConfig) {
    this.contractId = config.contractId;
    this.keypair = StellarSdk.Keypair.fromSecret(config.secretKey);
    this.horizonUrl = config.horizonUrl ?? HORIZON_TESTNET;
    this.rpcUrl = config.rpcUrl ?? SOROBAN_RPC_TESTNET;
  }

  get publicKey(): string {
    return this.keypair.publicKey();
  }

  async lockBudget(amount: string, sessionId: string): Promise<string> {
    return this.invokeContract('lock_budget', [
      StellarSdk.nativeToScVal(this.publicKey, { type: 'address' }),
      StellarSdk.nativeToScVal(BigInt(Math.round(parseFloat(amount) * 10_000_000)), { type: 'i128' }),
      StellarSdk.nativeToScVal(sessionId, { type: 'symbol' }),
    ]);
  }

  async canSpend(sessionId: string, agentAddress: string, amount: string): Promise<boolean> {
    const result = await this.queryContract('can_spend', [
      StellarSdk.nativeToScVal(sessionId, { type: 'symbol' }),
      StellarSdk.nativeToScVal(agentAddress, { type: 'address' }),
      StellarSdk.nativeToScVal(BigInt(Math.round(parseFloat(amount) * 10_000_000)), { type: 'i128' }),
    ]);
    return result === true;
  }

  async recordSpend(
    sessionId: string,
    agentAddress: string,
    amount: string,
    txHash: string,
  ): Promise<void> {
    await this.invokeContract('record_spend', [
      StellarSdk.nativeToScVal(sessionId, { type: 'symbol' }),
      StellarSdk.nativeToScVal(agentAddress, { type: 'address' }),
      StellarSdk.nativeToScVal(BigInt(Math.round(parseFloat(amount) * 10_000_000)), { type: 'i128' }),
      StellarSdk.nativeToScVal(Buffer.from(txHash, 'hex'), { type: 'bytes' }),
    ]);
  }

  async releaseRemainder(sessionId: string, recipient: string): Promise<void> {
    await this.invokeContract('release_remainder', [
      StellarSdk.nativeToScVal(sessionId, { type: 'symbol' }),
      StellarSdk.nativeToScVal(recipient, { type: 'address' }),
    ]);
  }

  async getSessionLedger(sessionId: string): Promise<SessionLedger> {
    const result = await this.queryContract('get_session_ledger', [
      StellarSdk.nativeToScVal(sessionId, { type: 'symbol' }),
    ]);
    return result as SessionLedger;
  }

  private async invokeContract(method: string, args: StellarSdk.xdr.ScVal[]): Promise<string> {
    const server = new StellarSdk.rpc.Server(this.rpcUrl);
    const account = await server.getAccount(this.publicKey);

    const contract = new StellarSdk.Contract(this.contractId);
    const tx = new StellarSdk.TransactionBuilder(account, {
      fee: StellarSdk.BASE_FEE,
      networkPassphrase: StellarSdk.Networks.TESTNET,
    })
      .addOperation(contract.call(method, ...args))
      .setTimeout(30)
      .build();

    const prepared = await server.prepareTransaction(tx);
    (prepared as StellarSdk.Transaction).sign(this.keypair);

    const response = await server.sendTransaction(prepared);
    if (response.status === 'ERROR') {
      throw new Error(`Contract call ${method} failed: ${JSON.stringify(response)}`);
    }

    // Poll for completion
    let getResponse = await server.getTransaction(response.hash);
    while (getResponse.status === 'NOT_FOUND') {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      getResponse = await server.getTransaction(response.hash);
    }

    if (getResponse.status === 'FAILED') {
      throw new Error(`Contract call ${method} failed on-chain`);
    }

    return response.hash;
  }

  private async queryContract(method: string, args: StellarSdk.xdr.ScVal[]): Promise<unknown> {
    const server = new StellarSdk.rpc.Server(this.rpcUrl);
    const account = await server.getAccount(this.publicKey);

    const contract = new StellarSdk.Contract(this.contractId);
    const tx = new StellarSdk.TransactionBuilder(account, {
      fee: StellarSdk.BASE_FEE,
      networkPassphrase: StellarSdk.Networks.TESTNET,
    })
      .addOperation(contract.call(method, ...args))
      .setTimeout(30)
      .build();

    const result = await server.simulateTransaction(tx);
    if ('error' in result) {
      throw new Error(`Contract query ${method} failed: ${result.error}`);
    }
    if (!('result' in result) || !result.result) {
      return undefined;
    }
    return StellarSdk.scValToNative(result.result.retval);
  }
}
