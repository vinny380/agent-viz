import { describe, it, expect } from "vitest";
import { createToolRegistry } from "./tools";

describe("spawn_subagent tool", () => {
  it("is registered with a schema", () => {
    const reg = createToolRegistry();
    const def = reg.defs.find((d) => d.name === "spawn_subagent");
    expect(def).toBeDefined();
    expect((def!.input_schema as any).properties.task).toBeDefined();
  });

  it("delegates to ctx.spawn and returns the child result", async () => {
    const reg = createToolRegistry();
    let captured: { task: string; role: string } | null = null;
    const ctx = {
      sandboxDir: ".",
      spawn: async (task: string, role: string) => { captured = { task, role }; return "scout reports: done"; },
    };
    const out = await reg.execute("spawn_subagent", { task: "scout the cave", role: "scout" }, ctx);
    expect(captured).toEqual({ task: "scout the cave", role: "scout" });
    expect(out.ok).toBe(true);
    expect(out.resultForModel).toBe("scout reports: done");
  });
});
