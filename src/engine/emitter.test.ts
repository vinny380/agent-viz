import { describe, it, expect } from "vitest";
import { createEmitter } from "./emitter";
import type { AgentEvent } from "../shared/events";

describe("createEmitter", () => {
  it("stamps incrementing seq and a numeric ts", () => {
    const out: AgentEvent[] = [];
    const emit = createEmitter((e) => out.push(e));
    emit({ type: "agent_spawned", agentId: "a", parentId: null, role: "orchestrator", label: "H" });
    emit({ type: "loop_step_started", agentId: "a", step: 1 });
    expect(out[0]!.seq).toBe(1);
    expect(out[1]!.seq).toBe(2);
    expect(typeof out[0]!.ts).toBe("number");
    expect(out[1]!.type).toBe("loop_step_started");
  });
});
