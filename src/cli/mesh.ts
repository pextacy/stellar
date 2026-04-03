/**
 * AgentMesh CLI command
 *
 * omx mesh run --task "..." --budget 0.50           Full x402 + Soroban pipeline
 * omx mesh run --task "..." --budget 0.50 --local   Local demo (skip Soroban + payment)
 * omx mesh status --session <id>                    Check session spend ledger
 * omx mesh agents                                   List registered agents
 */

import { runPipeline } from '../pipeline/orchestrator.js';
import { createDiscoverStage } from '../pipeline/stages/discover.js';
import { createPayAndExecuteStage } from '../pipeline/stages/pay-and-execute.js';
import { X402Middleware } from '../stellar/x402-middleware.js';
import { buildNativeHookEvent } from '../hooks/extensibility/events.js';
import { dispatchHookEvent } from '../hooks/extensibility/dispatcher.js';
import type { PipelineStage, StageContext, StageResult } from '../pipeline/types.js';
import type { AgentRecord } from '../pipeline/stages/discover.js';

function loadEnvOrDie(key: string): string {
  const value = process.env[key];
  if (!value) {
    console.error(`Missing required environment variable: ${key}`);
    process.exit(1);
  }
  return value;
}

// ---------------------------------------------------------------------------
// Local execution stage — calls agents directly, no x402 or Soroban
// ---------------------------------------------------------------------------

function createLocalExecuteStage(): PipelineStage {
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
          error: 'Discover stage must run first',
        };
      }

      const { capabilities, selectedAgents } = discoverArtifacts;
      const callResults: Array<{ agent: string; status: number; latencyMs: number; data: unknown }> = [];
      let previousResult: unknown = null;

      for (const capability of capabilities) {
        const agent = selectedAgents[capability];
        if (!agent) continue;

        console.log(`[mesh] Calling ${capability} agent at ${agent.endpointUrl}...`);
        const callStart = Date.now();

        try {
          const response = await fetch(agent.endpointUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              task: ctx.task,
              capability,
              sessionId: ctx.sessionId ?? '',
              previousResult,
            }),
          });

          const data = await response.json();
          const latencyMs = Date.now() - callStart;

          console.log(`[mesh]   ${capability}: ${response.status} (${latencyMs}ms)`);

          callResults.push({ agent: agent.id, status: response.status, latencyMs, data });

          if (response.status === 402) {
            console.log(`[mesh]   402 Payment Required — ${JSON.stringify(data)}`);
            console.log(`[mesh]   (use --local to skip payments for local testing)`);
          }

          if (response.status !== 200 && response.status !== 402) {
            return {
              status: 'failed',
              artifacts: { callResults },
              duration_ms: Date.now() - startTime,
              error: `Agent ${capability} returned ${response.status}`,
            };
          }

          previousResult = data;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`[mesh]   ${capability}: FAILED — ${msg}`);
          return {
            status: 'failed',
            artifacts: { callResults },
            duration_ms: Date.now() - startTime,
            error: `Agent ${capability} unreachable: ${msg}`,
          };
        }
      }

      return {
        status: 'completed',
        artifacts: {
          callResults,
          finalResult: previousResult,
          totalPayments: callResults.filter((r) => r.status === 200).length,
        },
        duration_ms: Date.now() - startTime,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Run pipeline
// ---------------------------------------------------------------------------

async function meshRun(task: string, budgetUsdc: string, local: boolean): Promise<void> {
  const registryUrl = process.env.REGISTRY_URL ?? 'http://localhost:3001';

  console.log(`[mesh] Mode: ${local ? 'LOCAL (no Soroban/payments)' : 'TESTNET (x402 + Soroban)'}`);
  console.log(`[mesh] Task: ${task}`);
  console.log(`[mesh] Budget: ${budgetUsdc} USDC`);
  console.log(`[mesh] Registry: ${registryUrl}`);
  console.log();

  await dispatchHookEvent(
    buildNativeHookEvent('session-start', {
      mode: 'mesh',
      task,
      budget_usdc: budgetUsdc,
      local,
    }),
  );

  let stages: PipelineStage[];

  if (local) {
    stages = [
      createDiscoverStage({ registryUrl }),
      createLocalExecuteStage(),
    ];
  } else {
    const middleware = new X402Middleware({
      coordinatorSecret: loadEnvOrDie('COORDINATOR_SECRET'),
      spendingPolicyContractId: loadEnvOrDie('SPENDING_POLICY_CONTRACT_ID'),
      reputationContractId: loadEnvOrDie('REPUTATION_CONTRACT_ID'),
      horizonUrl: process.env.HORIZON_URL,
      rpcUrl: process.env.SOROBAN_RPC_URL,
    });

    console.log(`[mesh] Coordinator: ${middleware.coordinatorAddress}`);
    console.log();

    stages = [
      createDiscoverStage({ registryUrl }),
      createPayAndExecuteStage({ middleware, budgetUsdc }),
    ];
  }

  const result = await runPipeline({
    name: 'agentmesh',
    task,
    stages,
    sessionId: `mesh-${Date.now()}`,
  });

  console.log();

  if (result.status === 'completed') {
    console.log(`[mesh] Pipeline completed in ${result.duration_ms}ms`);
    const execArtifacts = result.artifacts['pay-and-execute'] as Record<string, unknown> | undefined;
    if (execArtifacts) {
      console.log(`[mesh] Calls: ${(execArtifacts.callResults as unknown[])?.length ?? 0}`);
      console.log();
      console.log('[mesh] Final result:');
      console.log(JSON.stringify(execArtifacts.finalResult, null, 2));
    }
  } else {
    console.error(`[mesh] Pipeline FAILED: ${result.error}`);
    if (result.failedStage) {
      console.error(`[mesh] Failed at stage: ${result.failedStage}`);
    }
  }

  await dispatchHookEvent(
    buildNativeHookEvent('session-end', {
      mode: 'mesh',
      status: result.status,
      duration_ms: result.duration_ms,
    }),
  );
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const MESH_HELP = `
omx mesh - AgentMesh agent-to-agent economy on Stellar

Usage:
  omx mesh run --task "..." --budget <USDC>           Full x402 + Soroban flow
  omx mesh run --task "..." --budget <USDC> --local   Local demo (skip payments)
  omx mesh status --session <id>                      Check session spend ledger
  omx mesh agents                                     List registered agents

Environment:
  COORDINATOR_SECRET              Stellar secret key for coordinator wallet
  SPENDING_POLICY_CONTRACT_ID     Soroban SpendingPolicy contract address
  REPUTATION_CONTRACT_ID          Soroban ReputationRegistry contract address
  REGISTRY_URL                    Agent registry URL (default: http://localhost:3001)
  HORIZON_URL                     Stellar Horizon URL (default: testnet)
  SOROBAN_RPC_URL                 Soroban RPC URL (default: testnet)
`;

export async function meshCommand(args: string[]): Promise<void> {
  const sub = args[0];

  if (!sub || sub === 'help' || sub === '--help') {
    console.log(MESH_HELP);
    return;
  }

  if (sub === 'run') {
    let task = '';
    let budget = '0.50';
    let local = false;

    for (let i = 1; i < args.length; i++) {
      if (args[i] === '--task' && args[i + 1]) {
        task = args[++i];
      } else if (args[i] === '--budget' && args[i + 1]) {
        budget = args[++i];
      } else if (args[i] === '--local') {
        local = true;
      }
    }

    if (!task) {
      console.error('Missing --task argument');
      process.exit(1);
    }

    await meshRun(task, budget, local);
    return;
  }

  if (sub === 'agents') {
    const registryUrl = process.env.REGISTRY_URL ?? 'http://localhost:3001';
    try {
      const response = await fetch(`${registryUrl}/agents`);
      if (!response.ok) {
        console.error(`Registry error: ${response.status}`);
        process.exit(1);
      }
      const agents = await response.json();
      console.log(JSON.stringify(agents, null, 2));
    } catch (err) {
      console.error(`Cannot reach registry at ${registryUrl}: ${err instanceof Error ? err.message : err}`);
      process.exit(1);
    }
    return;
  }

  if (sub === 'status') {
    const sessionIdx = args.indexOf('--session');
    if (sessionIdx === -1 || !args[sessionIdx + 1]) {
      console.error('Missing --session argument');
      process.exit(1);
    }
    const sessionId = args[sessionIdx + 1];

    const middleware = new X402Middleware({
      coordinatorSecret: loadEnvOrDie('COORDINATOR_SECRET'),
      spendingPolicyContractId: loadEnvOrDie('SPENDING_POLICY_CONTRACT_ID'),
      reputationContractId: loadEnvOrDie('REPUTATION_CONTRACT_ID'),
    });

    const ledger = await middleware.getSessionLedger(sessionId);
    console.log(JSON.stringify(ledger, null, 2));
    return;
  }

  console.error(`Unknown mesh subcommand: ${sub}`);
  console.log(MESH_HELP);
  process.exit(1);
}
