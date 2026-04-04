/**
 * Stellar SDK client wrapper for AgentMesh
 *
 * Handles wallet operations, transaction building, and Horizon API queries.
 * All operations target Stellar testnet — never mainnet.
 */

import * as StellarSdk from '@stellar/stellar-sdk';

const HORIZON_TESTNET = 'https://horizon-testnet.stellar.org';
const NETWORK_PASSPHRASE = StellarSdk.Networks.TESTNET;
const USDC_ISSUER = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';

export interface StellarClientConfig {
  readonly secretKey: string;
  readonly horizonUrl?: string;
}

export interface PaymentParams {
  readonly destination: string;
  readonly amount: string;
  readonly memo?: string;
}

export interface PaymentResult {
  readonly txHash: string;
  readonly ledger: number;
  readonly fee: string;
}

export class StellarClient {
  private readonly keypair: StellarSdk.Keypair;
  private readonly server: StellarSdk.Horizon.Server;
  private readonly usdcAsset: StellarSdk.Asset;

  constructor(config: StellarClientConfig) {
    this.keypair = StellarSdk.Keypair.fromSecret(config.secretKey);
    this.server = new StellarSdk.Horizon.Server(
      config.horizonUrl ?? HORIZON_TESTNET,
    );
    this.usdcAsset = new StellarSdk.Asset('USDC', USDC_ISSUER);
  }

  get publicKey(): string {
    return this.keypair.publicKey();
  }

  async getBalance(): Promise<string> {
    const account = await this.server.loadAccount(this.publicKey);
    const usdcBalance = account.balances.find(
      (b) =>
        'asset_code' in b &&
        b.asset_code === 'USDC' &&
        b.asset_issuer === USDC_ISSUER,
    );
    return usdcBalance ? usdcBalance.balance : '0';
  }

  private async retryOnTransient<T>(label: string, fn: () => Promise<T>): Promise<T> {
    const transientStatuses = new Set([429, 502, 503, 504]);
    let lastErr: unknown;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        return await fn();
      } catch (err) {
        lastErr = err;
        const status = (err as { response?: { status?: number } })?.response?.status;
        if (!status || !transientStatuses.has(status)) {
          throw err;
        }
        const backoffMs = 1500 * 2 ** attempt;
        console.error(`[stellar] ${label} transient ${status}, retry in ${backoffMs}ms`);
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
      }
    }
    throw lastErr;
  }

  async sendPayment(params: PaymentParams): Promise<PaymentResult> {
    const account = await this.retryOnTransient('loadAccount', () =>
      this.server.loadAccount(this.publicKey),
    );

    const builder = new StellarSdk.TransactionBuilder(account, {
      fee: StellarSdk.BASE_FEE,
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(
        StellarSdk.Operation.payment({
          destination: params.destination,
          asset: this.usdcAsset,
          amount: params.amount,
        }),
      )
      .setTimeout(180);

    if (params.memo) {
      builder.addMemo(StellarSdk.Memo.text(params.memo));
    }

    const tx = builder.build();
    tx.sign(this.keypair);

    // Submit async — returns immediately with the hash and status, avoiding
    // Horizon's synchronous submission timeout (the 504 path).
    const submitResponse = await this.retryOnTransient('submit_async', () =>
      this.server.submitAsyncTransaction(tx),
    );

    if (submitResponse.tx_status === 'ERROR') {
      throw new Error(
        `Payment to ${params.destination} rejected by core: ${submitResponse.error_result_xdr ?? 'unknown'}`,
      );
    }

    // Poll Horizon until the tx is indexed (max 120s).
    const hash = submitResponse.hash;
    for (let attempt = 0; attempt < 60; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      try {
        const record = await this.server.transactions().transaction(hash).call();
        if (record.successful) {
          return {
            txHash: record.hash,
            ledger: record.ledger_attr,
            fee: String(record.fee_charged),
          };
        }
        throw new Error(`Payment ${hash} applied but not successful`);
      } catch (err) {
        // Treat 404 / NotFound as "still indexing" — keep polling.
        const maybe = err as { name?: string; response?: { status?: number }; message?: string };
        const isNotFound =
          maybe.name === 'NotFoundError' ||
          maybe.response?.status === 404 ||
          (typeof maybe.message === 'string' && maybe.message.toLowerCase().includes('not found'));
        if (!isNotFound) {
          throw err;
        }
      }
    }

    throw new Error(`Payment ${hash} to ${params.destination} not indexed after 120s`);
  }

  async verifyPayment(
    txHash: string,
    expectedAmount: string,
    expectedDestination: string,
  ): Promise<boolean> {
    const operations = await this.server
      .operations()
      .forTransaction(txHash)
      .call();

    const paymentOp = operations.records.find(
      (op) =>
        op.type === 'payment' &&
        'asset_code' in op &&
        op.asset_code === 'USDC' &&
        'to' in op &&
        op.to === expectedDestination &&
        'amount' in op &&
        Math.abs(parseFloat(op.amount as string) - parseFloat(expectedAmount)) < 1e-7,
    );

    return paymentOp !== undefined;
  }

  async fundTestnet(): Promise<void> {
    const response = await fetch(
      `https://friendbot.stellar.org?addr=${encodeURIComponent(this.publicKey)}`,
    );
    if (!response.ok) {
      throw new Error(`Friendbot funding failed: ${response.statusText}`);
    }
  }
}
