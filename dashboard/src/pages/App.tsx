/**
 * AgentMesh Dashboard — real-time view of agent economy on Stellar testnet.
 *
 * Shows: spend table, reputation board, budget gauge.
 * All data from live Stellar testnet — no mock data, no gradients.
 */

import { useState } from 'react';
import { SpendTable } from '../components/SpendTable';
import { ReputationBoard } from '../components/ReputationBoard';
import { BudgetGauge } from '../components/BudgetGauge';
import { usePayments, useAgents } from '../hooks/useStellar';

export function App() {
  const [coordinatorAddress, setCoordinatorAddress] = useState('');
  const [inputValue, setInputValue] = useState('');

  const { payments, loading: paymentsLoading, error: paymentsError, refetch: refetchPayments } = usePayments(
    coordinatorAddress || undefined,
  );
  const { agents, loading: agentsLoading, error: agentsError } = useAgents();

  const totalSpent = payments.reduce((sum, p) => sum + parseFloat(p.amount), 0);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <header className="border-b border-zinc-800 px-6 py-4">
        <h1 className="text-xl font-bold">AgentMesh</h1>
        <p className="text-sm text-zinc-500">Agent-to-agent economy on Stellar testnet</p>
      </header>

      <main className="mx-auto max-w-5xl space-y-8 px-6 py-8">
        {/* Coordinator address input */}
        <div className="flex gap-3">
          <input
            type="text"
            placeholder="Enter coordinator Stellar address (G...)"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            className="flex-1 rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-2 font-mono text-sm text-zinc-100 placeholder-zinc-600 focus:border-blue-500 focus:outline-none"
          />
          <button
            onClick={() => { setCoordinatorAddress(inputValue); }}
            className="rounded-lg bg-blue-600 px-6 py-2 text-sm font-medium text-white hover:bg-blue-500"
          >
            Load
          </button>
          {coordinatorAddress && (
            <button
              onClick={refetchPayments}
              className="rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-400 hover:bg-zinc-800"
            >
              Refresh
            </button>
          )}
        </div>

        {/* Budget gauge */}
        {coordinatorAddress && (
          <section>
            <h2 className="mb-3 text-lg font-semibold text-zinc-300">Budget</h2>
            <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
              <BudgetGauge budget={1.0} spent={totalSpent} />
            </div>
          </section>
        )}

        {/* Spend table */}
        {coordinatorAddress && (
          <section>
            <h2 className="mb-3 text-lg font-semibold text-zinc-300">Payments</h2>
            <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
              <SpendTable payments={payments} loading={paymentsLoading} error={paymentsError} />
            </div>
          </section>
        )}

        {/* Reputation leaderboard */}
        <section>
          <h2 className="mb-3 text-lg font-semibold text-zinc-300">Registered Agents</h2>
          <ReputationBoard agents={agents} loading={agentsLoading} error={agentsError} />
        </section>
      </main>
    </div>
  );
}
