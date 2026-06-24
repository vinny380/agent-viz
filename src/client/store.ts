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
  depth: number;
  phase: Phase;
  step: number;
  thinkingText: string;
  messageText: string;
  currentTool?: ToolCallState;
  toolHistory: ToolCallState[];
  finalText?: string;
  error?: string;
}

export interface LogEntry {
  seq: number;
  agentId: string;
  label: string;
  depth: number;
  kind: "think" | "say" | "tool" | "result" | "final" | "error";
  text: string;
  ok?: boolean;
}

export interface WorldState {
  rootAgentId: string | null;
  prompt: string | null;
  agents: Record<string, AgentState>;
  log: LogEntry[];
  lastSeq: number;
  status: "idle" | "running" | "finished";
}

export function initialWorld(): WorldState {
  return { rootAgentId: null, prompt: null, agents: {}, log: [], lastSeq: 0, status: "idle" };
}

function newAgent(agentId: string, parentId: string | null, role: AgentRole, label: string, depth: number): AgentState {
  return {
    agentId, parentId, role, label, depth,
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

/** Builds a LogEntry, resolving label/depth from current agent state (with fallbacks). */
function makeEntry(
  state: WorldState,
  event: AgentEvent,
  kind: LogEntry["kind"],
  text: string,
  ok?: boolean,
): LogEntry {
  const agent = state.agents[event.agentId];
  const entry: LogEntry = {
    seq: event.seq,
    agentId: event.agentId,
    label: agent?.label ?? event.agentId,
    depth: agent?.depth ?? 0,
    kind,
    text,
  };
  if (ok !== undefined) entry.ok = ok;
  return entry;
}

/** Returns a new WorldState with `entry` appended to the log (purely). */
function pushLog(state: WorldState, entry: LogEntry): WorldState {
  return { ...state, log: [...state.log, entry] };
}

/**
 * Coalesces streaming text into the trailing log entry when it matches this
 * agent + kind; otherwise appends a fresh entry. Never mutates input arrays.
 */
function appendStreaming(state: WorldState, event: AgentEvent, kind: "think" | "say", text: string): WorldState {
  const last = state.log[state.log.length - 1];
  if (last && last.kind === kind && last.agentId === event.agentId) {
    const merged: LogEntry = { ...last, text: last.text + text };
    return { ...state, log: [...state.log.slice(0, -1), merged] };
  }
  return pushLog(state, makeEntry(state, event, kind, text));
}

export function reduce(state: WorldState, event: AgentEvent): WorldState {
  const next: WorldState = { ...state, lastSeq: event.seq };

  switch (event.type) {
    case "run_started":
      return { ...next, status: "running", rootAgentId: event.rootAgentId, prompt: event.prompt };

    case "agent_spawned": {
      const parentDepth = event.parentId ? next.agents[event.parentId]?.depth ?? 0 : 0;
      const depth = event.parentId ? parentDepth + 1 : 0;
      return {
        ...next,
        agents: {
          ...next.agents,
          [event.agentId]: newAgent(event.agentId, event.parentId, event.role, event.label, depth),
        },
      };
    }

    case "loop_step_started":
      return withAgent(next, event.agentId, (a) => ({ ...a, step: event.step, thinkingText: "" }));

    case "thinking_started": {
      const withPhase = withAgent(next, event.agentId, (a) => ({ ...a, phase: "thinking", thinkingText: "" }));
      return pushLog(withPhase, makeEntry(withPhase, event, "think", ""));
    }

    case "thinking_delta": {
      const withText = withAgent(next, event.agentId, (a) => ({ ...a, thinkingText: a.thinkingText + event.text }));
      return appendStreaming(withText, event, "think", event.text);
    }

    case "thinking_stopped":
      return next;

    case "message_delta": {
      const withText = withAgent(next, event.agentId, (a) => ({ ...a, messageText: a.messageText + event.text }));
      return appendStreaming(withText, event, "say", event.text);
    }

    case "tool_call_started": {
      const withTool = withAgent(next, event.agentId, (a) => ({
        ...a,
        phase: "acting",
        currentTool: { toolCallId: event.toolCallId, name: event.name, input: event.input, status: "pending" },
      }));
      return pushLog(withTool, makeEntry(withTool, event, "tool", `${event.name}(${JSON.stringify(event.input)})`));
    }

    case "tool_call_result": {
      const withResult = withAgent(next, event.agentId, (a) => {
        const resolved: ToolCallState = {
          toolCallId: event.toolCallId,
          name: a.currentTool?.name ?? "tool",
          input: a.currentTool?.input,
          status: event.ok ? "ok" : "error",
          preview: event.preview,
        };
        return { ...a, phase: "observing", currentTool: resolved, toolHistory: [...a.toolHistory, resolved] };
      });
      return pushLog(withResult, makeEntry(withResult, event, "result", event.preview, event.ok));
    }

    case "agent_finished": {
      const withFinal = withAgent(next, event.agentId, (a) => ({ ...a, phase: "finished", finalText: event.finalText }));
      return pushLog(withFinal, makeEntry(withFinal, event, "final", event.finalText));
    }

    case "run_finished":
      return { ...next, status: "finished" };

    case "error": {
      const withError = withAgent(next, event.agentId, (a) => ({ ...a, phase: "error", error: event.message }));
      return pushLog(withError, makeEntry(withError, event, "error", event.message));
    }
  }
}
