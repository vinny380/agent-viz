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
    expect(w.agents.root!.phase).toBe("idle");
    expect(w.agents.root!.label).toBe("HERO");
  });

  it("accumulates thinking deltas and sets phase", () => {
    const w = run([
      ev({ type: "agent_spawned", agentId: "a", parentId: null, role: "orchestrator", label: "H" }),
      ev({ type: "loop_step_started", agentId: "a", step: 1 }),
      ev({ type: "thinking_started", agentId: "a" }),
      ev({ type: "thinking_delta", agentId: "a", text: "I should " }),
      ev({ type: "thinking_delta", agentId: "a", text: "search." }),
    ]);
    expect(w.agents.a!.step).toBe(1);
    expect(w.agents.a!.phase).toBe("thinking");
    expect(w.agents.a!.thinkingText).toBe("I should search.");
  });

  it("tracks a tool call through acting and observing", () => {
    const w = run([
      ev({ type: "agent_spawned", agentId: "a", parentId: null, role: "orchestrator", label: "H" }),
      ev({ type: "tool_call_started", agentId: "a", toolCallId: "t1", name: "calculate", input: { expr: "2+2" } }),
      ev({ type: "tool_call_result", agentId: "a", toolCallId: "t1", ok: true, preview: "4" }),
    ]);
    expect(w.agents.a!.phase).toBe("observing");
    expect(w.agents.a!.currentTool).toMatchObject({ name: "calculate", status: "ok", preview: "4" });
    expect(w.agents.a!.toolHistory).toHaveLength(1);
  });

  it("resets per-step thinking text on a new loop step", () => {
    const w = run([
      ev({ type: "agent_spawned", agentId: "a", parentId: null, role: "orchestrator", label: "H" }),
      ev({ type: "thinking_started", agentId: "a" }),
      ev({ type: "thinking_delta", agentId: "a", text: "old" }),
      ev({ type: "loop_step_started", agentId: "a", step: 2 }),
    ]);
    expect(w.agents.a!.thinkingText).toBe("");
    expect(w.agents.a!.step).toBe(2);
  });

  it("records subagent parentage", () => {
    const w = run([
      ev({ type: "agent_spawned", agentId: "a", parentId: null, role: "orchestrator", label: "H" }),
      ev({ type: "agent_spawned", agentId: "b", parentId: "a", role: "subagent", label: "SCOUT" }),
    ]);
    expect(w.agents.b!.parentId).toBe("a");
    expect(w.agents.b!.role).toBe("subagent");
  });

  it("marks finished and error phases", () => {
    const w = run([
      ev({ type: "agent_spawned", agentId: "a", parentId: null, role: "orchestrator", label: "H" }),
      ev({ type: "agent_finished", agentId: "a", finalText: "done" }),
      ev({ type: "run_finished", agentId: "a", rootAgentId: "a" }),
    ]);
    expect(w.agents.a!.phase).toBe("finished");
    expect(w.agents.a!.finalText).toBe("done");
    expect(w.status).toBe("finished");
  });

  it("ignores events for unknown agents without throwing", () => {
    const w = run([ev({ type: "thinking_delta", agentId: "ghost", text: "x" })]);
    expect(w.agents.ghost).toBeUndefined();
    expect(w.lastSeq).toBe(seq);
  });

  it("coalesces thinking deltas into one growing think log entry", () => {
    const w = run([
      ev({ type: "agent_spawned", agentId: "a", parentId: null, role: "orchestrator", label: "H" }),
      ev({ type: "thinking_started", agentId: "a" }),
      ev({ type: "thinking_delta", agentId: "a", text: "I should " }),
      ev({ type: "thinking_delta", agentId: "a", text: "search " }),
      ev({ type: "thinking_delta", agentId: "a", text: "the docs." }),
    ]);
    const thinkEntries = w.log.filter((e) => e.kind === "think" && e.agentId === "a");
    expect(thinkEntries).toHaveLength(1);
    expect(thinkEntries[0]!.text).toBe("I should search the docs.");
    expect(thinkEntries[0]!.label).toBe("H");
    expect(thinkEntries[0]!.depth).toBe(0);
  });

  it("does not wipe the log on a new loop step", () => {
    const w = run([
      ev({ type: "agent_spawned", agentId: "a", parentId: null, role: "orchestrator", label: "H" }),
      ev({ type: "thinking_started", agentId: "a" }),
      ev({ type: "thinking_delta", agentId: "a", text: "first thoughts" }),
      ev({ type: "loop_step_started", agentId: "a", step: 2 }),
    ]);
    // The per-agent scratch field is reset, but the persistent log survives.
    expect(w.agents.a!.thinkingText).toBe("");
    const thinkEntries = w.log.filter((e) => e.kind === "think" && e.agentId === "a");
    expect(thinkEntries).toHaveLength(1);
    expect(thinkEntries[0]!.text).toBe("first thoughts");
  });

  it("appends tool, result, final, and error entries with correct kinds and ok flags", () => {
    const w = run([
      ev({ type: "agent_spawned", agentId: "a", parentId: null, role: "orchestrator", label: "H" }),
      ev({ type: "tool_call_started", agentId: "a", toolCallId: "t1", name: "calculate", input: { expr: "2+2" } }),
      ev({ type: "tool_call_result", agentId: "a", toolCallId: "t1", ok: true, preview: "4" }),
      ev({ type: "tool_call_started", agentId: "a", toolCallId: "t2", name: "boom", input: {} }),
      ev({ type: "tool_call_result", agentId: "a", toolCallId: "t2", ok: false, preview: "failed" }),
      ev({ type: "message_delta", agentId: "a", text: "Hello " }),
      ev({ type: "message_delta", agentId: "a", text: "world" }),
      ev({ type: "agent_finished", agentId: "a", finalText: "all done" }),
      ev({ type: "error", agentId: "a", message: "kaboom" }),
    ]);

    const tools = w.log.filter((e) => e.kind === "tool");
    expect(tools).toHaveLength(2);
    expect(tools[0]!.text).toBe(`calculate(${JSON.stringify({ expr: "2+2" })})`);

    const results = w.log.filter((e) => e.kind === "result");
    expect(results).toHaveLength(2);
    expect(results[0]!.text).toBe("4");
    expect(results[0]!.ok).toBe(true);
    expect(results[1]!.text).toBe("failed");
    expect(results[1]!.ok).toBe(false);

    const says = w.log.filter((e) => e.kind === "say");
    expect(says).toHaveLength(1);
    expect(says[0]!.text).toBe("Hello world");

    const finals = w.log.filter((e) => e.kind === "final");
    expect(finals).toHaveLength(1);
    expect(finals[0]!.text).toBe("all done");

    const errors = w.log.filter((e) => e.kind === "error");
    expect(errors).toHaveLength(1);
    expect(errors[0]!.text).toBe("kaboom");
  });

  it("carries depth 0 for the root and depth 1 for a subagent", () => {
    const w = run([
      ev({ type: "agent_spawned", agentId: "a", parentId: null, role: "orchestrator", label: "H" }),
      ev({ type: "thinking_started", agentId: "a" }),
      ev({ type: "thinking_delta", agentId: "a", text: "root thinks" }),
      ev({ type: "agent_spawned", agentId: "b", parentId: "a", role: "subagent", label: "SCOUT" }),
      ev({ type: "thinking_started", agentId: "b" }),
      ev({ type: "thinking_delta", agentId: "b", text: "scout thinks" }),
    ]);
    expect(w.agents.a!.depth).toBe(0);
    expect(w.agents.b!.depth).toBe(1);

    const rootEntry = w.log.find((e) => e.agentId === "a" && e.kind === "think");
    const scoutEntry = w.log.find((e) => e.agentId === "b" && e.kind === "think");
    expect(rootEntry!.depth).toBe(0);
    expect(scoutEntry!.depth).toBe(1);
  });

  it("starts with an empty log", () => {
    expect(initialWorld().log).toEqual([]);
  });
});
