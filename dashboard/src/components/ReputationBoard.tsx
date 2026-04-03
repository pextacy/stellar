/**
 * Reputation leaderboard — shows agent scores from registry + ReputationRegistry contract.
 * No mock data. No gradients.
 */

import type { Agent } from '../hooks/useStellar';

interface ReputationBoardProps {
  agents: Agent[];
  scores: Record<string, number>;
  loading: boolean;
  error: string | null;
}

export function ReputationBoard({ agents, scores, loading, error }: ReputationBoardProps) {
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

  const sorted = [...agents].sort((a, b) => {
    const sa = scores[a.stellarAddress] ?? -1;
    const sb = scores[b.stellarAddress] ?? -1;
    return sb - sa;
  });

  return (
    <div className="space-y-2">
      {sorted.map((agent) => {
        const score = scores[agent.stellarAddress];
        return (
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
            <div className="flex items-center gap-6">
              {score !== undefined ? (
                <div className="text-right">
                  <div className="font-mono text-sm text-blue-400">{score.toFixed(1)}</div>
                  <div className="text-xs text-zinc-500">rep score</div>
                </div>
              ) : (
                <div className="text-xs text-zinc-600 font-mono">no calls yet</div>
              )}
              <div className="text-right">
                <div className="font-mono text-sm text-emerald-400">
                  {agent.priceUsdc} USDC/call
                </div>
                <div className="text-xs text-zinc-500">
                  {agent.endpointUrl}
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
