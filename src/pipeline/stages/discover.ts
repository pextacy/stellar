/**
 * Discover stage — queries the registry for capable agents
 *
 * Plugs into the existing omx pipeline as a new stage.
 * Given a task description, determines which agent capabilities are needed
 * and queries the AgentMesh registry to find available agents sorted by reputation.
 */

import type { PipelineStage, StageContext, StageResult } from '../types.js';

export interface AgentRecord {
  readonly id: string;
  readonly endpointUrl: string;
  readonly capabilities: readonly string[];
  readonly priceUsdc: string;
  readonly stellarAddress: string;
  readonly registeredAt: string;
  readonly reputationScore?: number;
}

export interface DiscoverStageOptions {
  readonly registryUrl: string;
}

async function queryRegistry(registryUrl: string, capability: string): Promise<AgentRecord[]> {
  const response = await fetch(`${registryUrl}/agents?capability=${encodeURIComponent(capability)}`);
  if (!response.ok) {
    throw new Error(`Registry query failed: ${response.status} ${response.statusText}`);
  }
  return response.json() as Promise<AgentRecord[]>;
}

function inferCapabilities(task: string): string[] {
  const lower = task.toLowerCase();
  const capabilities: string[] = [];

  if (lower.includes('fetch') || lower.includes('data') || lower.includes('search') || lower.includes('find') || lower.includes('research')) {
    capabilities.push('data');
  }
  if (lower.includes('analyz') || lower.includes('comput') || lower.includes('process') || lower.includes('infer') || lower.includes('summar')) {
    capabilities.push('compute');
  }
  if (lower.includes('send') || lower.includes('write') || lower.includes('notify') || lower.includes('format') || lower.includes('report') || lower.includes('action')) {
    capabilities.push('action');
  }

  if (capabilities.length === 0) {
    capabilities.push('data', 'compute', 'action');
  }

  return capabilities;
}

export function createDiscoverStage(options: DiscoverStageOptions): PipelineStage {
  return {
    name: 'discover',

    async run(ctx: StageContext): Promise<StageResult> {
      const startTime = Date.now();
      const capabilities = inferCapabilities(ctx.task);

      const agentsByCapability: Record<string, AgentRecord[]> = {};

      for (const cap of capabilities) {
        const agents = await queryRegistry(options.registryUrl, cap);
        if (agents.length === 0) {
          return {
            status: 'failed',
            artifacts: {},
            duration_ms: Date.now() - startTime,
            error: `No agents found for capability: ${cap}`,
          };
        }
        agentsByCapability[cap] = agents;
      }

      return {
        status: 'completed',
        artifacts: {
          capabilities,
          agentsByCapability,
          selectedAgents: Object.fromEntries(
            Object.entries(agentsByCapability).map(([cap, agents]) => [
              cap,
              agents[0],
            ]),
          ),
        },
        duration_ms: Date.now() - startTime,
      };
    },
  };
}
