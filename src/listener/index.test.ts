import { describe, it, expect } from "vitest";
import { createAgenticListener } from "./index";
import type { AgentEventInput } from "../shared/events";

describe("AgenticListener", () => {
  it("supports the simple coding-agent facade", async () => {
    const events: AgentEventInput[] = [];
    const listener = createAgenticListener((event) => events.push(event), { idPrefix: "simple" });

    const result = await listener.run({ prompt: "inspect", id: "root", label: "BOT" }, async (agent) => {
      agent.think("Need context.");
      const model = await agent.llm("openai:gpt-test", () => "use read_file");
      const tool = await agent.tool("read_file", { path: "package.json" }, () => "contents");
      await agent.subagent("CHECKER", async (child) => {
        child.say("looks fine");
        return "child ok";
      });
      agent.say(`${model}: ${tool}`);
      return "root ok";
    });

    expect(result).toBe("root ok");
    expect(events.map((event) => event.type)).toEqual([
      "run_started",
      "agent_spawned",
      "loop_step_started",
      "thinking_started",
      "thinking_delta",
      "thinking_stopped",
      "model_call_started",
      "model_call_finished",
      "tool_call_started",
      "tool_call_result",
      "agent_spawned",
      "loop_step_started",
      "message_delta",
      "agent_finished",
      "message_delta",
      "agent_finished",
      "run_finished",
    ]);
    expect(events[6]).toMatchObject({ provider: "openai", model: "gpt-test" });
    expect(events[10]).toMatchObject({ label: "CHECKER", parentId: "root" });
  });

  it("emits a provider-neutral run trace", async () => {
    const events: AgentEventInput[] = [];
    const listener = createAgenticListener((event) => events.push(event), { idPrefix: "test" });

    const root = listener.startRun({ prompt: "ship it", id: "root", label: "ROOT" });
    root.step();
    const modelResult = await root.modelCall(
      { provider: "openai", model: "gpt-test", input: { messages: 1 } },
      async () => "model says use a tool",
    );
    const toolResult = await root.tool({ name: "search", input: { q: "x" } }, async () => ["result"]);
    const child = root.spawn({ id: "child", label: "SCOUT" });
    child.message("done");
    child.finish("child done");
    root.finish(`${modelResult}; ${toolResult.length}`);
    listener.finishRun(root.agentId);

    expect(events.map((event) => event.type)).toEqual([
      "run_started",
      "agent_spawned",
      "loop_step_started",
      "model_call_started",
      "model_call_finished",
      "tool_call_started",
      "tool_call_result",
      "agent_spawned",
      "message_delta",
      "agent_finished",
      "agent_finished",
      "run_finished",
    ]);
    expect(events[3]).toMatchObject({ provider: "openai", model: "gpt-test" });
    expect(events[7]).toMatchObject({ agentId: "child", parentId: "root", role: "subagent" });
  });

  it("emits failed wrapper results before rethrowing", async () => {
    const events: AgentEventInput[] = [];
    const listener = createAgenticListener((event) => events.push(event), { idPrefix: "test" });
    const root = listener.startRun({ prompt: "fail", id: "root" });

    await expect(root.tool({ name: "explode" }, async () => {
      throw new Error("boom");
    })).rejects.toThrow("boom");

    expect(events.at(-1)).toMatchObject({
      type: "tool_call_result",
      agentId: "root",
      ok: false,
      preview: "boom",
    });
  });
});
