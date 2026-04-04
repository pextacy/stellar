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
import { usePayments, useAgents, useSessionLedger, useAgentScores } from '../hooks/useStellar';

export function App() {
  const [coordinatorAddress, setCoordinatorAddress] = useState('');
  const [sessionId, setSessionId] = useState('');
  const [addrInput, setAddrInput] = useState('');
  const [sessionInput, setSessionInput] = useState('');

  const { payments, loading: paymentsLoading, error: paymentsError, refetch: refetchPayments } =
    usePayments(coordinatorAddress || undefined);
  const { agents, loading: agentsLoading, error: agentsError } = useAgents();
  const { ledger, loading: ledgerLoading, error: ledgerError } = useSessionLedger(
    sessionId || undefined,
    coordinatorAddress || undefined,
  );
  const agentAddresses = agents.map((a) => a.stellarAddress);
  const scores = useAgentScores(agentAddresses, coordinatorAddress || undefined);

  const budgetValue = ledger ? ledger.budget : 0;
  const spentValue = ledger
    ? ledger.spent
    : payments.reduce((sum, p) => sum + parseFloat(p.amount), 0);

  const [addrError, setAddrError] = useState('');

  function handleLoad() {
    const addr = addrInput.trim();
    if (addr && (addr.length !== 56 || !addr.startsWith('G'))) {
      setAddrError('Invalid Stellar address — must start with G and be 56 characters');
      return;
    }
    setAddrError('');
    setCoordinatorAddress(addr);
    if (sessionInput.trim()) setSessionId(sessionInput.trim());
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <header className="border-b border-zinc-800 px-6 py-4">
        <h1 className="text-xl font-bold">AgentMesh</h1>
        <p className="text-sm text-zinc-500">Agent-to-agent economy on Stellar testnet</p>
      </header>

      <main className="mx-auto max-w-5xl space-y-8 px-6 py-8">
        {/* Inputs */}
        <div className="space-y-3">
          <div className="flex gap-3">
            <input
              type="text"
              placeholder="Coordinator Stellar address (G...)"
              value={addrInput}
              onChange={(e) => setAddrInput(e.target.value)}
              className="flex-1 rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-2 font-mono text-sm text-zinc-100 placeholder-zinc-600 focus:border-blue-500 focus:outline-none"
            />
            <input
              type="text"
              placeholder="Session ID (mesh-...)"
              value={sessionInput}
              onChange={(e) => setSessionInput(e.target.value)}
              className="w-64 rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-2 font-mono text-sm text-zinc-100 placeholder-zinc-600 focus:border-blue-500 focus:outline-none"
            />
            <button
              onClick={handleLoad}
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

          {addrError && (
            <div className="rounded-lg border border-red-800 bg-red-950 px-4 py-2 text-red-300 text-sm font-mono">
              {addrError}
            </div>
          )}
          {!import.meta.env.VITE_SPENDING_POLICY_CONTRACT_ID && (
            <div className="rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-2 text-zinc-500 text-xs font-mono">
              VITE_SPENDING_POLICY_CONTRACT_ID not set — session ledger unavailable
            </div>
          )}
          {ledgerError && (
            <div className="rounded-lg border border-amber-800 bg-amber-950 px-4 py-2 text-amber-300 text-sm font-mono">
              Soroban: {ledgerError}
            </div>
          )}
        </div>

        {/* Budget gauge — from Soroban session ledger when available */}
        {coordinatorAddress && (
          <section>
            <h2 className="mb-3 text-lg font-semibold text-zinc-300">
              Budget
              {ledger && (
                <span className="ml-2 text-xs font-normal text-zinc-500">
                  session {sessionId} · {ledger.active ? 'active' : 'closed'}
                </span>
              )}
              {ledgerLoading && (
                <span className="ml-2 text-xs font-normal text-zinc-500">loading from contract...</span>
              )}
            </h2>
            <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
              <BudgetGauge budget={budgetValue} spent={spentValue} />
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
          <ReputationBoard
            agents={agents}
            scores={scores}
            loading={agentsLoading}
            error={agentsError}
          />
        </section>
      </main>
    </div>
  );
}
