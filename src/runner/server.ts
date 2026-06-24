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
