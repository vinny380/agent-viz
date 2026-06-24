# Agent Quest Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A localhost dev tool that runs a real Claude (Opus 4.8) ReAct loop in a Node runner and renders it — agents and subagents — as a 90s-RPG party of pixel characters in a PixiJS arena, driven live over a WebSocket.

**Architecture:** A Node **runner** holds the API key, runs the agent loop, executes tools, and emits a normalized `AgentEvent` stream over a WebSocket. A static Vite/PixiJS **client** reduces those events into a pure world-state store and renders the arena. The two share one `AgentEvent` type contract, so the client never knows about Anthropic and the runner never knows about Pixi.

**Tech Stack:** TypeScript, Vite, PixiJS v8 + pixi-filters (CRT), `@anthropic-ai/sdk`, `ws`, Vitest, tsx, dotenv.

## Global Constraints

- Model: `claude-opus-4-8` (exact string, no date suffix).
- Thinking: `thinking: { type: "adaptive", display: "summarized" }` — `display: "summarized"` is mandatory (Opus 4.8 omits thinking text by default).
- Effort: `output_config: { effort: "high" }`.
- Agent loop is a **manual** loop (not the SDK auto tool-runner) so every tool call is intercepted.
- `ANTHROPIC_API_KEY` lives only in the runner's environment; the browser never receives it.
- WebSocket server binds to `127.0.0.1` only.
- Streaming via `client.messages.stream(...)`; never raw-string-match tool input — always use the parsed `.input`.
- All test/runtime code is ESM TypeScript (`"type": "module"`).
- Ports: Vite client `5173`, runner WebSocket `8787`. Client connects to `ws://localhost:8787`.

---

### Task 1: Project scaffold

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `vitest.config.ts`, `index.html`, `.env.example`, `.gitignore`, `src/smoke.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: a working `npm test` (Vitest) and `npm run dev` (Vite + runner) toolchain. No app code yet.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "agent-quest",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "concurrently -n client,server -c blue,green \"npm:dev:client\" \"npm:dev:server\"",
    "dev:client": "vite",
    "dev:server": "tsx watch src/runner/server.ts",
    "build": "tsc --noEmit && vite build",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@anthropic-ai/sdk": "^0.70.0",
    "dotenv": "^16.4.5",
    "pixi-filters": "^6.0.0",
    "pixi.js": "^8.6.0",
    "ws": "^8.18.0"
  },
  "devDependencies": {
    "@types/ws": "^8.5.13",
    "concurrently": "^9.1.0",
    "tsx": "^4.19.0",
    "typescript": "^5.7.0",
    "vite": "^6.0.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "skipLibCheck": true,
    "types": ["vitest/globals"],
    "verbatimModuleSyntax": false,
    "isolatedModules": true,
    "noEmit": true
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create `vite.config.ts`, `vitest.config.ts`, `index.html`, `.env.example`, `.gitignore`**

`vite.config.ts`:
```ts
import { defineConfig } from "vite";

export default defineConfig({
  server: { port: 5173 },
});
```

`vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { globals: true, environment: "node" },
});
```

`index.html`:
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>AGENT QUEST</title>
    <style>
      html, body { margin: 0; background: #05030a; height: 100%; overflow: hidden; }
      #app { width: 100vw; height: 100vh; }
    </style>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/client/main.ts"></script>
  </body>
</html>
```

`.env.example`:
```
ANTHROPIC_API_KEY=sk-ant-your-key-here
```

`.gitignore`:
```
node_modules
dist
.env
.context
```

- [ ] **Step 4: Write the smoke test** — `src/smoke.test.ts`

```ts
import { describe, it, expect } from "vitest";

describe("toolchain", () => {
  it("runs vitest", () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 5: Install and run the smoke test**

Run: `npm install && npm test`
Expected: PASS (1 test passed).

- [ ] **Step 6: Commit**

```bash
git add package.json tsconfig.json vite.config.ts vitest.config.ts index.html .env.example .gitignore src/smoke.test.ts package-lock.json
git commit -m "chore: scaffold agent-quest toolchain"
```

---

### Task 2: The event contract (`shared/events.ts`)

**Files:**
- Create: `src/shared/events.ts`
- Test: `src/shared/events.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `AgentRole = "orchestrator" | "subagent"`
  - The `AgentEvent` discriminated union (see code) with discriminant `type` and common fields `seq: number; ts: number; agentId: string`.
  - `AgentEventInput = DistributiveOmit<AgentEvent, "seq" | "ts">` — what producers emit before stamping.
  - `ClientMessage = { type: "start_run"; prompt: string }` — the only client→server message.
  - `isAgentEvent(value: unknown): value is AgentEvent`.

- [ ] **Step 1: Write the failing test** — `src/shared/events.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { isAgentEvent } from "./events";

describe("isAgentEvent", () => {
  it("accepts a well-formed event", () => {
    expect(isAgentEvent({ type: "thinking_delta", seq: 1, ts: 0, agentId: "a", text: "hi" })).toBe(true);
  });
  it("rejects an unknown type", () => {
    expect(isAgentEvent({ type: "nope", seq: 1, ts: 0, agentId: "a" })).toBe(false);
  });
  it("rejects non-objects", () => {
    expect(isAgentEvent(null)).toBe(false);
    expect(isAgentEvent("x")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/shared/events.test.ts`
Expected: FAIL ("Failed to resolve import './events'").

- [ ] **Step 3: Write `src/shared/events.ts`**

```ts
export type AgentRole = "orchestrator" | "subagent";

interface Base {
  seq: number;
  ts: number;
  agentId: string;
}

export interface RunStarted extends Base { type: "run_started"; rootAgentId: string; prompt: string; }
export interface AgentSpawned extends Base { type: "agent_spawned"; parentId: string | null; role: AgentRole; label: string; }
export interface LoopStepStarted extends Base { type: "loop_step_started"; step: number; }
export interface ThinkingStarted extends Base { type: "thinking_started"; }
export interface ThinkingDelta extends Base { type: "thinking_delta"; text: string; }
export interface ThinkingStopped extends Base { type: "thinking_stopped"; }
export interface MessageDelta extends Base { type: "message_delta"; text: string; }
export interface ToolCallStarted extends Base { type: "tool_call_started"; toolCallId: string; name: string; input: unknown; }
export interface ToolCallResult extends Base { type: "tool_call_result"; toolCallId: string; ok: boolean; preview: string; }
export interface AgentFinished extends Base { type: "agent_finished"; finalText: string; }
export interface RunFinished extends Base { type: "run_finished"; rootAgentId: string; }
export interface ErrorEvent extends Base { type: "error"; message: string; }

export type AgentEvent =
  | RunStarted | AgentSpawned | LoopStepStarted
  | ThinkingStarted | ThinkingDelta | ThinkingStopped
  | MessageDelta | ToolCallStarted | ToolCallResult
  | AgentFinished | RunFinished | ErrorEvent;

type DistributiveOmit<T, K extends keyof any> = T extends unknown ? Omit<T, K> : never;
export type AgentEventInput = DistributiveOmit<AgentEvent, "seq" | "ts">;

export type ClientMessage = { type: "start_run"; prompt: string };

export const AGENT_EVENT_TYPES: ReadonlySet<string> = new Set([
  "run_started", "agent_spawned", "loop_step_started",
  "thinking_started", "thinking_delta", "thinking_stopped",
  "message_delta", "tool_call_started", "tool_call_result",
  "agent_finished", "run_finished", "error",
]);

export function isAgentEvent(value: unknown): value is AgentEvent {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.type === "string"
    && AGENT_EVENT_TYPES.has(v.type)
    && typeof v.seq === "number"
    && typeof v.ts === "number"
    && typeof v.agentId === "string";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/shared/events.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/shared/events.ts src/shared/events.test.ts
git commit -m "feat: add AgentEvent contract"
```

---

### Task 3: World-state reducer (`client/store.ts`)

**Files:**
- Create: `src/client/store.ts`
- Test: `src/client/store.test.ts`

**Interfaces:**
- Consumes: `AgentEvent`, `AgentRole` from `../shared/events`.
- Produces:
  - `Phase = "idle" | "thinking" | "acting" | "observing" | "finished" | "error"`
  - `ToolCallState = { toolCallId: string; name: string; input: unknown; status: "pending" | "ok" | "error"; preview?: string }`
  - `AgentState = { agentId; parentId: string | null; role: AgentRole; label: string; phase: Phase; step: number; thinkingText: string; messageText: string; currentTool?: ToolCallState; toolHistory: ToolCallState[]; finalText?: string; error?: string }`
  - `WorldState = { rootAgentId: string | null; prompt: string | null; agents: Record<string, AgentState>; lastSeq: number; status: "idle" | "running" | "finished" }`
  - `initialWorld(): WorldState`
  - `reduce(state: WorldState, event: AgentEvent): WorldState` (pure; returns a new state)

- [ ] **Step 1: Write the failing test** — `src/client/store.test.ts`

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/client/store.test.ts`
Expected: FAIL ("Failed to resolve import './store'").

- [ ] **Step 3: Write `src/client/store.ts`**

```ts
import type { AgentEvent, AgentRole } from "../shared/events";

export type Phase = "idle" | "thinking" | "acting" | "observing" | "finished" | "error";

export interface ToolCallState {
  toolCallId: string;
  name: string;
  input: unknown;
  status: "pending" | "ok" | "error";
  preview?: string;
}

export interface AgentState {
  agentId: string;
  parentId: string | null;
  role: AgentRole;
  label: string;
  phase: Phase;
  step: number;
  thinkingText: string;
  messageText: string;
  currentTool?: ToolCallState;
  toolHistory: ToolCallState[];
  finalText?: string;
  error?: string;
}

export interface WorldState {
  rootAgentId: string | null;
  prompt: string | null;
  agents: Record<string, AgentState>;
  lastSeq: number;
  status: "idle" | "running" | "finished";
}

export function initialWorld(): WorldState {
  return { rootAgentId: null, prompt: null, agents: {}, lastSeq: 0, status: "idle" };
}

function newAgent(agentId: string, parentId: string | null, role: AgentRole, label: string): AgentState {
  return {
    agentId, parentId, role, label,
    phase: "idle", step: 0, thinkingText: "", messageText: "",
    currentTool: undefined, toolHistory: [], finalText: undefined, error: undefined,
  };
}

/** Returns a new WorldState with `agentId` updated by `fn`. No-op if the agent is unknown. */
function withAgent(state: WorldState, agentId: string, fn: (a: AgentState) => AgentState): WorldState {
  const existing = state.agents[agentId];
  if (!existing) return state;
  return { ...state, agents: { ...state.agents, [agentId]: fn(existing) } };
}

export function reduce(state: WorldState, event: AgentEvent): WorldState {
  const next: WorldState = { ...state, lastSeq: event.seq };

  switch (event.type) {
    case "run_started":
      return { ...next, status: "running", rootAgentId: event.rootAgentId, prompt: event.prompt };

    case "agent_spawned":
      return {
        ...next,
        agents: {
          ...next.agents,
          [event.agentId]: newAgent(event.agentId, event.parentId, event.role, event.label),
        },
      };

    case "loop_step_started":
      return withAgent(next, event.agentId, (a) => ({ ...a, step: event.step, thinkingText: "" }));

    case "thinking_started":
      return withAgent(next, event.agentId, (a) => ({ ...a, phase: "thinking", thinkingText: "" }));

    case "thinking_delta":
      return withAgent(next, event.agentId, (a) => ({ ...a, thinkingText: a.thinkingText + event.text }));

    case "thinking_stopped":
      return next;

    case "message_delta":
      return withAgent(next, event.agentId, (a) => ({ ...a, messageText: a.messageText + event.text }));

    case "tool_call_started":
      return withAgent(next, event.agentId, (a) => ({
        ...a,
        phase: "acting",
        currentTool: { toolCallId: event.toolCallId, name: event.name, input: event.input, status: "pending" },
      }));

    case "tool_call_result":
      return withAgent(next, event.agentId, (a) => {
        const resolved: ToolCallState = {
          toolCallId: event.toolCallId,
          name: a.currentTool?.name ?? "tool",
          input: a.currentTool?.input,
          status: event.ok ? "ok" : "error",
          preview: event.preview,
        };
        return { ...a, phase: "observing", currentTool: resolved, toolHistory: [...a.toolHistory, resolved] };
      });

    case "agent_finished":
      return withAgent(next, event.agentId, (a) => ({ ...a, phase: "finished", finalText: event.finalText }));

    case "run_finished":
      return { ...next, status: "finished" };

    case "error":
      return withAgent(next, event.agentId, (a) => ({ ...a, phase: "error", error: event.message }));
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/client/store.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/client/store.ts src/client/store.test.ts
git commit -m "feat: add world-state reducer"
```

---

### Task 4: Model client abstraction (`runner/model.ts`)

**Files:**
- Create: `src/runner/model.ts`

**Interfaces:**
- Consumes: `@anthropic-ai/sdk`.
- Produces:
  - `ModelMessage = { role: "user" | "assistant"; content: unknown }`
  - `ModelToolDef = { name: string; description: string; input_schema: Record<string, unknown> }`
  - `ModelTurnInput = { system: string; messages: ModelMessage[]; tools: ModelToolDef[] }`
  - `NormalizedToolUse = { id: string; name: string; input: unknown }`
  - `ModelStreamEvent` union: `{ type: "thinking_start" }`, `{ type: "thinking_delta"; text }`, `{ type: "thinking_stop" }`, `{ type: "text_delta"; text }`, `{ type: "done"; stopReason: string; assistantContent: unknown; text: string; toolUses: NormalizedToolUse[] }`
  - `ModelClient = { stream(input: ModelTurnInput): AsyncIterable<ModelStreamEvent> }`
  - `createAnthropicModelClient(apiKey: string): ModelClient`

- [ ] **Step 1: Write `src/runner/model.ts`**

> This adapter is verified end-to-end in Task 7 (manual run with a real key). It is intentionally thin: it normalizes the SDK's streaming surface into `ModelStreamEvent` so the agent loop (Task 6) is testable with a scripted fake.

```ts
import Anthropic from "@anthropic-ai/sdk";

export interface ModelMessage { role: "user" | "assistant"; content: unknown; }
export interface ModelToolDef { name: string; description: string; input_schema: Record<string, unknown>; }
export interface ModelTurnInput { system: string; messages: ModelMessage[]; tools: ModelToolDef[]; }
export interface NormalizedToolUse { id: string; name: string; input: unknown; }

export type ModelStreamEvent =
  | { type: "thinking_start" }
  | { type: "thinking_delta"; text: string }
  | { type: "thinking_stop" }
  | { type: "text_delta"; text: string }
  | { type: "done"; stopReason: string; assistantContent: unknown; text: string; toolUses: NormalizedToolUse[] };

export interface ModelClient {
  stream(input: ModelTurnInput): AsyncIterable<ModelStreamEvent>;
}

export function createAnthropicModelClient(apiKey: string): ModelClient {
  const client = new Anthropic({ apiKey });

  return {
    async *stream(input: ModelTurnInput): AsyncIterable<ModelStreamEvent> {
      // newer params (thinking.display, output_config) may outpace the SDK's
      // published types; build the object and cast once.
      const params = {
        model: "claude-opus-4-8",
        max_tokens: 16000,
        thinking: { type: "adaptive", display: "summarized" },
        output_config: { effort: "high" },
        system: input.system,
        tools: input.tools,
        messages: input.messages as Anthropic.MessageParam[],
      } as unknown as Anthropic.MessageStreamParams;

      const stream = client.messages.stream(params);
      const blockTypeByIndex = new Map<number, string>();

      for await (const ev of stream) {
        if (ev.type === "content_block_start") {
          blockTypeByIndex.set(ev.index, ev.content_block.type);
          if (ev.content_block.type === "thinking") yield { type: "thinking_start" };
        } else if (ev.type === "content_block_delta") {
          if (ev.delta.type === "thinking_delta") yield { type: "thinking_delta", text: ev.delta.thinking };
          else if (ev.delta.type === "text_delta") yield { type: "text_delta", text: ev.delta.text };
        } else if (ev.type === "content_block_stop") {
          if (blockTypeByIndex.get(ev.index) === "thinking") yield { type: "thinking_stop" };
        }
      }

      const final = await stream.finalMessage();
      const text = final.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("");
      const toolUses: NormalizedToolUse[] = final.content
        .filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use")
        .map((b) => ({ id: b.id, name: b.name, input: b.input }));

      yield {
        type: "done",
        stopReason: final.stop_reason ?? "end_turn",
        assistantContent: final.content,
        text,
        toolUses,
      };
    },
  };
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors. (If the SDK flags `thinking.display`/`output_config`, the `as unknown as ...` cast already absorbs it.)

- [ ] **Step 3: Commit**

```bash
git add src/runner/model.ts
git commit -m "feat: add Anthropic model client adapter"
```

---

### Task 5: Tools (`runner/tools.ts`)

**Files:**
- Create: `src/runner/tools.ts`
- Test: `src/runner/tools.test.ts`

**Interfaces:**
- Consumes: `ModelToolDef` from `./model`; Node `fs`, `path`.
- Produces:
  - `ToolOutcome = { ok: boolean; preview: string; resultForModel: string }`
  - `ToolContext = { sandboxDir: string; spawn: (task: string, role: string) => Promise<string> }`
  - `ToolExecutor = (input: any, ctx: ToolContext) => Promise<ToolOutcome>`
  - `ToolRegistry = { defs: ModelToolDef[]; execute(name: string, input: unknown, ctx: ToolContext): Promise<ToolOutcome> }`
  - `createToolRegistry(): ToolRegistry` — registers `calculate`, `list_files`, `read_file`. (`spawn_subagent` is added in Task 7.)
- Note: `spawn` is unused until Task 7 but is part of `ToolContext` now so the type is stable.

- [ ] **Step 1: Write the failing test** — `src/runner/tools.test.ts`

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createToolRegistry, type ToolContext } from "./tools";

let dir: string;
let ctx: ToolContext;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "aq-"));
  writeFileSync(join(dir, "hello.txt"), "world");
  ctx = { sandboxDir: dir, spawn: async () => "unused" };
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("tool registry", () => {
  const reg = createToolRegistry();

  it("exposes tool defs with schemas", () => {
    const names = reg.defs.map((d) => d.name).sort();
    expect(names).toContain("calculate");
    expect(names).toContain("list_files");
    expect(names).toContain("read_file");
  });

  it("calculate evaluates arithmetic", async () => {
    const out = await reg.execute("calculate", { expression: "2 + 3 * 4" }, ctx);
    expect(out.ok).toBe(true);
    expect(out.resultForModel).toBe("14");
  });

  it("calculate rejects non-arithmetic input", async () => {
    const out = await reg.execute("calculate", { expression: "process.exit(1)" }, ctx);
    expect(out.ok).toBe(false);
  });

  it("list_files lists the sandbox", async () => {
    const out = await reg.execute("list_files", {}, ctx);
    expect(out.ok).toBe(true);
    expect(out.resultForModel).toContain("hello.txt");
  });

  it("read_file reads inside the sandbox", async () => {
    const out = await reg.execute("read_file", { path: "hello.txt" }, ctx);
    expect(out.ok).toBe(true);
    expect(out.resultForModel).toBe("world");
  });

  it("read_file blocks path traversal", async () => {
    const out = await reg.execute("read_file", { path: "../../etc/passwd" }, ctx);
    expect(out.ok).toBe(false);
  });

  it("reports unknown tools", async () => {
    const out = await reg.execute("nope", {}, ctx);
    expect(out.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/runner/tools.test.ts`
Expected: FAIL ("Failed to resolve import './tools'").

- [ ] **Step 3: Write `src/runner/tools.ts`**

```ts
import { readdir, readFile } from "node:fs/promises";
import { resolve, relative, isAbsolute } from "node:path";
import type { ModelToolDef } from "./model";

export interface ToolOutcome { ok: boolean; preview: string; resultForModel: string; }
export interface ToolContext {
  sandboxDir: string;
  spawn: (task: string, role: string) => Promise<string>;
}
export type ToolExecutor = (input: any, ctx: ToolContext) => Promise<ToolOutcome>;

export interface ToolRegistry {
  defs: ModelToolDef[];
  execute(name: string, input: unknown, ctx: ToolContext): Promise<ToolOutcome>;
}

function preview(s: string, n = 80): string {
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length > n ? flat.slice(0, n) + "…" : flat;
}

/** Evaluate a strict arithmetic expression: digits, + - * / ( ) . and spaces only. */
function safeArithmetic(expr: string): number {
  if (!/^[\d+\-*/().\s]+$/.test(expr)) throw new Error("only arithmetic is allowed");
  // eslint-disable-next-line no-new-func
  const value = Function(`"use strict"; return (${expr});`)();
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error("not a finite number");
  return value;
}

function resolveInSandbox(sandboxDir: string, rel: string): string {
  if (isAbsolute(rel)) throw new Error("absolute paths are not allowed");
  const abs = resolve(sandboxDir, rel);
  const r = relative(sandboxDir, abs);
  if (r.startsWith("..") || isAbsolute(r)) throw new Error("path escapes the sandbox");
  return abs;
}

const EXECUTORS: Record<string, ToolExecutor> = {
  async calculate(input) {
    try {
      const value = safeArithmetic(String(input?.expression ?? ""));
      const out = String(value);
      return { ok: true, preview: out, resultForModel: out };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, preview: `error: ${msg}`, resultForModel: `Error: ${msg}` };
    }
  },

  async list_files(_input, ctx) {
    try {
      const entries = await readdir(ctx.sandboxDir, { withFileTypes: true });
      const list = entries.map((e) => (e.isDirectory() ? `${e.name}/` : e.name)).join("\n");
      return { ok: true, preview: preview(list), resultForModel: list || "(empty)" };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, preview: `error: ${msg}`, resultForModel: `Error: ${msg}` };
    }
  },

  async read_file(input, ctx) {
    try {
      const abs = resolveInSandbox(ctx.sandboxDir, String(input?.path ?? ""));
      const text = await readFile(abs, "utf8");
      return { ok: true, preview: preview(text), resultForModel: text };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, preview: `error: ${msg}`, resultForModel: `Error: ${msg}` };
    }
  },
};

const DEFS: ModelToolDef[] = [
  {
    name: "calculate",
    description: "Evaluate an arithmetic expression (numbers and + - * / ( ) only).",
    input_schema: {
      type: "object",
      properties: { expression: { type: "string", description: "e.g. (2 + 3) * 4" } },
      required: ["expression"],
    },
  },
  {
    name: "list_files",
    description: "List files in the sandbox working directory.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "read_file",
    description: "Read a UTF-8 text file from the sandbox by relative path.",
    input_schema: {
      type: "object",
      properties: { path: { type: "string", description: "relative path inside the sandbox" } },
      required: ["path"],
    },
  },
];

export function createToolRegistry(): ToolRegistry {
  const executors = { ...EXECUTORS };
  const defs = [...DEFS];
  return {
    defs,
    async execute(name, input, ctx) {
      const exec = executors[name];
      if (!exec) return { ok: false, preview: `unknown tool: ${name}`, resultForModel: `Error: unknown tool ${name}` };
      return exec(input, ctx);
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/runner/tools.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/runner/tools.ts src/runner/tools.test.ts
git commit -m "feat: add tool registry (calculate, list_files, read_file)"
```

---

### Task 6: Agent ReAct loop (`runner/anthropic-agent.ts`)

**Files:**
- Create: `src/runner/anthropic-agent.ts`
- Test: `src/runner/anthropic-agent.test.ts`

**Interfaces:**
- Consumes: `ModelClient`, `ModelStreamEvent`, `ModelMessage` from `./model`; `ToolRegistry`, `ToolContext` from `./tools`; `AgentEventInput`, `AgentRole` from `../shared/events`.
- Produces:
  - `AgentDeps = { model: ModelClient; tools: ToolRegistry; emit: (e: AgentEventInput) => void; toolContext: ToolContext; maxSteps?: number }`
  - `RunAgentParams = { agentId: string; parentId: string | null; role: AgentRole; label: string; systemPrompt: string; userPrompt: string }`
  - `runAgent(deps: AgentDeps, params: RunAgentParams): Promise<string>` — emits `agent_spawned`, runs the loop emitting all per-step events, returns final assistant text.

- [ ] **Step 1: Write the failing test** — `src/runner/anthropic-agent.test.ts`

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/runner/anthropic-agent.test.ts`
Expected: FAIL ("Failed to resolve import './anthropic-agent'").

- [ ] **Step 3: Write `src/runner/anthropic-agent.ts`**

```ts
import type { ModelClient, ModelMessage } from "./model";
import type { ToolRegistry, ToolContext } from "./tools";
import type { AgentEventInput, AgentRole } from "../shared/events";

export interface AgentDeps {
  model: ModelClient;
  tools: ToolRegistry;
  emit: (e: AgentEventInput) => void;
  toolContext: ToolContext;
  maxSteps?: number;
}

export interface RunAgentParams {
  agentId: string;
  parentId: string | null;
  role: AgentRole;
  label: string;
  systemPrompt: string;
  userPrompt: string;
}

const DEFAULT_MAX_STEPS = 12;

export async function runAgent(deps: AgentDeps, params: RunAgentParams): Promise<string> {
  const { model, tools, emit, toolContext } = deps;
  const maxSteps = deps.maxSteps ?? DEFAULT_MAX_STEPS;
  const { agentId } = params;

  emit({ type: "agent_spawned", agentId, parentId: params.parentId, role: params.role, label: params.label });

  const messages: ModelMessage[] = [{ role: "user", content: params.userPrompt }];
  let finalText = "";

  for (let step = 1; step <= maxSteps; step++) {
    emit({ type: "loop_step_started", agentId, step });

    let assistantContent: unknown = [];
    let toolUses: { id: string; name: string; input: unknown }[] = [];
    let stopReason = "end_turn";
    let stepText = "";

    for await (const ev of model.stream({ system: params.systemPrompt, messages, tools: tools.defs })) {
      switch (ev.type) {
        case "thinking_start": emit({ type: "thinking_started", agentId }); break;
        case "thinking_delta": emit({ type: "thinking_delta", agentId, text: ev.text }); break;
        case "thinking_stop": emit({ type: "thinking_stopped", agentId }); break;
        case "text_delta": emit({ type: "message_delta", agentId, text: ev.text }); stepText += ev.text; break;
        case "done":
          assistantContent = ev.assistantContent;
          toolUses = ev.toolUses;
          stopReason = ev.stopReason;
          if (ev.text) finalText = ev.text;
          break;
      }
    }

    if (stopReason !== "tool_use" || toolUses.length === 0) {
      if (!finalText) finalText = stepText;
      break;
    }

    // Intercept and execute each tool call.
    messages.push({ role: "assistant", content: assistantContent });
    const toolResults: { type: "tool_result"; tool_use_id: string; content: string }[] = [];
    for (const call of toolUses) {
      emit({ type: "tool_call_started", agentId, toolCallId: call.id, name: call.name, input: call.input });
      const outcome = await tools.execute(call.name, call.input, toolContext);
      emit({ type: "tool_call_result", agentId, toolCallId: call.id, ok: outcome.ok, preview: outcome.preview });
      toolResults.push({ type: "tool_result", tool_use_id: call.id, content: outcome.resultForModel });
    }
    messages.push({ role: "user", content: toolResults });

    if (step === maxSteps) {
      finalText = finalText || "(stopped: reached step limit)";
    }
  }

  emit({ type: "agent_finished", agentId, finalText });
  return finalText;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/runner/anthropic-agent.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/runner/anthropic-agent.ts src/runner/anthropic-agent.test.ts
git commit -m "feat: add agent ReAct loop with tool interception"
```

---

### Task 7: WebSocket runner server (`runner/server.ts`)

**Files:**
- Create: `src/runner/server.ts`, `src/runner/emitter.ts`
- Test: `src/runner/emitter.test.ts`

**Interfaces:**
- Consumes: `ws`, `dotenv`, `AgentEvent`/`AgentEventInput`/`ClientMessage` from `../shared/events`, `createAnthropicModelClient`, `createToolRegistry`, `runAgent`.
- Produces:
  - `createEmitter(sink: (e: AgentEvent) => void): (input: AgentEventInput) => void` — stamps a monotonic `seq` and `ts` onto each input and forwards to `sink`. (`emitter.ts`, unit-tested.)
  - `server.ts` — runnable entry: WS server on `127.0.0.1:8787`; on `start_run`, runs the root agent and broadcasts every event. Manually verified.

- [ ] **Step 1: Write the failing test** — `src/runner/emitter.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { createEmitter } from "./emitter";
import type { AgentEvent } from "../shared/events";

describe("createEmitter", () => {
  it("stamps incrementing seq and a numeric ts", () => {
    const out: AgentEvent[] = [];
    const emit = createEmitter((e) => out.push(e));
    emit({ type: "agent_spawned", agentId: "a", parentId: null, role: "orchestrator", label: "H" });
    emit({ type: "loop_step_started", agentId: "a", step: 1 });
    expect(out[0].seq).toBe(1);
    expect(out[1].seq).toBe(2);
    expect(typeof out[0].ts).toBe("number");
    expect(out[1].type).toBe("loop_step_started");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/runner/emitter.test.ts`
Expected: FAIL ("Failed to resolve import './emitter'").

- [ ] **Step 3: Write `src/runner/emitter.ts`**

```ts
import type { AgentEvent, AgentEventInput } from "../shared/events";

/** Stamps a monotonic seq + wall-clock ts onto each emitted input. */
export function createEmitter(sink: (e: AgentEvent) => void): (input: AgentEventInput) => void {
  let seq = 0;
  return (input: AgentEventInput) => {
    sink({ ...(input as object), seq: ++seq, ts: Date.now() } as AgentEvent);
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/runner/emitter.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Write `src/runner/server.ts`**

```ts
import "dotenv/config";
import { WebSocketServer, WebSocket } from "ws";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentEvent, ClientMessage } from "../shared/events";
import { createEmitter } from "./emitter";
import { createAnthropicModelClient } from "./model";
import { createToolRegistry } from "./tools";
import { runAgent } from "./anthropic-agent";

const PORT = 8787;
const HOST = "127.0.0.1";

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  console.error("Missing ANTHROPIC_API_KEY (set it in .env). See .env.example.");
  process.exit(1);
}

const ROOT_SYSTEM = `You are the Hero, an autonomous agent in a quest visualizer.
Think out loud, use tools when helpful, and keep working until the task is done.
You have tools: calculate, list_files, read_file. When you are finished, give a short final answer.`;

const SUBAGENT_SYSTEM = `You are a Scout, a focused subagent. Complete the single task you are given
using the available tools, then return a concise result for your commander.`;

function makeSandbox(): string {
  const dir = mkdtempSync(join(tmpdir(), "agent-quest-"));
  writeFileSync(join(dir, "README.txt"), "Welcome, hero. The treasure is in chest #7.\n");
  writeFileSync(join(dir, "notes.txt"), "Recipe: 3 + 4 gold coins per chest.\n");
  return dir;
}

const model = createAnthropicModelClient(apiKey);
const wss = new WebSocketServer({ host: HOST, port: PORT });
console.log(`Agent Quest runner listening on ws://${HOST}:${PORT}`);

let runSeq = 0;

wss.on("connection", (socket: WebSocket) => {
  socket.on("message", async (raw) => {
    let msg: ClientMessage;
    try { msg = JSON.parse(raw.toString()) as ClientMessage; } catch { return; }
    if (msg.type !== "start_run" || typeof msg.prompt !== "string") return;

    const send = (e: AgentEvent) => { if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(e)); };
    const emit = createEmitter(send);
    const tools = createToolRegistry();
    const sandboxDir = makeSandbox();

    let childCounter = 0;
    const rootId = `agent-${++runSeq}-root`;

    // spawn lets a parent recurse into a fresh subagent loop.
    const toolContext = {
      sandboxDir,
      spawn: async (task: string, role: string) => {
        const childId = `${rootId}-sub-${++childCounter}`;
        return runAgent(
          { model, tools, emit, toolContext },
          { agentId: childId, parentId: rootId, role: "subagent", label: role.toUpperCase().slice(0, 12), systemPrompt: SUBAGENT_SYSTEM, userPrompt: task },
        );
      },
    };

    emit({ type: "run_started", agentId: rootId, rootAgentId: rootId, prompt: msg.prompt });
    try {
      await runAgent(
        { model, tools, emit, toolContext },
        { agentId: rootId, parentId: null, role: "orchestrator", label: "HERO", systemPrompt: ROOT_SYSTEM, userPrompt: msg.prompt },
      );
    } catch (e) {
      emit({ type: "error", agentId: rootId, message: e instanceof Error ? e.message : String(e) });
    }
    emit({ type: "run_finished", agentId: rootId, rootAgentId: rootId });
  });
});
```

> `toolContext` references `model`/`tools`/`emit`; `spawn_subagent` wiring into the registry happens in Task 9. For now `spawn` exists but no tool calls it.

- [ ] **Step 6: Manual verification**

Run (in one terminal): `cp .env.example .env` then put a real key in `.env`, then `npm run dev:server`
Expected: logs `Agent Quest runner listening on ws://127.0.0.1:8787`.
Then in a second terminal, smoke the socket:
```bash
npx --yes wscat -c ws://127.0.0.1:8787 -x '{"type":"start_run","prompt":"What is 21 * 2? Use the calculator."}'
```
Expected: a stream of JSON lines — `run_started`, `agent_spawned`, `loop_step_started`, `thinking_*`, a `tool_call_started`/`tool_call_result` for `calculate`, then `agent_finished` and `run_finished`.

- [ ] **Step 7: Commit**

```bash
git add src/runner/server.ts src/runner/emitter.ts src/runner/emitter.test.ts
git commit -m "feat: add WebSocket runner server"
```

---

### Task 8: Client networking (`client/net.ts`)

**Files:**
- Create: `src/client/net.ts`
- Test: `src/client/net.test.ts`

**Interfaces:**
- Consumes: `AgentEvent`, `ClientMessage`, `isAgentEvent` from `../shared/events`; browser `WebSocket`.
- Produces:
  - `parseServerMessage(raw: string): AgentEvent | null` — JSON-parses and validates with `isAgentEvent`. (Pure, unit-tested.)
  - `connect(url: string, onEvent: (e: AgentEvent) => void): { startRun(prompt: string): void; close(): void }` — opens a WebSocket, routes validated events to `onEvent`. (Thin; manually verified in Task 11.)

- [ ] **Step 1: Write the failing test** — `src/client/net.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { parseServerMessage } from "./net";

describe("parseServerMessage", () => {
  it("parses a valid event", () => {
    const raw = JSON.stringify({ type: "loop_step_started", seq: 1, ts: 0, agentId: "a", step: 1 });
    expect(parseServerMessage(raw)?.type).toBe("loop_step_started");
  });
  it("returns null for invalid JSON", () => {
    expect(parseServerMessage("{not json")).toBeNull();
  });
  it("returns null for non-events", () => {
    expect(parseServerMessage(JSON.stringify({ hello: "world" }))).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/client/net.test.ts`
Expected: FAIL ("Failed to resolve import './net'").

- [ ] **Step 3: Write `src/client/net.ts`**

```ts
import { isAgentEvent, type AgentEvent, type ClientMessage } from "../shared/events";

export function parseServerMessage(raw: string): AgentEvent | null {
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return null; }
  return isAgentEvent(value) ? value : null;
}

export function connect(url: string, onEvent: (e: AgentEvent) => void) {
  const ws = new WebSocket(url);
  ws.addEventListener("message", (m: MessageEvent) => {
    const event = parseServerMessage(String(m.data));
    if (event) onEvent(event);
  });
  return {
    startRun(prompt: string) {
      const msg: ClientMessage = { type: "start_run", prompt };
      const fire = () => ws.send(JSON.stringify(msg));
      if (ws.readyState === WebSocket.OPEN) fire();
      else ws.addEventListener("open", fire, { once: true });
    },
    close() { ws.close(); },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/client/net.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/client/net.ts src/client/net.test.ts
git commit -m "feat: add client WebSocket networking"
```

---

### Task 9: Subagent tool (`spawn_subagent`)

**Files:**
- Modify: `src/runner/tools.ts`
- Test: `src/runner/tools-spawn.test.ts`

**Interfaces:**
- Consumes: existing `ToolContext.spawn`, `ToolExecutor`, `ToolRegistry`.
- Produces: a `spawn_subagent` entry in `createToolRegistry().defs` and `.execute`, which calls `ctx.spawn(task, role)` and returns the child's final text as `resultForModel`.

- [ ] **Step 1: Write the failing test** — `src/runner/tools-spawn.test.ts`

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/runner/tools-spawn.test.ts`
Expected: FAIL (`spawn_subagent` not found / unknown tool).

- [ ] **Step 3: Modify `src/runner/tools.ts`** — add the executor and def

Add this executor inside the `EXECUTORS` object (after `read_file`):
```ts
  async spawn_subagent(input, ctx) {
    try {
      const task = String(input?.task ?? "");
      const role = String(input?.role ?? "scout");
      if (!task) throw new Error("task is required");
      const result = await ctx.spawn(task, role);
      return { ok: true, preview: preview(result), resultForModel: result };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, preview: `error: ${msg}`, resultForModel: `Error: ${msg}` };
    }
  },
```

Add this def to the `DEFS` array (after `read_file`):
```ts
  {
    name: "spawn_subagent",
    description: "Delegate a focused subtask to a new subagent. Use for independent or parallelizable work. Returns the subagent's final report.",
    input_schema: {
      type: "object",
      properties: {
        task: { type: "string", description: "the subtask for the subagent to complete" },
        role: { type: "string", description: "short label for the subagent, e.g. 'scout' or 'mathematician'" },
      },
      required: ["task"],
    },
  },
```

- [ ] **Step 4: Run all runner tests to verify they pass**

Run: `npx vitest run src/runner/`
Expected: PASS (tools, tools-spawn, anthropic-agent, emitter all green).

- [ ] **Step 5: Commit**

```bash
git add src/runner/tools.ts src/runner/tools-spawn.test.ts
git commit -m "feat: add spawn_subagent tool"
```

---

### Task 10: Procedural pixel sprites (`client/sprite-data.ts`)

**Files:**
- Create: `src/client/sprite-data.ts`
- Test: `src/client/sprite-data.test.ts`

**Interfaces:**
- Consumes: nothing (pure).
- Produces:
  - `PALETTES: readonly string[][]` — palette index 0 is always transparent (`"transparent"`).
  - `spriteMatrix(agentId: string): number[][]` — deterministic 16×16 matrix of palette indices derived from the id.
  - `paletteFor(agentId: string): string[]` — deterministic palette choice for the id.
  - These are pure so they're testable without Pixi; `sprites.ts` (Task 11) turns them into textures.

- [ ] **Step 1: Write the failing test** — `src/client/sprite-data.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { spriteMatrix, paletteFor } from "./sprite-data";

describe("sprite-data", () => {
  it("produces a 16x16 matrix", () => {
    const m = spriteMatrix("agent-1");
    expect(m).toHaveLength(16);
    for (const row of m) expect(row).toHaveLength(16);
  });
  it("is deterministic per id", () => {
    expect(spriteMatrix("agent-1")).toEqual(spriteMatrix("agent-1"));
    expect(paletteFor("agent-1")).toEqual(paletteFor("agent-1"));
  });
  it("differs across ids", () => {
    expect(spriteMatrix("agent-1")).not.toEqual(spriteMatrix("agent-2"));
  });
  it("is left-right symmetric (character faces forward)", () => {
    const m = spriteMatrix("agent-7");
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 8; x++)
        expect(m[y][x]).toBe(m[y][15 - x]);
  });
  it("only uses valid palette indices", () => {
    const pal = paletteFor("agent-3");
    for (const row of spriteMatrix("agent-3"))
      for (const idx of row) expect(idx).toBeLessThan(pal.length);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/client/sprite-data.test.ts`
Expected: FAIL ("Failed to resolve import './sprite-data'").

- [ ] **Step 3: Write `src/client/sprite-data.ts`**

```ts
// Palette index 0 is always transparent. Indices 1..3 are body/accent/eye colors.
export const PALETTES: readonly string[][] = [
  ["transparent", "#48c9b0", "#1f6f63", "#0a0f12"], // teal robot
  ["transparent", "#e74c3c", "#7d241a", "#0a0f12"], // red knight
  ["transparent", "#9b59b6", "#5b2c6f", "#0a0f12"], // purple mage
  ["transparent", "#f1c40f", "#9a7d0a", "#0a0f12"], // gold rogue
  ["transparent", "#5dade2", "#21618c", "#0a0f12"], // blue scout
];

/** Cheap deterministic hash → 32-bit unsigned. */
function hash(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/** Seeded PRNG (mulberry32). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function paletteFor(agentId: string): string[] {
  return PALETTES[hash(agentId) % PALETTES.length]!.slice();
}

/**
 * 16x16 left-right-symmetric character: a chunky head/torso/legs silhouette
 * with body(1)/accent(2)/eye(3) pixels. Deterministic from the id.
 */
export function spriteMatrix(agentId: string): number[][] {
  const rand = rng(hash(agentId) ^ 0x9e3779b9);
  const m: number[][] = Array.from({ length: 16 }, () => new Array<number>(16).fill(0));

  const set = (x: number, y: number, v: number) => {
    if (y < 0 || y > 15 || x < 0 || x > 15) return;
    m[y]![x] = v;
    m[y]![15 - x] = v; // mirror
  };

  // Head (rows 2-6, cols 4-7 mirrored to 8-11)
  for (let y = 2; y <= 6; y++) for (let x = 4; x <= 7; x++) set(x, y, 1);
  // Eyes
  set(5, 4, 3);
  // Torso (rows 7-11, cols 3-7)
  for (let y = 7; y <= 11; y++) for (let x = 3; x <= 7; x++) set(x, y, 1);
  // Accent stripe / detail, randomized per agent
  const stripeRow = 8 + Math.floor(rand() * 3);
  for (let x = 3; x <= 7; x++) set(x, stripeRow, 2);
  // Random shoulder accent
  if (rand() > 0.5) { set(3, 7, 2); }
  // Legs (rows 12-14, cols 4-5 and mirrored)
  for (let y = 12; y <= 14; y++) { set(4, y, 1); set(5, y, 1); }

  return m;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/client/sprite-data.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/client/sprite-data.ts src/client/sprite-data.test.ts
git commit -m "feat: add procedural pixel sprite generation"
```

---

### Task 11: Scene rendering + wiring (`client/sprites.ts`, `client/scene.ts`, `client/main.ts`)

**Files:**
- Create: `src/client/sprites.ts`, `src/client/scene.ts`, `src/client/main.ts`

**Interfaces:**
- Consumes: PixiJS v8, `pixi-filters`, `sprite-data`, `store` (`WorldState`, `AgentState`, `Phase`, `initialWorld`, `reduce`), `net` (`connect`), `events`.
- Produces:
  - `sprites.ts`: `makeSpriteTexture(app: Application, agentId: string): Texture` — renders a `spriteMatrix` to a nearest-neighbor texture.
  - `scene.ts`: `class Scene { constructor(app: Application); render(world: WorldState): void }` — draws all agents as characters (sprite, label, step counter, loop gauge, phase tint, thought bubble text, current tool label, parent→child tethers) and applies the CRT filter.
  - `main.ts`: bootstraps the Pixi app, the store, the net connection, the prompt input, and the render loop.
- Verification is visual (this is the money shot). No unit tests.

- [ ] **Step 1: Write `src/client/sprites.ts`**

```ts
import { Application, Graphics, Texture } from "pixi.js";
import { spriteMatrix, paletteFor } from "./sprite-data";

const CELL = 6; // each sprite pixel → 6 screen px before scene scaling

export function makeSpriteTexture(app: Application, agentId: string): Texture {
  const matrix = spriteMatrix(agentId);
  const palette = paletteFor(agentId);
  const g = new Graphics();
  for (let y = 0; y < matrix.length; y++) {
    for (let x = 0; x < matrix[y]!.length; x++) {
      const idx = matrix[y]![x]!;
      if (idx === 0) continue; // transparent
      g.rect(x * CELL, y * CELL, CELL, CELL).fill(palette[idx]!);
    }
  }
  const texture = app.renderer.generateTexture(g);
  texture.source.scaleMode = "nearest";
  g.destroy();
  return texture;
}
```

- [ ] **Step 2: Write `src/client/scene.ts`**

```ts
import { Application, Container, Graphics, Sprite, Text, type Texture } from "pixi.js";
import { CRTFilter } from "pixi-filters";
import { makeSpriteTexture } from "./sprites";
import type { WorldState, AgentState, Phase } from "./store";

const PHASE_COLOR: Record<Phase, number> = {
  idle: 0x6b7280,
  thinking: 0x9b59b6,
  acting: 0x48c9b0,
  observing: 0xf1c40f,
  finished: 0x2ecc71,
  error: 0xe74c3c,
};
const PHASE_LABEL: Record<Phase, string> = {
  idle: "IDLE", thinking: "THINK", acting: "ACT", observing: "OBSERVE", finished: "DONE", error: "ERROR",
};

const FONT = { fontFamily: "monospace", fill: 0xffffff } as const;

interface CharView {
  root: Container;
  sprite: Sprite;
  nameText: Text;
  phaseText: Text;
  stepText: Text;
  bubble: Container;
  bubbleText: Text;
  gauge: Graphics;
  ring: Graphics;
}

export class Scene {
  private app: Application;
  private world: Container;
  private tethers: Graphics;
  private views = new Map<string, CharView>();
  private textures = new Map<string, Texture>();
  private tick = 0;

  constructor(app: Application) {
    this.app = app;
    this.world = new Container();
    this.tethers = new Graphics();
    this.world.addChild(this.tethers);
    app.stage.addChild(this.world);

    // 90s CRT vibe
    app.stage.filters = [new CRTFilter({ curvature: 6, lineWidth: 2, lineContrast: 0.35, vignetting: 0.3, noise: 0.08 })];

    this.drawBackdrop();
    app.ticker.add(() => { this.tick += 1; this.animate(); });
  }

  private drawBackdrop() {
    const bg = new Graphics();
    const w = this.app.renderer.width, h = this.app.renderer.height;
    bg.rect(0, 0, w, h).fill(0x0a0f1c);
    const grid = 32;
    for (let x = 0; x <= w; x += grid) bg.rect(x, 0, 1, h).fill({ color: 0x14306b, alpha: 0.35 });
    for (let y = 0; y <= h; y += grid) bg.rect(0, y, w, 1).fill({ color: 0x14306b, alpha: 0.35 });
    this.world.addChildAt(bg, 0);
  }

  /** Lay agents out: root centered, children fanned beneath their parent. */
  private layout(world: WorldState): Map<string, { x: number; y: number }> {
    const pos = new Map<string, { x: number; y: number }>();
    const w = this.app.renderer.width, h = this.app.renderer.height;
    const roots = Object.values(world.agents).filter((a) => a.parentId === null);
    roots.forEach((r, i) => {
      pos.set(r.agentId, { x: w / 2, y: h / 2 - 60 + i * 20 });
      const kids = Object.values(world.agents).filter((a) => a.parentId === r.agentId);
      kids.forEach((k, j) => {
        const spread = (j - (kids.length - 1) / 2) * 220;
        pos.set(k.agentId, { x: w / 2 + spread, y: h / 2 + 150 });
      });
    });
    // any deeper descendants: stack below their parent if known
    for (const a of Object.values(world.agents)) {
      if (!pos.has(a.agentId) && a.parentId && pos.has(a.parentId)) {
        const p = pos.get(a.parentId)!;
        pos.set(a.agentId, { x: p.x, y: p.y + 160 });
      }
    }
    return pos;
  }

  private ensureView(agent: AgentState): CharView {
    let v = this.views.get(agent.agentId);
    if (v) return v;

    if (!this.textures.has(agent.agentId)) this.textures.set(agent.agentId, makeSpriteTexture(this.app, agent.agentId));
    const root = new Container();

    const sprite = new Sprite(this.textures.get(agent.agentId)!);
    sprite.anchor.set(0.5, 1);
    sprite.scale.set(2);

    const ring = new Graphics();
    const gauge = new Graphics();

    const nameText = new Text({ text: agent.label, style: { ...FONT, fontSize: 14, fontWeight: "bold" } });
    nameText.anchor.set(0.5, 1);
    nameText.y = -120;

    const phaseText = new Text({ text: "", style: { ...FONT, fontSize: 11 } });
    phaseText.anchor.set(0.5, 0);
    phaseText.y = 8;

    const stepText = new Text({ text: "", style: { ...FONT, fontSize: 10, fill: 0x9bd0ff } });
    stepText.anchor.set(0.5, 0);
    stepText.y = 22;

    const bubble = new Container();
    const bubbleBg = new Graphics();
    bubble.addChild(bubbleBg);
    const bubbleText = new Text({ text: "", style: { ...FONT, fontSize: 11, wordWrap: true, wordWrapWidth: 200, fill: 0x101418 } });
    bubbleText.x = 8; bubbleText.y = 6;
    bubble.addChild(bubbleText);
    bubble.x = 24; bubble.y = -150;
    bubble.visible = false;
    (bubble as any).__bg = bubbleBg;

    root.addChild(ring, gauge, sprite, nameText, phaseText, stepText, bubble);
    this.world.addChild(root);

    v = { root, sprite, nameText, phaseText, stepText, bubble, bubbleText, gauge, ring };
    this.views.set(agent.agentId, v);
    return v;
  }

  render(world: WorldState) {
    const pos = this.layout(world);

    // tethers parent → child
    this.tethers.clear();
    for (const a of Object.values(world.agents)) {
      if (a.parentId && pos.has(a.parentId) && pos.has(a.agentId)) {
        const p = pos.get(a.parentId)!, c = pos.get(a.agentId)!;
        this.tethers.moveTo(p.x, p.y).lineTo(c.x, c.y).stroke({ color: 0x48c9b0, width: 2, alpha: 0.5 });
      }
    }

    for (const agent of Object.values(world.agents)) {
      const v = this.ensureView(agent);
      const p = pos.get(agent.agentId) ?? { x: 100, y: 100 };
      v.root.x = p.x; v.root.y = p.y;

      const color = PHASE_COLOR[agent.phase];
      v.sprite.tint = agent.phase === "idle" ? 0x8899aa : 0xffffff;

      // phase ring
      v.ring.clear();
      v.ring.circle(0, -40, 46).stroke({ color, width: 3, alpha: 0.8 });

      v.phaseText.text = PHASE_LABEL[agent.phase];
      v.phaseText.style.fill = color;
      v.stepText.text = agent.step > 0 ? `STEP ${agent.step}` : "";

      // bubble shows live thinking, else current tool, else final text
      let bubbleStr = "";
      if (agent.phase === "thinking" && agent.thinkingText) bubbleStr = agent.thinkingText.slice(-180);
      else if (agent.phase === "acting" && agent.currentTool) bubbleStr = `⚙ ${agent.currentTool.name}(${preview(agent.currentTool.input)})`;
      else if (agent.phase === "observing" && agent.currentTool) bubbleStr = `← ${agent.currentTool.preview ?? ""}`;
      else if (agent.phase === "finished" && agent.finalText) bubbleStr = agent.finalText.slice(0, 180);
      else if (agent.phase === "error" && agent.error) bubbleStr = `✖ ${agent.error}`;

      v.bubble.visible = bubbleStr.length > 0;
      if (v.bubble.visible) {
        v.bubbleText.text = bubbleStr;
        const bg = (v.bubble as any).__bg as Graphics;
        const w = Math.min(216, Math.max(80, v.bubbleText.width + 16));
        const h = v.bubbleText.height + 12;
        bg.clear();
        bg.roundRect(0, 0, w, h, 6).fill({ color: 0xeef6ff, alpha: 0.95 }).stroke({ color, width: 2 });
      }
    }

    // drop views for agents no longer present (rare; runs are additive)
    for (const id of [...this.views.keys()]) {
      if (!world.agents[id]) { this.views.get(id)!.root.destroy({ children: true }); this.views.delete(id); }
    }
  }

  /** Per-frame loop gauge: a marker orbiting each character, one lap suggesting one ReAct step. */
  private animate() {
    for (const [id, v] of this.views) {
      const a = (this.lastWorld?.agents ?? {})[id];
      const active = a && (a.phase === "thinking" || a.phase === "acting" || a.phase === "observing");
      v.gauge.clear();
      if (!active) continue;
      const angle = (this.tick % 90) / 90 * Math.PI * 2;
      const cx = Math.cos(angle) * 46;
      const cy = -40 + Math.sin(angle) * 46;
      v.gauge.circle(cx, cy, 5).fill(PHASE_COLOR[a!.phase]);
    }
  }

  private lastWorld: WorldState | null = null;
  setWorld(world: WorldState) { this.lastWorld = world; this.render(world); }
}

function preview(input: unknown): string {
  const s = typeof input === "string" ? input : JSON.stringify(input);
  return s.length > 40 ? s.slice(0, 40) + "…" : s;
}
```

- [ ] **Step 3: Write `src/client/main.ts`**

```ts
import { Application } from "pixi.js";
import { Scene } from "./scene";
import { connect } from "./net";
import { initialWorld, reduce, type WorldState } from "./store";

const WS_URL = "ws://localhost:8787";

async function main() {
  const app = new Application();
  await app.init({ resizeTo: window, background: 0x05030a, antialias: false });
  document.getElementById("app")!.appendChild(app.canvas);

  const scene = new Scene(app);
  let world: WorldState = initialWorld();
  scene.setWorld(world);

  const net = connect(WS_URL, (event) => {
    world = reduce(world, event);
    scene.setWorld(world);
  });

  // prompt input
  const bar = document.createElement("div");
  bar.style.cssText = "position:fixed;left:0;right:0;bottom:0;display:flex;gap:8px;padding:10px;background:#0a0f1ccc;font-family:monospace;z-index:10";
  const input = document.createElement("input");
  input.placeholder = "Give the hero a quest… (e.g. 'Read README.txt and tell me where the treasure is')";
  input.style.cssText = "flex:1;padding:10px;background:#101826;color:#9bd0ff;border:2px solid #48c9b0;font-family:monospace;font-size:14px";
  const btn = document.createElement("button");
  btn.textContent = "▶ START";
  btn.style.cssText = "padding:10px 18px;background:#48c9b0;color:#04121a;border:0;font-family:monospace;font-weight:bold;cursor:pointer";
  const go = () => { if (input.value.trim()) { net.startRun(input.value.trim()); input.value = ""; } };
  btn.onclick = go;
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
  bar.append(input, btn);
  document.body.appendChild(bar);
}

main();
```

- [ ] **Step 4: Typecheck the whole project**

Run: `npx tsc --noEmit`
Expected: no errors. (PixiJS v8: `Graphics` uses `.rect().fill()`, `.circle().stroke()`, `.roundRect()`; `Text` takes `{ text, style }`; `app.canvas` is the DOM element; `app.renderer.generateTexture` exists.)

- [ ] **Step 5: Manual end-to-end verification (the money shot)**

In two terminals (or `npm run dev`):
1. `npm run dev:server` (with a real key in `.env`)
2. `npm run dev:client`, open `http://localhost:5173`

Type: `Read README.txt and notes.txt, then calculate the total gold for 7 chests.`
Expected: the HERO sprite appears on the CRT arena; thought bubble streams reasoning; it casts `read_file` / `calculate` (ACT → OBSERVE), step counter ticks, loop gauge orbits; ends in DONE with a final answer bubble.

Then type: `Send a scout to read notes.txt while you read README.txt, then combine the findings.`
Expected: a `spawn_subagent` cast opens a tethered SCOUT character below the hero that runs its own loop and reports back.

- [ ] **Step 6: Run the full test suite + build**

Run: `npm test && npm run build`
Expected: all unit tests PASS; `vite build` completes without type errors.

- [ ] **Step 7: Commit**

```bash
git add src/client/sprites.ts src/client/scene.ts src/client/main.ts
git commit -m "feat: add PixiJS arena scene and client wiring"
```

---

## How to run

```bash
cp .env.example .env        # then paste a real ANTHROPIC_API_KEY into .env
npm install
npm run dev                 # starts the runner (ws://127.0.0.1:8787) and the client (http://localhost:5173)
```

Open `http://localhost:5173`, type a quest, hit START.

## Phase mapping (from the spec)

- **Phase 1 — Money shot:** Tasks 1–8, 10, 11 (single live agent: arena, CRT, thought bubble, tool-cast, loop gauge, step counter).
- **Phase 2 — The party:** Task 9 + the tether/portal handling already built into Task 11's scene.
- **Phase 3 — Polish (future, out of this plan):** chiptune SFX toggle, dedicated portal/summon particle FX, swarm layout for 20+ agents, `web_fetch` tool.

## Self-review notes

- **Spec coverage:** event contract (Task 2) ✓; runner with Opus 4.8 + adaptive/summarized thinking + manual loop (Tasks 4, 6) ✓; tool set incl. `spawn_subagent` (Tasks 5, 9) ✓; WebSocket + API-key-server-side + 127.0.0.1 (Task 7) ✓; pure reducer store (Task 3) ✓; Pixi arena, CRT, character state machine, loop gauge, step counter, tethers (Tasks 10, 11) ✓; testing approach — pure-reducer + scripted-client + fake-socket (Tasks 3, 6, 8) ✓; YAGNI items left out ✓.
- **Type consistency:** `AgentEvent`/`AgentEventInput` shared (Task 2) and consumed unchanged by store, agent, emitter, net; `ModelStreamEvent`/`ModelClient` defined in Task 4 and consumed by Tasks 6–7; `ToolContext.spawn` defined in Task 5 and used in Tasks 7, 9; `WorldState`/`AgentState`/`Phase` defined in Task 3 and consumed by Task 11.
- **Placeholders:** none — every code/test step contains complete content.
