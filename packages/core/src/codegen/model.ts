// Turn a WorkflowGraph into codegen-ready structures: slash-command units (a
// command + its ordered steps), subagents, and hook chains (a hook-event trigger
// → optional gate → handler → optional decision). Edge order drives body order.
import type { WorkflowGraph, Edge } from '../schema/graph.js';
import type {
  WorkflowNode,
  SlashCommandData,
  SubagentStepData,
  HookEventData,
  CommandHandlerData,
  HttpHandlerData,
  PromptHandlerData,
  AgentHandlerData,
  McpToolStepData,
  DecisionData,
  GateConditionData,
} from '../schema/nodes.js';
import { nodeById, nodesOfKind } from '../schema/graph-utils.js';

export type StepNode = Extract<
  WorkflowNode,
  { kind: 'step.prompt' | 'step.shell' | 'step.fileRef' | 'step.subagent' | 'step.mcpTool' }
>;

export interface CommandUnit {
  id: string;
  data: SlashCommandData;
  steps: StepNode[]; // in edge order
}

export interface SubagentUnit {
  id: string;
  data: SubagentStepData;
}

export type HandlerNode = Extract<
  WorkflowNode,
  {
    kind: 'hook.command' | 'hook.http' | 'hook.prompt' | 'hook.agent' | 'step.mcpTool';
  }
>;

export interface HookChain {
  triggerId: string;
  event: HookEventData['event'];
  matcher?: string;
  scope: HookEventData['scope'];
  gate?: GateConditionData;
  handler: HandlerNode;
  decision?: DecisionData;
}

/** Order a node's successors by their edge position in graph.edges (stable). */
function orderedSuccessors(graph: WorkflowGraph, nodeId: string): { edge: Edge; node: WorkflowNode }[] {
  const byId = nodeById(graph);
  const out: { edge: Edge; node: WorkflowNode }[] = [];
  for (const edge of graph.edges) {
    if (edge.source !== nodeId) continue;
    const node = byId.get(edge.target);
    if (node) out.push({ edge, node });
  }
  return out;
}

const STEP_KINDS = new Set(['step.prompt', 'step.shell', 'step.fileRef', 'step.subagent', 'step.mcpTool']);

/** Collect the ordered step chain reachable from a command (DFS in edge order). */
function collectSteps(graph: WorkflowGraph, commandId: string): StepNode[] {
  const steps: StepNode[] = [];
  const seen = new Set<string>();
  const visit = (id: string) => {
    for (const { node } of orderedSuccessors(graph, id)) {
      if (seen.has(node.id) || !STEP_KINDS.has(node.kind)) continue;
      seen.add(node.id);
      steps.push(node as StepNode);
      visit(node.id);
    }
  };
  visit(commandId);
  return steps;
}

export function commandUnits(graph: WorkflowGraph): CommandUnit[] {
  return nodesOfKind(graph, 'trigger.slashCommand').map((c) => ({
    id: c.id,
    data: c.data,
    steps: collectSteps(graph, c.id),
  }));
}

export function subagentUnits(graph: WorkflowGraph): SubagentUnit[] {
  return nodesOfKind(graph, 'step.subagent').map((s) => ({ id: s.id, data: s.data }));
}

const HANDLER_KINDS = new Set(['hook.command', 'hook.http', 'hook.prompt', 'hook.agent', 'step.mcpTool']);

/**
 * Build hook chains from every hook-event / sessionStart trigger. A trigger may
 * fan out to multiple handlers; each becomes its own chain (with the gate and
 * decision found along its path).
 */
export function hookChains(graph: WorkflowGraph): HookChain[] {
  const chains: HookChain[] = [];

  const decisionOf = (handlerId: string): DecisionData | undefined => {
    for (const { node } of orderedSuccessors(graph, handlerId)) {
      if (node.kind === 'output.decision') return node.data;
    }
    return undefined;
  };

  const emitFrom = (
    event: HookEventData['event'],
    matcher: string | undefined,
    scope: HookEventData['scope'],
    triggerId: string,
  ) => {
    for (const { node } of orderedSuccessors(graph, triggerId)) {
      let gate: GateConditionData | undefined;
      let handlerCandidates: { node: WorkflowNode }[] = [];
      if (node.kind === 'gate.condition') {
        gate = node.data;
        handlerCandidates = orderedSuccessors(graph, node.id);
      } else {
        handlerCandidates = [{ node }];
      }
      for (const { node: h } of handlerCandidates) {
        if (!HANDLER_KINDS.has(h.kind)) continue;
        chains.push({
          triggerId,
          event,
          matcher,
          scope,
          gate,
          handler: h as HandlerNode,
          decision: decisionOf(h.id),
        });
      }
    }
  };

  for (const t of nodesOfKind(graph, 'trigger.hookEvent')) {
    emitFrom(t.data.event, t.data.matcher, t.data.scope, t.id);
  }
  for (const t of nodesOfKind(graph, 'trigger.sessionStart')) {
    // The dedicated sessionStart node always fires SessionStart; project scope.
    emitFrom('SessionStart', undefined, 'project', t.id);
  }
  return chains;
}

// Re-export narrow data types used by emitters.
export type {
  CommandHandlerData,
  HttpHandlerData,
  PromptHandlerData,
  AgentHandlerData,
  McpToolStepData,
};
