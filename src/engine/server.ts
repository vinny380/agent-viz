import "dotenv/config";
import { WebSocketServer, WebSocket } from "ws";
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isAgentEventInput, type AgentEvent, type AgentEventInput, type ClientMessage } from "../shared/events";
import { createEmitter } from "./emitter";
import { createAnthropicModelClient } from "./model";
import { createToolRegistry } from "./tools";
import { runAgent } from "./anthropic-agent";

const PORT = Number(process.env.AGENT_VIZ_PORT ?? process.env.PORT ?? 8788);
const HOST = "127.0.0.1";

const apiKey = process.env.ANTHROPIC_API_KEY;
const model = apiKey ? createAnthropicModelClient(apiKey) : null;
if (!apiKey) console.warn("ANTHROPIC_API_KEY is not set; demo start_run is disabled, but trace listener mode is active.");

const ROOT_SYSTEM = `You are the Hero, an autonomous agent in a quest visualizer.
Think out loud, use tools when helpful, and keep working until the task is done.
You have tools: calculate, list_files, read_file. When you are finished, give a short final answer.`;

const SUBAGENT_SYSTEM = `You are a Scout, a focused subagent. Complete the single task you are given
using the available tools, then return a concise result for your commander.`;

// Examples runnable from the viewer menu. Whitelisted id -> file so a WS
// message can't spawn an arbitrary command. Each runs as its own producer,
// connecting back to this hub via AGENT_VIZ_URL and streaming its trace.
const EXAMPLES: Record<string, string> = {
  workflow: "complex-workflow-agent.ts",
  debate: "debate-swarm-agent.ts",
  incident: "incident-response-agent.ts",
  langchain: "langchain-agent.ts",
  anthropic: "anthropic-sdk-agent.ts",
  openai: "openai-sdk-agent.ts",
};

function runExample(id: string): void {
  const file = EXAMPLES[id];
  if (!file) return;
  const tsx = join(process.cwd(), "node_modules", ".bin", "tsx");
  const child = spawn(tsx, [join("examples", file)], {
    env: { ...process.env, AGENT_VIZ_URL: `ws://${HOST}:${PORT}` },
    stdio: "inherit",
  });
  child.on("error", (e) => console.error(`example ${id} failed to start:`, e));
}

function makeSandbox(): string {
  const dir = mkdtempSync(join(tmpdir(), "agent-quest-"));
  writeFileSync(join(dir, "README.txt"), "Welcome, hero. The treasure is in chest #7.\n");
  writeFileSync(join(dir, "notes.txt"), "Recipe: 3 + 4 gold coins per chest.\n");
  return dir;
}

const wss = new WebSocketServer({ host: HOST, port: PORT });
console.log(`Agent Quest trace hub listening on ws://${HOST}:${PORT}`);

let runSeq = 0;
const sockets = new Set<WebSocket>();

const broadcast = (event: AgentEvent): void => {
  const payload = JSON.stringify(event);
  for (const socket of sockets) {
    if (socket.readyState === WebSocket.OPEN) socket.send(payload);
  }
};

const emit = createEmitter(broadcast);

function emitAll(events: AgentEventInput[]): void {
  for (const event of events) {
    if (isAgentEventInput(event)) emit(event);
  }
}

async function handleDemoRun(prompt: string): Promise<void> {
  const tools = createToolRegistry();
  const sandboxDir = makeSandbox();
  const rootId = `agent-${++runSeq}-root`;

  if (!model) {
    emit({ type: "run_started", agentId: rootId, rootAgentId: rootId, prompt });
    emit({ type: "agent_spawned", agentId: rootId, parentId: null, role: "orchestrator", label: "HERO" });
    emit({ type: "error", agentId: rootId, message: "Missing ANTHROPIC_API_KEY. External trace listener mode is still available." });
    emit({ type: "run_finished", agentId: rootId, rootAgentId: rootId });
    return;
  }

  let childCounter = 0;

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

  emit({ type: "run_started", agentId: rootId, rootAgentId: rootId, prompt });
  try {
    await runAgent(
      { model, tools, emit, toolContext },
      { agentId: rootId, parentId: null, role: "orchestrator", label: "HERO", systemPrompt: ROOT_SYSTEM, userPrompt: prompt },
    );
  } catch (e) {
    emit({ type: "error", agentId: rootId, message: e instanceof Error ? e.message : String(e) });
  }
  emit({ type: "run_finished", agentId: rootId, rootAgentId: rootId });
}

wss.on("connection", (socket: WebSocket) => {
  sockets.add(socket);
  socket.on("close", () => sockets.delete(socket));

  socket.on("message", async (raw) => {
    let msg: ClientMessage;
    try { msg = JSON.parse(raw.toString()) as ClientMessage; } catch { return; }
    if (msg.type === "start_run" && typeof msg.prompt === "string") {
      await handleDemoRun(msg.prompt);
    } else if (msg.type === "run_example" && typeof msg.id === "string") {
      runExample(msg.id);
    } else if (msg.type === "trace_event" && isAgentEventInput(msg.event)) {
      emit(msg.event);
    } else if (msg.type === "trace_events" && Array.isArray(msg.events)) {
      emitAll(msg.events);
    }
  });
});
