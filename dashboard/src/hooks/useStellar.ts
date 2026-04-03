/**
 * Hooks for fetching live data from Stellar Horizon + Soroban contracts.
 * No mock data — all reads hit real Stellar testnet.
 */

import { useState, useEffect, useCallback } from 'react';

const HORIZON_URL = import.meta.env.VITE_HORIZON_URL || 'https://horizon-testnet.stellar.org';
const REGISTRY_URL = import.meta.env.VITE_REGISTRY_URL || 'http://localhost:3001';

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
