/**
 * ReputationRegistry Soroban contract client
 *
 * Records accuracy and latency scores per agent address after each
 * settled call. Score is a weighted rolling average readable by anyone.
 */

import * as StellarSdk from '@stellar/stellar-sdk';

export interface ScoreEntry {
  readonly agent: string;
  readonly latencyMs: number;
  readonly success: boolean;
  readonly timestamp: number;
}

export interface ReputationRegistryConfig {
  readonly contractId: string;
  readonly secretKey: string;
  readonly rpcUrl?: string;
}

const SOROBAN_RPC_TESTNET = 'https://soroban-testnet.stellar.org';

export class ReputationRegistryClient {
  private readonly contractId: string;
  private readonly keypair: StellarSdk.Keypair;
  private readonly rpcUrl: string;

  constructor(config: ReputationRegistryConfig) {
    this.contractId = config.contractId;
    this.keypair = StellarSdk.Keypair.fromSecret(config.secretKey);
    this.rpcUrl = config.rpcUrl ?? SOROBAN_RPC_TESTNET;
  }

  get publicKey(): string {
    return this.keypair.publicKey();
  }

  async record(
    agentAddress: string,
    latencyMs: number,
    success: boolean,
  ): Promise<void> {
    await this.invokeContract('record', [
      StellarSdk.nativeToScVal(agentAddress, { type: 'address' }),
      StellarSdk.nativeToScVal(this.publicKey, { type: 'address' }),
      StellarSdk.nativeToScVal(BigInt(latencyMs), { type: 'u64' }),
      StellarSdk.nativeToScVal(success, { type: 'bool' }),
    ]);
  }

  async getScore(agentAddress: string): Promise<number> {
    const result = await this.queryContract('get_score', [
      StellarSdk.nativeToScVal(agentAddress, { type: 'address' }),
    ]);
    return Number(result) / 100; // scaled 0–10000 → 0–100
  }

  async getHistory(agentAddress: string, limit = 10): Promise<ScoreEntry[]> {
    const result = await this.queryContract('get_history', [
      StellarSdk.nativeToScVal(agentAddress, { type: 'address' }),
      StellarSdk.nativeToScVal(limit, { type: 'u32' }),
    ]);
    return (result as ScoreEntry[]) ?? [];
  }

  private async invokeContract(method: string, args: StellarSdk.xdr.ScVal[]): Promise<void> {
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

    let getResponse = await server.getTransaction(response.hash);
    let attempts = 0;
    while (getResponse.status === 'NOT_FOUND' && attempts < 30) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      getResponse = await server.getTransaction(response.hash);
      attempts++;
    }

    if (getResponse.status === 'NOT_FOUND') {
      throw new Error(`Contract call ${method} timed out after 30s`);
    }
    if (getResponse.status === 'FAILED') {
      throw new Error(`Contract call ${method} failed on-chain`);
    }
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
