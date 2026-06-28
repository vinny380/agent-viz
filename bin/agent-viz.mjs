#!/usr/bin/env node
// One command: boot the trace hub + the Game Boy viewer, open the browser.
// The hub stays on a fixed port (default 8788) so `connectAgentViz()` finds it
// with zero config from the agent side. Set AGENT_VIZ_PORT to move both ends.
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const hubPort = process.env.AGENT_VIZ_PORT ?? "8788";
const env = { ...process.env, AGENT_VIZ_PORT: hubPort, VITE_TRACE_WS_URL: `ws://127.0.0.1:${hubPort}` };

// ponytail: shells the repo's local vite/tsx. Works in-dev today; a published
// build (dist + node, no tsx/vite) is the follow-up before `npm publish`.
const procs = [
  spawn("npx", ["tsx", "src/engine/server.ts"], { cwd: root, env, stdio: "inherit" }),
  spawn("npx", ["vite", "--open"], { cwd: root, env, stdio: "inherit" }),
];

const bye = () => { for (const p of procs) p.kill(); process.exit(0); };
process.on("SIGINT", bye);
process.on("SIGTERM", bye);
for (const p of procs) p.on("exit", bye);
