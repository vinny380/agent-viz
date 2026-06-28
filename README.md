<div align="center">

# 🎮 Agent Quest

**Watch your AI agents work — as a 90s-RPG pixel party on a Game Boy.**

Every reasoning step, tool call, and spawned subagent becomes a sprite casting
spells on a CRT-glowing arena, live. Provider-neutral: pipe in Claude, OpenAI,
LangChain, or your own loop.

</div>

---

> [!NOTE]
> **You're an AI coding agent and want to be visualized?** Jump to
> [**Instrument any agent**](#-instrument-any-agent) — it's a copy-paste block
> and a 14-event protocol. Start it (`npm start`), emit events, watch yourself
> work.

## Quick start

```sh
npm install
cp .env.example .env        # add ANTHROPIC_API_KEY for the bundled demo (optional)
npm start                   # boots hub + viewer and opens the browser
```

`npm start` (once installed, `npx agent-viz`) is the one command: it boots the
trace hub on `ws://127.0.0.1:8788`, serves the Game Boy viewer, and opens your
browser. Set `AGENT_VIZ_PORT` to move the hub. (`npm run dev` does the same with
file-watch for hacking on the viewer itself.)

Open the browser, click the LCD to zoom, type a quest, hit **GO**. A real Claude
agent loop drives the arena.

No API key? The hub still runs as a **passive listener** — feed it traces from
your own agents (below) and watch them play out.

## How it works

```
   PRODUCERS                         ENGINE                        UI
 ┌──────────────────┐   AgentEvent  ┌──────────────────┐  broadcast  ┌──────────────┐
 │ bundled demo     │──────────────▶│  trace hub        │────────────▶│  Game Boy    │
 │ listener SDK     │   over  WS    │  (ws://…:8788)     │   over WS   │  (PixiJS)    │
 │ raw JSON / any   │──────────────▶│  stamps seq + ts  │────────────▶│  any viewer  │
 │ framework        │               │  fans out to all  │             │              │
 └──────────────────┘               └──────────────────┘             └──────────────┘
```

One event stream, three swappable sides. The UI reduces **purely** from the
event stream, so you can swap producers (any provider, replay logs) or the UI
(Game Boy today; `src/ui/<yours>/` tomorrow) without touching the other side.

### Layout

| Module | Layer | What it is |
|---|---|---|
| `src/shared/events.ts` | **protocol** | The `AgentEvent` union + type guards. The one contract everything speaks. |
| `src/engine/` | **observability engine** | The WebSocket trace hub, event stamper, and the bundled Anthropic demo agent + tools. |
| `src/listener/` | **producer SDK** | `connectAgentViz` / `AgenticListener` — how *your* agent emits events. |
| `src/ui/gameboy/` | **presentation** | The Game Boy arena (PixiJS). Swap-ready — add a sibling UI here. |

## 🤖 Instrument any agent

Three ways to feed the hub, easiest first.

### 1. The SDK (TypeScript)

```ts
import { connectAgentViz } from "./src/listener/websocket";

const viz = await connectAgentViz("ws://127.0.0.1:8788", { idPrefix: "release" });

try {
  await viz.run({ prompt: "Plan the release", label: "PLANNER" }, async (agent) => {
    agent.think("Inspecting release state.");                         // 🧠 thought bubble

    const plan = await agent.llm("anthropic:claude-opus-4-8", () =>   // ◇ model call
      callModel("Plan the release"));

    const files = await agent.tool("list_files", { path: "." }, () => // ⚙ tool cast
      listFiles("."));

    await agent.subagent("REVIEWER", async (reviewer) => {           // 🌀 spawns a sprite
      reviewer.say("Checking risk areas.");
      return "No blocker found.";
    });

    agent.say("Release plan ready.");                                 // 💬 speech bubble
    return `Done. Inspected ${files.length} files.`;                  // ✓ final answer
  });
} finally {
  viz.close();
}
```

`agent.llm` / `agent.tool` / `agent.subagent` wrap your real calls — they emit
the start event, run your function, then emit the result (or the error if it
throws). The callback's return value becomes the agent's final answer.

### 2. Raw JSON — any language, any framework

If your stack already has callbacks, send normalized events straight over the
socket. The hub stamps `seq` + `ts` and broadcasts to every viewer:

```jsonc
// ws://127.0.0.1:8788
{ "type": "trace_event", "event": {
    "type": "tool_call_started", "agentId": "a1", "toolCallId": "t1",
    "name": "search", "input": { "query": "release checklist" } } }
```

Batch with `{ "type": "trace_events", "events": [ … ] }`.

### 3. The bundled demo

`npm start`, type a prompt. A real Anthropic ReAct loop (with
`spawn_subagent`) drives the arena — the reference producer.

### The protocol

Every event has a `type` and an `agentId`. Producers **omit** `seq`/`ts` (the hub
adds them). Roles: `orchestrator` (root) or `subagent` (or any string).

| Event | Key fields | In the arena |
|---|---|---|
| `run_started` | `rootAgentId, prompt` | Boot the arena |
| `agent_spawned` | `parentId, role, label` | Portal opens, sprite walks in, tethered to parent |
| `loop_step_started` | `step` | Step counter ticks; loop gauge resets |
| `thinking_started` · `_delta` · `_stopped` | `text` (delta) | Thought bubble opens, types, closes |
| `message_delta` | `text` | Speech bubble (visible assistant text) |
| `model_call_started` · `_finished` | `modelCallId, provider?, model?, ok` | LLM call marker |
| `tool_call_started` | `toolCallId, name, input` | Sprite casts; name + args flash |
| `tool_call_result` | `toolCallId, ok, preview` | Result returns; ✨ or red hit-flash |
| `agent_finished` | `finalText` | Sprite bows; subagents despawn |
| `run_finished` | `rootAgentId` | Victory |
| `error` | `message` | Damage flash + toast |

`src/shared/events.ts` is the source of truth — `isAgentEventInput()` validates a
producer payload, `isAgentEvent()` validates a stamped one.

→ Full SDK reference (advanced wrapper API, thinking-text rules):
[**docs/listener-sdk.md**](docs/listener-sdk.md).

## Runnable examples

Each is a self-contained producer you can read in one sitting. All default to
**mock mode** (no API key needed); set the real-mode env var to call the live SDK.

```sh
npm run example:workflow    # ⭐ the watchable one: a COMMAND agent fans out to 4 workers
npm run example:debate      # parallel debate swarm + moderator synthesis
npm run example:incident    # incident response with a failing tool call + retry
npm run example:langchain   # LangChain callback adapter
npm run example:anthropic   # Anthropic SDK   (ANTHROPIC_EXAMPLE_REAL=1 for live)
npm run example:openai      # OpenAI SDK      (OPENAI_EXAMPLE_REAL=1 for live)
```

Run one against a live hub: `AGENT_VIZ_URL=ws://127.0.0.1:8788 npm run example:workflow`.
`WORKFLOW_SPEED_MS=0` makes the workflow demo run flat-out.

## Config

| Var | Where | Default |
|---|---|---|
| `ANTHROPIC_API_KEY` | engine | — (only for the bundled demo) |
| `AGENT_VIZ_PORT` | engine | `8788` |
| `AGENT_VIZ_URL` | producers (Node) | `ws://127.0.0.1:8788` |
| `VITE_TRACE_WS_URL` | UI (browser) | `ws://127.0.0.1:8788` |

Use a different port when another workspace already holds `8788`.

## Develop

```sh
npm start            # one command: hub + viewer + opens browser
npm run dev          # same, file-watched for hacking on the viewer
npm test             # vitest (store reducer, agent loop, protocol guards, SDK)
npm run build        # tsc --noEmit && vite build
npm run smoke:listener-examples   # deterministic end-to-end over the wire
```

The store (`src/ui/gameboy/store.ts`) is a pure `event → state` reducer — most
correctness lives there and is unit-tested without Pixi or a network.

---

<div align="center">
<sub>Provider-neutral agent observability with a CRT tan.</sub>
</div>
