/**
 * Pay-and-execute stage — calls each selected agent via x402 middleware
 *
 * Plugs into the existing omx pipeline. For each agent in the execution plan:
 * 1. X402Middleware checks Soroban spending policy
 * 2. Sends x402 request (auto-pays via Stellar USDC)
 * 3. Records spend + reputation on-chain
 */

import type { PipelineStage, StageContext, StageResult } from '../types.js';
import type { X402Middleware, AgentCallResult } from '../../stellar/x402-middleware.js';
import type { AgentRecord } from './discover.js';

export interface PayAndExecuteStageOptions {
  readonly middleware: X402Middleware;
  readonly budgetUsdc: string;
}

export function createPayAndExecuteStage(options: PayAndExecuteStageOptions): PipelineStage {
  return {
    name: 'pay-and-execute',

    async run(ctx: StageContext): Promise<StageResult> {
      const startTime = Date.now();

      const discoverArtifacts = ctx.artifacts['discover'] as {
        capabilities: string[];
        selectedAgents: Record<string, AgentRecord>;
      } | undefined;

      if (!discoverArtifacts) {
        return {
          status: 'failed',
          artifacts: {},
          duration_ms: Date.now() - startTime,
          error: 'pay-and-execute requires discover stage to run first',
        };
      }

      const sessionId = ctx.sessionId ?? `session-${Date.now()}`;

      // Lock budget in Soroban
      const lockTxHash = await options.middleware.lockBudget(options.budgetUsdc, sessionId);

      const { capabilities, selectedAgents } = discoverArtifacts;
      const callResults: AgentCallResult[] = [];
      let previousResult: unknown = null;

      for (const capability of capabilities) {
        const agent = selectedAgents[capability];
        if (!agent) continue;

        const result = await options.middleware.callAgent({
          agentEndpoint: agent.endpointUrl,
          agentStellarAddress: agent.stellarAddress,
          agentPriceUsdc: agent.priceUsdc,
          sessionId,
          task: ctx.task,
          capability,
          previousResult,
        });

        callResults.push(result);

        if (!result.success) {
          return {
            status: 'failed',
            artifacts: { callResults, sessionId, lockTxHash },
            duration_ms: Date.now() - startTime,
            error: `Agent for ${capability} failed: ${result.error}`,
          };
        }

        previousResult = result.data;
      }

      // Release remaining budget
      await options.middleware.releaseRemainder(sessionId, options.middleware.coordinatorAddress);

      return {
        status: 'completed',
        artifacts: {
          callResults,
          finalResult: previousResult,
          sessionId,
          lockTxHash,
          totalPayments: callResults.filter((r) => r.txHash).length,
        },
        duration_ms: Date.now() - startTime,
      };
    },
  };
}
