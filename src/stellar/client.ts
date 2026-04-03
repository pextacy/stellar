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

  async sendPayment(params: PaymentParams): Promise<PaymentResult> {
    const account = await this.server.loadAccount(this.publicKey);

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
      .setTimeout(30);

    if (params.memo) {
      builder.addMemo(StellarSdk.Memo.text(params.memo));
    }

    const tx = builder.build();
    tx.sign(this.keypair);

    const response = await this.server.submitTransaction(tx);
    return {
      txHash: response.hash,
      ledger: response.ledger,
      fee: 'fee_charged' in response ? String(response.fee_charged) : StellarSdk.BASE_FEE,
    };
  }

  async verifyPayment(
    txHash: string,
    expectedAmount: string,
    expectedDestination: string,
  ): Promise<boolean> {
    const tx = await this.server
      .transactions()
      .transaction(txHash)
      .call();

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
        op.amount === expectedAmount,
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
