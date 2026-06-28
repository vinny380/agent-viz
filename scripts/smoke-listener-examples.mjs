// Headless smoke for external agent-system listener examples.
// Starts the trace hub, runs the LangChain and Anthropic SDK TypeScript
// examples in mock/offline mode, and asserts that model/tool/subagent events
// arrive over the WebSocket stream.
import { spawn } from "node:child_process";
import WebSocket from "ws";

const PORT = process.env.SMOKE_AGENT_VIZ_PORT ?? "8792";
const URL = `ws://127.0.0.1:${PORT}`;

const examples = [
  { name: "langchain", path: "examples/langchain-agent.ts", root: "langchain-root" },
  { name: "anthropic-sdk", path: "examples/anthropic-sdk-agent.ts", root: "anthropic-sdk-root" },
  { name: "openai-sdk", path: "examples/openai-sdk-agent.ts", root: "openai-sdk-root" },
  { name: "complex-workflow", path: "examples/complex-workflow-agent.ts", root: "workflow-root" },
  { name: "debate-swarm", path: "examples/debate-swarm-agent.ts", root: "debate-root" },
  { name: "incident-response", path: "examples/incident-response-agent.ts", root: "incident-root" },
];

const server = spawn("npx", ["tsx", "src/engine/server.ts"], {
  env: { ...process.env, AGENT_VIZ_PORT: PORT },
  stdio: ["ignore", "pipe", "pipe"],
});

const eventsByRoot = new Map();
const agentToRoot = new Map();
let viewer;
let serverStarted = false;
let failed = false;

server.stdout.on("data", (data) => {
  process.stdout.write("[server] " + data);
  if (!serverStarted && String(data).includes("listening")) {
    serverStarted = true;
    void main();
  }
});
server.stderr.on("data", (data) => process.stderr.write("[server-err] " + data));
server.on("exit", (code) => {
  if (!failed && !serverStarted) {
    failed = true;
    console.error(`server exited before listening: ${code}`);
    process.exit(1);
  }
});

function countsFor(root) {
  let counts = eventsByRoot.get(root);
  if (!counts) {
    counts = {};
    eventsByRoot.set(root, counts);
  }
  return counts;
}

function count(root, type) {
  const counts = countsFor(root);
  counts[type] = (counts[type] ?? 0) + 1;
}

function attachViewerOnce() {
  return new Promise((resolve, reject) => {
    viewer = new WebSocket(URL);
    viewer.on("open", resolve);
    viewer.on("error", reject);
    viewer.on("message", (raw) => {
      const event = JSON.parse(raw.toString());
      if (event.type === "run_started") {
        agentToRoot.set(event.agentId, event.rootAgentId);
        count(event.rootAgentId, event.type);
        return;
      }
      if (event.type === "agent_spawned") {
        const root = event.parentId ? agentToRoot.get(event.parentId) : event.agentId;
        if (root) {
          agentToRoot.set(event.agentId, root);
          count(root, event.type);
        }
        return;
      }
      const root = event.type === "run_finished"
        ? event.rootAgentId
        : agentToRoot.get(event.agentId);
      if (root) count(root, event.type);
    });
  });
}

async function attachViewer() {
  let lastError;
  for (let i = 0; i < 20; i++) {
    try {
      await attachViewerOnce();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw lastError;
}

function runExample(example) {
  return new Promise((resolve, reject) => {
    console.log(`\n>>> ${example.name}`);
    const child = spawn("npx", ["tsx", example.path], {
      env: {
        ...process.env,
        AGENT_VIZ_URL: URL,
        ANTHROPIC_EXAMPLE_REAL: "0",
        OPENAI_EXAMPLE_REAL: "0",
        WORKFLOW_SPEED_MS: "0",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.on("data", (data) => process.stdout.write(`[${example.name}] ${data}`));
    child.stderr.on("data", (data) => process.stderr.write(`[${example.name}-err] ${data}`));
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${example.name} exited with code ${code}`));
    });
  });
}

function requireCount(root, type, min = 1) {
  const actual = countsFor(root)[type] ?? 0;
  if (actual < min) throw new Error(`${root}: expected ${type} >= ${min}, got ${actual}`);
}

function assertExample(example) {
  requireCount(example.root, "run_started");
  requireCount(example.root, "agent_spawned", 2);
  requireCount(example.root, "loop_step_started", 2);
  requireCount(example.root, "model_call_started");
  requireCount(example.root, "model_call_finished");
  requireCount(example.root, "tool_call_started");
  requireCount(example.root, "tool_call_result");
  requireCount(example.root, "agent_finished", 2);
  requireCount(example.root, "run_finished");
}

async function main() {
  const timeout = setTimeout(() => {
    failed = true;
    cleanup();
    console.error("smoke timed out");
    process.exit(2);
  }, 30000);

  try {
    await attachViewer();
    for (const example of examples) {
      await runExample(example);
      await new Promise((resolve) => setTimeout(resolve, 150));
      assertExample(example);
      console.log(`${example.name} counts`, countsFor(example.root));
    }
    clearTimeout(timeout);
    console.log("\nlistener example smoke passed");
    cleanup();
    process.exit(0);
  } catch (error) {
    clearTimeout(timeout);
    failed = true;
    cleanup();
    console.error(error);
    process.exit(1);
  }
}

function cleanup() {
  try { viewer?.close(); } catch {}
  try { server.kill("SIGINT"); } catch {}
}

setTimeout(() => {
  if (!serverStarted) {
    failed = true;
    cleanup();
    console.error("server never listened");
    process.exit(3);
  }
}, 10000);
