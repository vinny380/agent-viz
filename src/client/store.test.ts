import { describe, it, expect } from "vitest";
import { initialWorld, reduce, type WorldState } from "./store";
import type { AgentEvent } from "../shared/events";

let seq = 0;
function ev(e: Omit<AgentEvent, "seq" | "ts"> & Record<string, unknown>): AgentEvent {
  return { seq: ++seq, ts: 0, ...(e as object) } as AgentEvent;
}
function run(events: AgentEvent[]): WorldState {
  return events.reduce(reduce, initialWorld());
}

describe("store reducer", () => {
  it("starts a run and spawns the root agent", () => {
    const w = run([
      ev({ type: "run_started", agentId: "root", rootAgentId: "root", prompt: "hi" }),
      ev({ type: "agent_spawned", agentId: "root", parentId: null, role: "orchestrator", label: "HERO" }),
    ]);
    expect(w.status).toBe("running");
    expect(w.rootAgentId).toBe("root");
    expect(w.prompt).toBe("hi");
    expect(w.agents.root.phase).toBe("idle");
    expect(w.agents.root.label).toBe("HERO");
  });

  it("accumulates thinking deltas and sets phase", () => {
    const w = run([
      ev({ type: "agent_spawned", agentId: "a", parentId: null, role: "orchestrator", label: "H" }),
      ev({ type: "loop_step_started", agentId: "a", step: 1 }),
      ev({ type: "thinking_started", agentId: "a" }),
      ev({ type: "thinking_delta", agentId: "a", text: "I should " }),
      ev({ type: "thinking_delta", agentId: "a", text: "search." }),
    ]);
    expect(w.agents.a.step).toBe(1);
    expect(w.agents.a.phase).toBe("thinking");
    expect(w.agents.a.thinkingText).toBe("I should search.");
  });

  it("tracks a tool call through acting and observing", () => {
    const w = run([
      ev({ type: "agent_spawned", agentId: "a", parentId: null, role: "orchestrator", label: "H" }),
      ev({ type: "tool_call_started", agentId: "a", toolCallId: "t1", name: "calculate", input: { expr: "2+2" } }),
      ev({ type: "tool_call_result", agentId: "a", toolCallId: "t1", ok: true, preview: "4" }),
    ]);
    expect(w.agents.a.phase).toBe("observing");
    expect(w.agents.a.currentTool).toMatchObject({ name: "calculate", status: "ok", preview: "4" });
    expect(w.agents.a.toolHistory).toHaveLength(1);
  });

  it("resets per-step thinking text on a new loop step", () => {
    const w = run([
      ev({ type: "agent_spawned", agentId: "a", parentId: null, role: "orchestrator", label: "H" }),
      ev({ type: "thinking_started", agentId: "a" }),
      ev({ type: "thinking_delta", agentId: "a", text: "old" }),
      ev({ type: "loop_step_started", agentId: "a", step: 2 }),
    ]);
    expect(w.agents.a.thinkingText).toBe("");
    expect(w.agents.a.step).toBe(2);
  });

  it("records subagent parentage", () => {
    const w = run([
      ev({ type: "agent_spawned", agentId: "a", parentId: null, role: "orchestrator", label: "H" }),
      ev({ type: "agent_spawned", agentId: "b", parentId: "a", role: "subagent", label: "SCOUT" }),
    ]);
    expect(w.agents.b.parentId).toBe("a");
    expect(w.agents.b.role).toBe("subagent");
  });

  it("marks finished and error phases", () => {
    const w = run([
      ev({ type: "agent_spawned", agentId: "a", parentId: null, role: "orchestrator", label: "H" }),
      ev({ type: "agent_finished", agentId: "a", finalText: "done" }),
      ev({ type: "run_finished", agentId: "a", rootAgentId: "a" }),
    ]);
    expect(w.agents.a.phase).toBe("finished");
    expect(w.agents.a.finalText).toBe("done");
    expect(w.status).toBe("finished");
  });

  it("ignores events for unknown agents without throwing", () => {
    const w = run([ev({ type: "thinking_delta", agentId: "ghost", text: "x" })]);
    expect(w.agents.ghost).toBeUndefined();
    expect(w.lastSeq).toBe(seq);
  });
});
