import { describe, it, expect } from "vitest";
import { runAgent, type AgentDeps } from "./anthropic-agent";
import type { ModelClient, ModelStreamEvent, ModelTurnInput } from "./model";
import { createToolRegistry } from "./tools";
import type { AgentEventInput } from "../shared/events";

/** A ModelClient that replays a queue of scripted turns. */
function scriptedModel(turns: ModelStreamEvent[][]): ModelClient {
  let i = 0;
  return {
    async *stream(_input: ModelTurnInput) {
      const turn = turns[i++] ?? [];
      for (const e of turn) yield e;
    },
  };
}

function collector() {
  const events: AgentEventInput[] = [];
  return { emit: (e: AgentEventInput) => events.push(e), events };
}

describe("runAgent", () => {
  it("runs a think → tool → finish loop and emits the expected event sequence", async () => {
    const { emit, events } = collector();
    const model = scriptedModel([
      // turn 1: think, then call calculate
      [
        { type: "thinking_start" },
        { type: "thinking_delta", text: "2+2 is easy" },
        { type: "thinking_stop" },
        {
          type: "done", stopReason: "tool_use", text: "", assistantContent: [],
          toolUses: [{ id: "t1", name: "calculate", input: { expression: "2+2" } }],
        },
      ],
      // turn 2: finish
      [
        { type: "text_delta", text: "The answer is 4." },
        { type: "done", stopReason: "end_turn", text: "The answer is 4.", assistantContent: [], toolUses: [] },
      ],
    ]);

    const deps: AgentDeps = {
      model,
      tools: createToolRegistry(),
      emit,
      toolContext: { sandboxDir: ".", spawn: async () => "" },
    };

    const final = await runAgent(deps, {
      agentId: "root", parentId: null, role: "orchestrator", label: "HERO",
      systemPrompt: "sys", userPrompt: "what is 2+2?",
    });

    expect(final).toBe("The answer is 4.");
    const types = events.map((e) => e.type);
    expect(types).toEqual([
      "agent_spawned",
      "loop_step_started",
      "thinking_started",
      "thinking_delta",
      "thinking_stopped",
      "tool_call_started",
      "tool_call_result",
      "loop_step_started",
      "message_delta",
      "agent_finished",
    ]);
    const result = events.find((e) => e.type === "tool_call_result");
    expect(result).toMatchObject({ ok: true, preview: "4" });
  });

  it("stops at maxSteps to avoid infinite loops", async () => {
    const { emit, events } = collector();
    // every turn asks for a tool again → would loop forever without the cap
    const looping: ModelStreamEvent[] = [
      { type: "done", stopReason: "tool_use", text: "", assistantContent: [],
        toolUses: [{ id: "tx", name: "calculate", input: { expression: "1+1" } }] },
    ];
    const model: ModelClient = { async *stream() { for (const e of looping) yield e; } };
    const deps: AgentDeps = {
      model, tools: createToolRegistry(), emit,
      toolContext: { sandboxDir: ".", spawn: async () => "" }, maxSteps: 3,
    };
    await runAgent(deps, {
      agentId: "a", parentId: null, role: "orchestrator", label: "H",
      systemPrompt: "s", userPrompt: "go",
    });
    expect(events.filter((e) => e.type === "loop_step_started")).toHaveLength(3);
    expect(events.some((e) => e.type === "agent_finished")).toBe(true);
  });
});
