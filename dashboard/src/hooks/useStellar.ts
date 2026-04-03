/**
 * Hooks for fetching live data from Stellar Horizon + Soroban contracts.
 * No mock data — all reads hit real Stellar testnet.
 */

import { useState, useEffect, useCallback } from 'react';
import * as StellarSdk from '@stellar/stellar-sdk';

const HORIZON_URL = import.meta.env.VITE_HORIZON_URL || 'https://horizon-testnet.stellar.org';
const REGISTRY_URL = import.meta.env.VITE_REGISTRY_URL || 'http://localhost:3001';
const SOROBAN_RPC_URL = import.meta.env.VITE_SOROBAN_RPC_URL || 'https://soroban-testnet.stellar.org';

export interface Transaction {
  id: string;
  hash: string;
  created_at: string;
  source_account: string;
  fee_charged: string;
  memo?: string;
  operation_count: number;
}

export interface Agent {
  id: string;
  endpointUrl: string;
  capabilities: string[];
  priceUsdc: string;
  stellarAddress: string;
  registeredAt: string;
  reputationScore?: number;
}

export interface PaymentOp {
  id: string;
  type: string;
  from: string;
  to: string;
  amount: string;
  asset_code?: string;
  asset_issuer?: string;
  transaction_hash: string;
  created_at: string;
}

export function useTransactions(accountId: string | undefined) {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetch_ = useCallback(async () => {
    if (!accountId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `${HORIZON_URL}/accounts/${accountId}/transactions?order=desc&limit=20`,
      );
      if (!res.ok) throw new Error(`Horizon error: ${res.status}`);
      const data = await res.json();
      setTransactions(data._embedded?.records ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [accountId]);

  useEffect(() => { fetch_(); }, [fetch_]);

  return { transactions, loading, error, refetch: fetch_ };
}

export function usePayments(accountId: string | undefined) {
  const [payments, setPayments] = useState<PaymentOp[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetch_ = useCallback(async () => {
    if (!accountId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `${HORIZON_URL}/accounts/${accountId}/payments?order=desc&limit=50`,
      );
      if (!res.ok) throw new Error(`Horizon error: ${res.status}`);
      const data = await res.json();
      const ops = (data._embedded?.records ?? []).filter(
        (op: PaymentOp) => op.type === 'payment' && op.asset_code === 'USDC',
      );
      setPayments(ops);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [accountId]);

  useEffect(() => { fetch_(); }, [fetch_]);

  return { payments, loading, error, refetch: fetch_ };
}

export function useAgents() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetch_ = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${REGISTRY_URL}/agents`);
      if (!res.ok) throw new Error(`Registry error: ${res.status}`);
      const data = await res.json();
      setAgents(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetch_(); }, [fetch_]);

  return { agents, loading, error, refetch: fetch_ };
}

// ---------------------------------------------------------------------------
// Soroban contract reads
// ---------------------------------------------------------------------------

export interface SessionLedger {
  sessionId: string;
  budget: number;
  spent: number;
  active: boolean;
  entries: Array<{
    agent: string;
    amount: number;
    txHash: string;
    timestamp: number;
  }>;
}

async function simulateContractCall(
  contractId: string,
  coordinatorAddress: string,
  method: string,
  args: StellarSdk.xdr.ScVal[],
): Promise<unknown> {
  const server = new StellarSdk.rpc.Server(SOROBAN_RPC_URL);
  const account = await server.getAccount(coordinatorAddress);
  const contract = new StellarSdk.Contract(contractId);
  const tx = new StellarSdk.TransactionBuilder(account, {
    fee: StellarSdk.BASE_FEE,
    networkPassphrase: StellarSdk.Networks.TESTNET,
  })
    .addOperation(contract.call(method, ...args))
    .setTimeout(30)
    .build();

  const result = await server.simulateTransaction(tx);
  if ('error' in result) throw new Error(`Contract error: ${result.error}`);
  if (!('result' in result) || !result.result) return undefined;
  return StellarSdk.scValToNative(result.result.retval);
}

export function useSessionLedger(
  sessionId: string | undefined,
  coordinatorAddress: string | undefined,
) {
  const contractId = import.meta.env.VITE_SPENDING_POLICY_CONTRACT_ID as string | undefined;
  const [ledger, setLedger] = useState<SessionLedger | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetch_ = useCallback(async () => {
    if (!sessionId || !contractId || !coordinatorAddress) return;
    setLoading(true);
    setError(null);
    try {
      const raw = await simulateContractCall(
        contractId,
        coordinatorAddress,
        'get_session_ledger',
        [StellarSdk.nativeToScVal(sessionId, { type: 'symbol' })],
      ) as {
        budget: bigint;
        spent: bigint;
        active: boolean;
        entries: Array<{ agent: string; amount: bigint; tx_hash: Uint8Array; timestamp: bigint }>;
      };

      setLedger({
        sessionId,
        budget: Number(raw.budget) / 10_000_000,
        spent: Number(raw.spent) / 10_000_000,
        active: raw.active,
        entries: (raw.entries ?? []).map((e) => ({
          agent: e.agent,
          amount: Number(e.amount) / 10_000_000,
          txHash: Buffer.from(e.tx_hash).toString('hex'),
          timestamp: Number(e.timestamp),
        })),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [sessionId, contractId, coordinatorAddress]);

  useEffect(() => { fetch_(); }, [fetch_]);

  return { ledger, loading, error, refetch: fetch_ };
}

export function useAgentScores(
  agentAddresses: string[],
  coordinatorAddress: string | undefined,
): Record<string, number> {
  const contractId = import.meta.env.VITE_REPUTATION_CONTRACT_ID as string | undefined;
  const [scores, setScores] = useState<Record<string, number>>({});

  useEffect(() => {
    if (!contractId || !coordinatorAddress || agentAddresses.length === 0) return;
    let cancelled = false;

    Promise.allSettled(
      agentAddresses.map(async (addr) => {
        const raw = await simulateContractCall(
          contractId,
          coordinatorAddress,
          'get_score',
          [StellarSdk.nativeToScVal(addr, { type: 'address' })],
        ) as bigint;
        return { addr, score: Number(raw) / 100 };
      }),
    ).then((results) => {
      if (cancelled) return;
      const map: Record<string, number> = {};
      for (const r of results) {
        if (r.status === 'fulfilled') {
          map[r.value.addr] = r.value.score;
        }
      }
      setScores(map);
    });

    return () => { cancelled = true; };
  }, [agentAddresses.join(','), contractId, coordinatorAddress]);

  return scores;
}
