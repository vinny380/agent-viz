# Agent Quest — Design Spec

**Date:** 2026-06-24
**Status:** Approved (verbal) — pending written review
**Author:** Vinny + Claude

## 1. Vision

A tool that intercepts an LLM agent's ReAct loop and renders it as a **90s-RPG
party of pixel characters working in real time.** The orchestrator agent is a
sprite on a CRT-glowing arena; when it reasons, a thought bubble fills with
streaming tokens; when it calls a tool, it "casts a spell" with an animation;
when it spawns a subagent, a summon portal opens and a new character walks in,
tethered to its parent. Developers literally watch their agents — and
subagents — work, like videogame characters.

The ReAct loop is visible three ways at once:

1. **Per-character state machine:** `IDLE → THINK → ACT → OBSERVE →` back to
   think. The sprite animates each phase.
2. **An orbiting marker / gauge** on each character that completes one
   revolution per ReAct iteration.
3. **A step counter** (`STEP 3`) ticking up per iteration.

This is for live use from day one — a real Claude agent loop drives the arena,
not a recording.

## 2. Architecture

```
  Browser (Pixi client)                Node (agent runner)              Anthropic API
 ┌──────────────────────┐   WS:start_run  ┌─────────────────────┐
 │ prompt input ────────┼────────────────▶│  WebSocket server   │
 │                      │                 │         │           │
 │ scene ◀── store ◀────┼◀── AgentEvent ──┤  anthropic-agent ───┼──▶ messages.stream()
 │ (sprites, FX, CRT)   │   (JSON stream) │  (ReAct loop)       │     (claude-opus-4-8,
 └──────────────────────┘                 │   ├─ tools          │      adaptive thinking,
                                          │   └─ spawn_subagent ┼──▶  display: summarized)
                                          └─────────────────────┘
```

- The **runner** is a Node process. It holds the API key, runs the agent loop,
  executes tools, and emits a normalized `AgentEvent` stream over a WebSocket.
- The **client** is a static Vite/Pixi app. It connects to the WebSocket,
  reduces events into a world-state store, and renders the arena. It sends one
  message type back: `start_run { prompt }`.
- The two share a **`AgentEvent` type union** — the contract everything renders
  off of.

**Security:** `ANTHROPIC_API_KEY` lives only in the runner's environment. The
browser never receives it. The WebSocket binds to localhost for the dev tool.

## 3. The event contract (`AgentEvent`)

Every event carries `agentId`, optional `parentId`, a monotonic `seq`, and `ts`.
The union (names indicative, finalized in the plan):

| Event | Payload | Drives in the arena |
|---|---|---|
| `run_started` | `rootAgentId, prompt` | Spawn the hero sprite; start music/CRT |
| `agent_spawned` | `agentId, parentId?, role, label` | Portal opens, character walks in, tether drawn |
| `loop_step_started` | `agentId, step` | Step counter ticks; loop gauge resets |
| `thinking_started` / `_delta` / `_stopped` | `agentId, text` | Thought bubble opens, types tokens, closes |
| `message_delta` | `agentId, text` | Speech bubble (visible assistant text) |
| `tool_call_started` | `agentId, toolCallId, name, input` | Character casts; tool name + args flash |
| `tool_call_result` | `agentId, toolCallId, ok, preview` | Result scroll returns; ✨ or red hit-flash |
| `agent_finished` | `agentId, finalText, usage` | Character bows / dims; subagents despawn |
| `run_finished` | `rootAgentId` | Victory state |
| `error` | `agentId?, message` | Damage flash + error toast |

Because the viz reduces purely from this stream, the runner is swappable later
(other providers, replay logs) without touching the client.

## 4. Anthropic integration (the runner)

- **SDK:** `@anthropic-ai/sdk` (TypeScript), model **`claude-opus-4-8`**.
- **Thinking:** `thinking: { type: "adaptive", display: "summarized" }`. The
  `summarized` display is **required** — Opus 4.8 omits thinking text by
  default, which would leave our thought bubbles empty.
- **Streaming:** `client.messages.stream(...)`. We read `content_block_start` /
  `content_block_delta` events and map `thinking_delta` → `thinking_delta`
  events and `text_delta` → `message_delta` events.
- **Manual agentic loop (not the auto tool-runner):** we control the loop so we
  can intercept each `tool_use` block, emit `tool_call_started`, execute the
  tool, emit `tool_call_result`, append the `tool_result`, and continue until
  `stop_reason === "end_turn"`. We handle `pause_turn` per SDK guidance.
- **Effort:** `output_config: { effort: "high" }`.

### Tools (small, real, visualizable)

A focused demo tool set, each client-side so the runner executes and can render
it:

- `read_file` / `list_files` — scoped to a sandbox dir.
- `calculate` — expression eval.
- `web_fetch` *(optional, later phase)*.
- `spawn_subagent { task, role }` — **the headliner.** Recursively instantiates
  a nested `anthropic-agent` with its own system prompt and a fresh `agentId`
  (parent = caller). Its events stream tagged with the child ID; its final text
  is returned to the parent as the tool result. This is how the "party" grows.

## 5. Tech stack

- **Vite + TypeScript** — client build, no framework ceremony.
- **PixiJS v8** (WebGL) — arena, sprites, particles. `pixi-filters` CRT/
  scanline/bloom for instant 90s grime. `BitmapText` pixel font for retro type.
- **Procedural pixel sprites** drawn from code (palette-limited 16×16 matrices)
  — zero art-asset dependencies; swappable for real packs later.
- **Node + `ws`** — runner WebSocket server. `@anthropic-ai/sdk` for the loop.
- Shared TS types compiled for both sides.

## 6. Component breakdown (each isolated, testable)

| Unit | Responsibility | Depends on |
|---|---|---|
| `shared/events.ts` | `AgentEvent` union + type guards | nothing |
| `runner/anthropic-agent.ts` | one agent's ReAct loop; emits events via callback | SDK, events |
| `runner/tools.ts` | tool defs + executors; `spawn_subagent` recurses into agent | anthropic-agent |
| `runner/server.ts` | WS server; `start_run` → run agent → broadcast events | anthropic-agent, ws |
| `client/net.ts` | WS client; parse events; `subscribe()` + `startRun()` | events |
| `client/store.ts` | reduce events → world state (agents, states, steps); pure | events |
| `client/sprites.ts` | procedural pixel sprite/palette generation | Pixi |
| `client/scene/*` | render arena, characters, bubbles, FX, portals, tethers, CRT | store, sprites, Pixi |
| `client/main.ts` | wire net → store → scene; prompt input box | all client units |

The store is a pure reducer (`event → state`), so it's unit-testable without
Pixi or a network. The scene reads state and renders; the runner is testable
with a fake Anthropic client.

## 7. Build phases

1. **The Money Shot** — runner + real Claude loop for a single orchestrator;
   client arena with CRT, one hero sprite cycling THINK→ACT→OBSERVE off live
   events, streaming thought bubble, one tool-cast animation, loop counter.
   *This is the "whoa."*
2. **The Party** — `spawn_subagent` tool; portal spawn, parent→child tethers,
   multiple characters working concurrently.
3. **Polish** — error/success juice, chiptune SFX toggle, more tools, swarm
   layout for many agents.

## 8. Testing

- `store.ts`: pure reducer — feed canned `AgentEvent` sequences, assert world
  state. Primary correctness coverage.
- `anthropic-agent.ts`: inject a fake streaming client; assert the emitted event
  sequence for a scripted think→tool→finish run, including a subagent spawn.
- Scene/Pixi: manual/visual verification (a recorded event log fixture can drive
  the client headless-ish for smoke checks). No pixel-diff testing in scope.

## 9. Out of scope (YAGNI)

- Multi-provider adapters (OpenAI/LangChain) — the event contract keeps the door
  open; not built now.
- Auth, multi-user, hosting — localhost dev tool only.
- Persistence / session replay UI — events could be logged, but no replay
  browser in scope.
- Real art packs, sound design beyond a simple chiptune toggle.
- Editing/approving tool calls from the UI (human-in-the-loop) — view-only.
