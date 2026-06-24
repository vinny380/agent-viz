import type { AgentEvent, AgentEventInput } from "../shared/events";

/** Stamps a monotonic seq + wall-clock ts onto each emitted input. */
export function createEmitter(sink: (e: AgentEvent) => void): (input: AgentEventInput) => void {
  let seq = 0;
  return (input: AgentEventInput) => {
    sink({ ...(input as object), seq: ++seq, ts: Date.now() } as AgentEvent);
  };
}
