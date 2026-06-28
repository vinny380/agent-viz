import { describe, expect, it } from "vitest";
import { cueForEvent } from "./feedback";
import type { AgentEvent, AgentEventInput } from "../../shared/events";

let seq = 0;
function ev(event: AgentEventInput): AgentEvent {
  return { ...event, seq: ++seq, ts: 0 } as AgentEvent;
}

describe("cueForEvent", () => {
  it("maps major trace events to Game Boy feedback cues", () => {
    expect(cueForEvent(ev({ type: "run_started", agentId: "a", rootAgentId: "a", prompt: "go" }))).toBe("boot");
    expect(cueForEvent(ev({ type: "agent_spawned", agentId: "a", parentId: null, role: "orchestrator", label: "H" }))).toBeNull();
    expect(cueForEvent(ev({ type: "agent_spawned", agentId: "b", parentId: "a", role: "subagent", label: "S" }))).toBe("spawn");
    expect(cueForEvent(ev({ type: "model_call_started", agentId: "a", modelCallId: "m" }))).toBe("llm");
    expect(cueForEvent(ev({ type: "tool_call_started", agentId: "a", toolCallId: "t", name: "search", input: {} }))).toBe("tool");
    expect(cueForEvent(ev({ type: "tool_call_result", agentId: "a", toolCallId: "t", ok: true, preview: "ok" }))).toBe("ok");
    expect(cueForEvent(ev({ type: "error", agentId: "a", message: "bad" }))).toBe("fail");
    expect(cueForEvent(ev({ type: "agent_finished", agentId: "a", finalText: "done" }))).toBe("finish");
  });
});
