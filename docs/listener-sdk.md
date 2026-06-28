# Agent Viz Listener SDK

Agent Viz visualizes a small provider-neutral event protocol. The bundled demo
runner emits those events, but any agentic system can send the same stream:
LLM calls, tool calls, subagents, progress/thinking summaries, messages, final
answers, and errors.

> See [`../README.md`](../README.md) for the architecture and the full event
> table. The protocol's source of truth is [`../src/shared/events.ts`](../src/shared/events.ts).

## Run the Hub

```sh
npm run dev
```

The WebSocket trace hub listens on:

```txt
ws://127.0.0.1:8788
```

Use `AGENT_VIZ_PORT` and `VITE_TRACE_WS_URL` when another workspace is already
using the default port.

`ANTHROPIC_API_KEY` is only needed for the bundled demo prompt runner. Without
it, the server still works as a passive listener for external traces.

## Simple Interface

This is the preferred interface for coding agents and SDK adapters:

```ts
import { connectAgentViz } from "./src/listener/websocket";

const viz = await connectAgentViz("ws://127.0.0.1:8788", {
  idPrefix: "release-agent",
});

try {
  await viz.run({ prompt: "Plan the release", label: "PLANNER" }, async (agent) => {
    agent.think("Inspecting the release state.");

    const plan = await agent.llm("openai:gpt-4.1", async () => {
      return openai.responses.create({
        model: "gpt-4.1",
        input: "Plan the release",
      });
    });

    const files = await agent.tool("list_files", { path: "." }, async () => {
      return listFiles(".");
    });

    await agent.subagent("REVIEWER", async (reviewer) => {
      reviewer.say("Checking risk areas.");
      return "No blocker found.";
    });

    agent.say("Release plan ready.");
    return `Done. Inspected ${files.length} files.`;
  });
} finally {
  viz.close();
}
```

The callback return value becomes the agent's final answer unless you call
`agent.finish("...")` yourself.

Useful methods:

```ts
agent.think("short visible reasoning/progress summary");
agent.say("message text");
await agent.llm("anthropic:claude-4", () => callModel());
await agent.tool("read_file", { path: "README.md" }, () => readFile("README.md"));
await agent.subagent("SCOUT", async (scout) => "scout report");
agent.finish("final answer");
agent.error(err);
```

## Advanced Wrapper API

`connectAgentViz` also exposes the raw `listener` for manual control:

```ts
import { connectAgentViz } from "./src/listener/websocket";

const { listener, close } = await connectAgentViz("ws://127.0.0.1:8788", {
  idPrefix: "my-agent",
});

const root = listener.startRun({
  prompt: "Plan the release",
  id: "release-root",
  label: "PLANNER",
});

try {
  root.step();

  const plan = await root.modelCall(
    { provider: "openai", model: "gpt-4.1", input: { task: "Plan the release" } },
    async () => openai.responses.create({ model: "gpt-4.1", input: "Plan the release" }),
  );

  const files = await root.tool(
    { name: "list_files", input: { path: "." } },
    async () => listFiles("."),
  );

  const reviewer = root.spawn({ id: "release-reviewer", label: "REVIEWER" });
  reviewer.step();
  reviewer.message("Checking risk areas");
  reviewer.finish("No blocker found");

  root.message("Release plan ready.");
  root.finish(`Done. Inspected ${files.length} files.`);
} catch (error) {
  root.error(error);
} finally {
  listener.finishRun(root.agentId);
  close();
}
```

## Emit Raw Events

If a framework already has callbacks, send normalized events directly:

```ts
ws.send(JSON.stringify({
  type: "trace_event",
  event: {
    type: "tool_call_started",
    agentId: "agent-1",
    toolCallId: "tool-1",
    name: "search",
    input: { query: "release checklist" },
  },
}));
```

The server stamps `seq` and `ts`, then broadcasts the event to every connected
viewer.

For batches:

```ts
ws.send(JSON.stringify({
  type: "trace_events",
  events: [
    { type: "run_started", agentId: "agent-1", rootAgentId: "agent-1", prompt: "hello" },
    { type: "agent_spawned", agentId: "agent-1", parentId: null, role: "orchestrator", label: "AGENT" },
  ],
}));
```

## Thinking Text

Use `thinking_started`, `thinking_delta`, and `thinking_stopped` for reasoning
summaries or progress text that the underlying system is allowed to expose.
Do not send hidden chain-of-thought unless the model/provider explicitly makes
that content available for display.

## Runnable Examples

Run the deterministic smoke across all example agents:

```sh
npm run smoke:listener-examples
```

Run examples manually against a running trace hub:

```sh
AGENT_VIZ_URL=ws://127.0.0.1:8788 npm run example:workflow
AGENT_VIZ_URL=ws://127.0.0.1:8788 npm run example:langchain
AGENT_VIZ_URL=ws://127.0.0.1:8788 npm run example:anthropic
AGENT_VIZ_URL=ws://127.0.0.1:8788 npm run example:openai
AGENT_VIZ_URL=ws://127.0.0.1:8788 npm run example:debate
AGENT_VIZ_URL=ws://127.0.0.1:8788 npm run example:incident
```

`example:workflow` is the watchable demo: it runs a COMMAND agent that fans out
to DISCOVERY, ARCHITECT, BUILDER, and QA workers, with visible delays, model
calls, tools, and final synthesis. Set `WORKFLOW_SPEED_MS=0` for a fast smoke
run, or use the default pacing to watch the agents work live.

Additional examples:

- `example:langchain`: LangChain worker chains using `RunnableSequence`, `RunnableLambda`, and `DynamicTool`.
- `example:anthropic`: Anthropic SDK launch board with planner, critic, writer, tools, and synthesis.
- `example:openai`: OpenAI SDK launch board with planner, risk evaluator, writer, tools, and synthesis.
- `example:workflow`: LangChain-backed COMMAND workflow with four direct workers.
- `example:debate`: OpenAI SDK-backed parallel debate swarm with moderator synthesis.
- `example:incident`: Anthropic SDK-backed incident response with a failing tool call and retry path.

Every example uses an external SDK surface for the agent/model/tool workflow.
Mock mode keeps them deterministic and free to run; real SDK mode is opt-in via
the relevant API key flags below.

The Anthropic SDK example defaults to mock mode. To call the real SDK:

```sh
ANTHROPIC_API_KEY=sk-ant-... ANTHROPIC_EXAMPLE_REAL=1 npm run example:anthropic
```

The OpenAI SDK example defaults to mock mode. To call the real SDK:

```sh
OPENAI_API_KEY=sk-... OPENAI_EXAMPLE_REAL=1 npm run example:openai
```
