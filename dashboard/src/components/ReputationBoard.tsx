/**
 * Reputation leaderboard — shows agent scores from the registry.
 * No mock data. No gradients.
 */

import type { Agent } from '../hooks/useStellar';

interface ReputationBoardProps {
  agents: Agent[];
  loading: boolean;
  error: string | null;
}

export function ReputationBoard({ agents, loading, error }: ReputationBoardProps) {
  if (error) {
    return (
      <div className="rounded-lg border border-red-800 bg-red-950 p-4 text-red-300">
        <p className="font-mono text-sm">Registry error: {error}</p>
      </div>
    );
  }

  if (loading) {
    return <div className="text-zinc-500 py-4">Loading agents from registry...</div>;
  }

  if (agents.length === 0) {
    return <div className="text-zinc-500 py-4">No agents registered.</div>;
  }

  return (
    <div className="space-y-2">
      {agents.map((agent) => (
        <div
          key={agent.id}
          className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-3"
        >
          <div>
            <div className="font-medium text-zinc-100">
              {agent.capabilities.join(', ')}
            </div>
            <div className="font-mono text-xs text-zinc-500">
              {agent.stellarAddress.slice(0, 12)}...{agent.stellarAddress.slice(-4)}
            </div>
          </div>
          <div className="text-right">
            <div className="font-mono text-sm text-emerald-400">
              {agent.priceUsdc} USDC/call
            </div>
            <div className="text-xs text-zinc-500">
              {agent.endpointUrl}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
