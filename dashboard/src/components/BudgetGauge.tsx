/**
 * Budget gauge — locked / spent / remaining.
 * No gradients — flat colored bars only.
 */

interface BudgetGaugeProps {
  budget: number;
  spent: number;
}

export function BudgetGauge({ budget, spent }: BudgetGaugeProps) {
  const remaining = Math.max(0, budget - spent);
  const spentPct = budget > 0 ? (spent / budget) * 100 : 0;

  return (
    <div className="space-y-3">
      <div className="flex justify-between text-sm">
        <span className="text-zinc-400">Budget</span>
        <span className="font-mono text-zinc-100">{budget.toFixed(4)} USDC</span>
      </div>

      {/* Bar */}
      <div className="h-4 w-full rounded-sm bg-zinc-800 overflow-hidden">
        <div
          className="h-full bg-emerald-600"
          style={{ width: `${Math.min(100, spentPct)}%` }}
        />
      </div>

      <div className="flex justify-between text-xs">
        <div>
          <span className="text-emerald-400 font-mono">{spent.toFixed(4)}</span>
          <span className="text-zinc-500"> spent</span>
        </div>
        <div>
          <span className="text-zinc-300 font-mono">{remaining.toFixed(4)}</span>
          <span className="text-zinc-500"> remaining</span>
        </div>
      </div>
    </div>
  );
}
