import type { AgentEvent, AgentRole } from "../shared/events";

export type Phase = "idle" | "thinking" | "acting" | "observing" | "finished" | "error";

export interface ToolCallState {
  toolCallId: string;
  name: string;
  input: unknown;
  status: "pending" | "ok" | "error";
  preview?: string;
}

export interface AgentState {
  agentId: string;
  parentId: string | null;
  role: AgentRole;
  label: string;
  phase: Phase;
  step: number;
  thinkingText: string;
  messageText: string;
  currentTool?: ToolCallState;
  toolHistory: ToolCallState[];
  finalText?: string;
  error?: string;
}

export interface WorldState {
  rootAgentId: string | null;
  prompt: string | null;
  agents: Record<string, AgentState>;
  lastSeq: number;
  status: "idle" | "running" | "finished";
}

export function initialWorld(): WorldState {
  return { rootAgentId: null, prompt: null, agents: {}, lastSeq: 0, status: "idle" };
}

function newAgent(agentId: string, parentId: string | null, role: AgentRole, label: string): AgentState {
  return {
    agentId, parentId, role, label,
    phase: "idle", step: 0, thinkingText: "", messageText: "",
    currentTool: undefined, toolHistory: [], finalText: undefined, error: undefined,
  };
}

/** Returns a new WorldState with `agentId` updated by `fn`. No-op if the agent is unknown. */
function withAgent(state: WorldState, agentId: string, fn: (a: AgentState) => AgentState): WorldState {
  const existing = state.agents[agentId];
  if (!existing) return state;
  return { ...state, agents: { ...state.agents, [agentId]: fn(existing) } };
}

export function reduce(state: WorldState, event: AgentEvent): WorldState {
  const next: WorldState = { ...state, lastSeq: event.seq };

  switch (event.type) {
    case "run_started":
      return { ...next, status: "running", rootAgentId: event.rootAgentId, prompt: event.prompt };

    case "agent_spawned":
      return {
        ...next,
        agents: {
          ...next.agents,
          [event.agentId]: newAgent(event.agentId, event.parentId, event.role, event.label),
        },
      };

    case "loop_step_started":
      return withAgent(next, event.agentId, (a) => ({ ...a, step: event.step, thinkingText: "" }));

    case "thinking_started":
      return withAgent(next, event.agentId, (a) => ({ ...a, phase: "thinking", thinkingText: "" }));

    case "thinking_delta":
      return withAgent(next, event.agentId, (a) => ({ ...a, thinkingText: a.thinkingText + event.text }));

    case "thinking_stopped":
      return next;

    case "message_delta":
      return withAgent(next, event.agentId, (a) => ({ ...a, messageText: a.messageText + event.text }));

    case "tool_call_started":
      return withAgent(next, event.agentId, (a) => ({
        ...a,
        phase: "acting",
        currentTool: { toolCallId: event.toolCallId, name: event.name, input: event.input, status: "pending" },
      }));

    case "tool_call_result":
      return withAgent(next, event.agentId, (a) => {
        const resolved: ToolCallState = {
          toolCallId: event.toolCallId,
          name: a.currentTool?.name ?? "tool",
          input: a.currentTool?.input,
          status: event.ok ? "ok" : "error",
          preview: event.preview,
        };
        return { ...a, phase: "observing", currentTool: resolved, toolHistory: [...a.toolHistory, resolved] };
      });

    case "agent_finished":
      return withAgent(next, event.agentId, (a) => ({ ...a, phase: "finished", finalText: event.finalText }));

    case "run_finished":
      return { ...next, status: "finished" };

    case "error":
      return withAgent(next, event.agentId, (a) => ({ ...a, phase: "error", error: event.message }));
  }
}
