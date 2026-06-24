// Headless end-to-end smoke of the Agent Quest runner.
// Spawns the WS runner, sends one real quest, prints the live AgentEvent
// stream, then shuts the runner down. Verifies the full runner path
// (real Claude call -> streamed thinking -> tool calls -> subagent -> finish)
// without needing a browser. Usage: node scripts/smoke-run.mjs ["prompt"]
import { spawn } from "node:child_process";
import WebSocket from "ws";

const prompt =
  process.argv[2] ||
  "Read README.txt and notes.txt in your sandbox. Work out the total gold for 7 chests using the calculator. Then spawn a scout subagent to re-read notes.txt and confirm the per-chest amount. Give a short final answer.";

const server = spawn("npx", ["tsx", "src/runner/server.ts"], {
  stdio: ["ignore", "pipe", "pipe"],
});
let started = false;
server.stdout.on("data", (d) => {
  process.stdout.write("[server] " + d);
  if (String(d).includes("listening")) begin();
});
server.stderr.on("data", (d) => process.stderr.write("[server-err] " + d));

function begin() {
  if (started) return;
  started = true;
  const ws = new WebSocket("ws://127.0.0.1:8787");
  const counts = {};
  const agents = new Map();
  let thinkingChars = 0;

  const finish = (code) => {
    try { ws.close(); } catch {}
    server.kill("SIGINT");
    setTimeout(() => process.exit(code), 300);
  };

  ws.on("open", () => {
    console.log("\n>>> QUEST:", prompt, "\n");
    ws.send(JSON.stringify({ type: "start_run", prompt }));
  });

  ws.on("message", (raw) => {
    const e = JSON.parse(raw.toString());
    counts[e.type] = (counts[e.type] || 0) + 1;
    switch (e.type) {
      case "agent_spawned":
        agents.set(e.agentId, e.label);
        console.log(`  + spawn ${e.label} [${e.role}] parent=${e.parentId ?? "—"}`);
        break;
      case "loop_step_started":
        console.log(`  · ${agents.get(e.agentId) ?? e.agentId} STEP ${e.step}`);
        break;
      case "thinking_delta":
        thinkingChars += e.text.length;
        break;
      case "tool_call_started":
        console.log(`  ⚙ ${agents.get(e.agentId) ?? e.agentId} -> ${e.name}(${JSON.stringify(e.input)})`);
        break;
      case "tool_call_result":
        console.log(`  ← ${e.ok ? "ok" : "ERR"}: ${e.preview}`);
        break;
      case "agent_finished":
        console.log(`  ✓ ${agents.get(e.agentId) ?? e.agentId} done: ${String(e.finalText).slice(0, 160)}`);
        break;
      case "error":
        console.log(`  ✖ error: ${e.message}`);
        break;
      case "run_finished":
        console.log("\n=== EVENT COUNTS ===", counts);
        console.log(`agents=${agents.size} thinking_chars=${thinkingChars}`);
        finish(counts.error ? 1 : 0);
        break;
    }
  });

  ws.on("error", (err) => { console.error("ws error:", err.message); finish(1); });
  setTimeout(() => { console.log("\n[timeout]", counts); finish(2); }, 180000);
}

setTimeout(() => {
  if (!started) { console.error("server never listened"); server.kill(); process.exit(3); }
}, 15000);
