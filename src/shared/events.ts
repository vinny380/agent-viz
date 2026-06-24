export type AgentRole = "orchestrator" | "subagent";

interface Base {
  seq: number;
  ts: number;
  agentId: string;
}

export interface RunStarted extends Base { type: "run_started"; rootAgentId: string; prompt: string; }
export interface AgentSpawned extends Base { type: "agent_spawned"; parentId: string | null; role: AgentRole; label: string; }
export interface LoopStepStarted extends Base { type: "loop_step_started"; step: number; }
export interface ThinkingStarted extends Base { type: "thinking_started"; }
export interface ThinkingDelta extends Base { type: "thinking_delta"; text: string; }
export interface ThinkingStopped extends Base { type: "thinking_stopped"; }
export interface MessageDelta extends Base { type: "message_delta"; text: string; }
export interface ToolCallStarted extends Base { type: "tool_call_started"; toolCallId: string; name: string; input: unknown; }
export interface ToolCallResult extends Base { type: "tool_call_result"; toolCallId: string; ok: boolean; preview: string; }
export interface AgentFinished extends Base { type: "agent_finished"; finalText: string; }
export interface RunFinished extends Base { type: "run_finished"; rootAgentId: string; }
export interface ErrorEvent extends Base { type: "error"; message: string; }

export type AgentEvent =
  | RunStarted | AgentSpawned | LoopStepStarted
  | ThinkingStarted | ThinkingDelta | ThinkingStopped
  | MessageDelta | ToolCallStarted | ToolCallResult
  | AgentFinished | RunFinished | ErrorEvent;

type DistributiveOmit<T, K extends keyof any> = T extends unknown ? Omit<T, K> : never;
export type AgentEventInput = DistributiveOmit<AgentEvent, "seq" | "ts">;

export type ClientMessage = { type: "start_run"; prompt: string };

export const AGENT_EVENT_TYPES: ReadonlySet<string> = new Set([
  "run_started", "agent_spawned", "loop_step_started",
  "thinking_started", "thinking_delta", "thinking_stopped",
  "message_delta", "tool_call_started", "tool_call_result",
  "agent_finished", "run_finished", "error",
]);

export function isAgentEvent(value: unknown): value is AgentEvent {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.type === "string"
    && AGENT_EVENT_TYPES.has(v.type)
    && typeof v.seq === "number"
    && typeof v.ts === "number"
    && typeof v.agentId === "string";
}
