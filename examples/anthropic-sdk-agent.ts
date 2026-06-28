import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import { connectAgentViz } from "../src/listener/websocket";
import { defaultTraceUrl } from "../src/listener/config";
import type { AgentTrace } from "../src/listener/index";

const TRACE_URL = defaultTraceUrl();
const MODEL = process.env.ANTHROPIC_EXAMPLE_MODEL ?? "claude-3-5-haiku-latest";
const USE_REAL_ANTHROPIC = process.env.ANTHROPIC_EXAMPLE_REAL === "1";
const SPEED = Number(process.env.WORKFLOW_SPEED_MS ?? "1");

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms * SPEED)));

function textFromAnthropicMessage(message: Anthropic.Messages.Message): string {
  return message.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("");
}

async function callAnthropic(prompt: string): Promise<string> {
  if (!USE_REAL_ANTHROPIC) {
    await wait(520);
    return `Mock Claude response: ${prompt}`;
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("Set ANTHROPIC_API_KEY or omit ANTHROPIC_EXAMPLE_REAL=1");
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 500,
    messages: [{ role: "user", content: prompt }],
  });
  return textFromAnthropicMessage(message);
}

async function claudeWorker(agent: AgentTrace, role: string, prompt: string): Promise<string> {
  agent.think(`${role} preparing Anthropic SDK request.`);
  const draft = await agent.llm({
    provider: "anthropic",
    model: USE_REAL_ANTHROPIC ? MODEL : "mock-claude",
    input: { prompt },
  }, () => callAnthropic(prompt));

  const evidence = await agent.tool("collect_evidence", { role, draftLength: draft.length }, async () => {
    await wait(340);
    return `${role} evidence packet with ${draft.length} chars`;
  });

  agent.step();
  const review = await agent.llm({
    provider: "anthropic",
    model: USE_REAL_ANTHROPIC ? MODEL : "mock-claude-review",
    input: { draft, evidence },
  }, () => callAnthropic(`Review this ${role} packet: ${draft}\nEvidence: ${evidence}`));

  agent.say(review);
  return review;
}

export async function runAnthropicSdkExample(): Promise<void> {
  const viz = await connectAgentViz(TRACE_URL, { idPrefix: "anthropic-sdk-example" });

  try {
    await viz.run({
      id: "anthropic-sdk-root",
      prompt: "Use Anthropic SDK agents to plan, critique, and package a listener launch note.",
      label: "CLAUDE SDK",
    }, async (agent) => {
      agent.think("Coordinate three Anthropic SDK-backed workers.");

      const planner = agent.subagent({ id: "anthropic-sdk-planner", label: "PLANNER" }, (worker) => {
        return claudeWorker(worker, "planner", "Create a launch plan for Agent Viz SDK adapters.");
      });

      await wait(180);

      const critic = agent.subagent({ id: "anthropic-sdk-critic", label: "CRITIC" }, (worker) => {
        return claudeWorker(worker, "critic", "Find risks in the Agent Viz listener SDK examples.");
      });

      await wait(180);

      const writer = agent.subagent({ id: "anthropic-sdk-writer", label: "WRITER" }, (worker) => {
        return claudeWorker(worker, "writer", "Write a short user-facing release note for Agent Viz examples.");
      });

      const packets = await Promise.all([planner, critic, writer]);

      agent.step();
      const checksum = await agent.tool("package_release_note", { packets: packets.length }, async () => {
        await wait(360);
        return `packet:${packets.map((packet) => packet.length).join("-")}`;
      });

      const final = await agent.llm({
        provider: "anthropic",
        model: USE_REAL_ANTHROPIC ? MODEL : "mock-claude-synthesis",
        input: { packets, checksum },
      }, () => callAnthropic(`Synthesize final launch note from packets:\n${packets.join("\n---\n")}\n${checksum}`));

      agent.say(final);
      return `Anthropic SDK workflow complete (${checksum}).`;
    });
  } finally {
    viz.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runAnthropicSdkExample().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
