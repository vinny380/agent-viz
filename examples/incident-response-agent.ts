import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import { connectAgentViz } from "../src/listener/websocket";
import { defaultTraceUrl } from "../src/listener/config";
import type { AgentTrace } from "../src/listener/index";

const TRACE_URL = defaultTraceUrl();
const SPEED = Number(process.env.WORKFLOW_SPEED_MS ?? "1");
const MODEL = process.env.ANTHROPIC_EXAMPLE_MODEL ?? "claude-3-5-haiku-latest";
const USE_REAL_ANTHROPIC = process.env.ANTHROPIC_EXAMPLE_REAL === "1";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms * SPEED)));

function textFromAnthropicMessage(message: Anthropic.Messages.Message): string {
  return message.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("");
}

async function callAnthropic(prompt: string, fallback: string): Promise<string> {
  if (!USE_REAL_ANTHROPIC) {
    await wait(500);
    return fallback;
  }
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("Set ANTHROPIC_API_KEY or omit ANTHROPIC_EXAMPLE_REAL=1");
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 500,
    messages: [{ role: "user", content: prompt }],
  });
  return textFromAnthropicMessage(message);
}

async function inspectService(agent: AgentTrace, service: string, status: string): Promise<string> {
  agent.think(`Inspect ${service}.`);
  const metrics = await agent.tool("fetch_metrics", { service }, async () => {
    await wait(420);
    return { service, p95: service === "api" ? 1800 : 220, errors: service === "api" ? 42 : 3 };
  });
  agent.step();
  const finding = await agent.llm({
    provider: "anthropic",
    model: USE_REAL_ANTHROPIC ? MODEL : `${service}-mock-ops-model`,
    input: { service, status, metrics },
  }, () => callAnthropic(
    `Summarize incident service finding for ${service}: ${status}; metrics=${JSON.stringify(metrics)}.`,
    `${service} finding: ${status}; metrics=${JSON.stringify(metrics)}.`,
  ));
  agent.say(finding);
  return finding;
}

export async function runIncidentResponseExample(): Promise<void> {
  const viz = await connectAgentViz(TRACE_URL, { idPrefix: "incident-response" });

  try {
    await viz.run({
      id: "incident-root",
      label: "INCIDENT",
      prompt: "Coordinate an incident response for elevated latency.",
    }, async (commander) => {
      commander.think("Triage the incident. Split API, DB, and comms work.");

      const api = commander.subagent({ id: "incident-api", label: "API" }, (agent) => {
        return inspectService(agent, "api", "latency spike correlated with deploy");
      });

      await wait(160);

      const db = commander.subagent({ id: "incident-db", label: "DB" }, async (agent) => {
        agent.think("Check database health and retry on transient failure.");
        try {
          await agent.tool("query_slow_log", { database: "primary" }, async () => {
            await wait(300);
            throw new Error("slow log temporarily unavailable");
          });
        } catch {
          agent.say("Slow log failed once; trying fallback.");
        }
        const fallback = await agent.tool("query_replica_metrics", { database: "replica" }, async () => {
          await wait(360);
          return "replica healthy; primary CPU normal";
        });
        agent.step();
        const finding = await agent.llm({
          provider: "anthropic",
          model: USE_REAL_ANTHROPIC ? MODEL : "db-mock-ops-model",
          input: { fallback },
        }, () => callAnthropic(
          `Summarize DB finding from fallback metric: ${fallback}.`,
          `DB finding: database is not the bottleneck; ${fallback}.`,
        ));
        agent.say(finding);
        return finding;
      });

      await wait(160);

      const comms = commander.subagent({ id: "incident-comms", label: "COMMS" }, async (agent) => {
        agent.think("Prepare status update while engineers investigate.");
        const draft = await agent.llm({
          provider: "anthropic",
          model: USE_REAL_ANTHROPIC ? MODEL : "comms-mock-status-model",
          input: { incident: "elevated API latency" },
        }, () => callAnthropic(
          "Draft a concise incident status update for elevated API latency.",
          "Status: investigating elevated API latency; no data loss observed.",
        ));
        const approved = await agent.tool("approve_status", { draft }, async () => {
          await wait(240);
          return "approved";
        });
        agent.say(`${approved}: ${draft}`);
        return draft;
      });

      const reports = await Promise.all([api, db, comms]);

      commander.step();
      const mitigation = await commander.tool("roll_back_deploy", { service: "api", target: "previous-stable" }, async () => {
        await wait(650);
        return "rollback complete; p95 latency recovering";
      });
      const final = await commander.llm({
        provider: "anthropic",
        model: USE_REAL_ANTHROPIC ? MODEL : "incident-mock-commander-model",
        input: { mitigation, reports },
      }, () => callAnthropic(
        `Write final incident resolution. Mitigation=${mitigation}. Reports=${reports.join("\n")}`,
        `Incident resolved: ${mitigation}. Reports reviewed: ${reports.length}.`,
      ));
      commander.say(final);
      return final;
    });
  } finally {
    viz.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runIncidentResponseExample().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
