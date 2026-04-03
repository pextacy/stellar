/**
 * Per-session spend breakdown by agent with tx hash links to testnet explorer.
 * No mock data — all data from Stellar Horizon.
 * No gradients — flat colors only.
 */

import type { PaymentOp } from '../hooks/useStellar';

const EXPLORER_URL = 'https://stellar.expert/explorer/testnet/tx';

interface SpendTableProps {
  payments: PaymentOp[];
  loading: boolean;
  error: string | null;
}

export function SpendTable({ payments, loading, error }: SpendTableProps) {
  if (error) {
    return (
      <div className="rounded-lg border border-red-800 bg-red-950 p-4 text-red-300">
        <p className="font-mono text-sm">Horizon error: {error}</p>
      </div>
    );
  }

  if (loading) {
    return <div className="text-zinc-500 py-4">Loading payments from Horizon...</div>;
  }

  if (payments.length === 0) {
    return <div className="text-zinc-500 py-4">No USDC payments found.</div>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-zinc-800 text-left text-zinc-400">
            <th className="pb-2 pr-4">Time</th>
            <th className="pb-2 pr-4">From</th>
            <th className="pb-2 pr-4">To</th>
            <th className="pb-2 pr-4 text-right">Amount</th>
            <th className="pb-2">Tx Hash</th>
          </tr>
        </thead>
        <tbody>
          {payments.map((p) => (
            <tr key={p.id} className="border-b border-zinc-900">
              <td className="py-2 pr-4 text-zinc-400 font-mono text-xs">
                {new Date(p.created_at).toLocaleTimeString()}
              </td>
              <td className="py-2 pr-4 font-mono text-xs">
                {p.from.slice(0, 8)}...{p.from.slice(-4)}
              </td>
              <td className="py-2 pr-4 font-mono text-xs">
                {p.to.slice(0, 8)}...{p.to.slice(-4)}
              </td>
              <td className="py-2 pr-4 text-right font-mono text-emerald-400">
                {p.amount} USDC
              </td>
              <td className="py-2">
                <a
                  href={`${EXPLORER_URL}/${p.transaction_hash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-xs text-blue-400 hover:text-blue-300 underline"
                >
                  {p.transaction_hash.slice(0, 12)}...
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
