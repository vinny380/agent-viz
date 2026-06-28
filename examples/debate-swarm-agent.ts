import "dotenv/config";
import OpenAI from "openai";
import { connectAgentViz } from "../src/listener/websocket";
import { defaultTraceUrl } from "../src/listener/config";
import type { AgentTrace } from "../src/listener/index";

const TRACE_URL = defaultTraceUrl();
const SPEED = Number(process.env.WORKFLOW_SPEED_MS ?? "1");
const MODEL = process.env.OPENAI_EXAMPLE_MODEL ?? "gpt-4.1-mini";
const USE_REAL_OPENAI = process.env.OPENAI_EXAMPLE_REAL === "1";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms * SPEED)));

async function callOpenAI(prompt: string, fallback: string): Promise<string> {
  if (!USE_REAL_OPENAI) {
    await wait(520);
    return fallback;
  }
  if (!process.env.OPENAI_API_KEY) throw new Error("Set OPENAI_API_KEY or omit OPENAI_EXAMPLE_REAL=1");
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const response = await client.responses.create({ model: MODEL, input: prompt });
  return response.output_text;
}

async function deliberate(agent: AgentTrace, stance: string, claim: string): Promise<string> {
  agent.startThinking();
  for (const thought of [
    `Adopt ${stance} stance. `,
    "List evidence. ",
    "Prepare a concise argument.",
  ]) {
    agent.thinking(thought);
    await wait(180);
  }
  agent.stopThinking();

  const argument = await agent.llm({
    provider: "openai",
    model: USE_REAL_OPENAI ? MODEL : `${stance}-mock-debate-model`,
    input: { stance, claim },
  }, () => callOpenAI(`Argue from the ${stance} stance: ${claim}`, claim));

  const score = await agent.tool("score_argument", { stance, claim }, async () => {
    await wait(300);
    return Math.round((claim.length % 7) + 3);
  });

  agent.say(`${stance} score ${score}: ${argument}`);
  return `${stance}: ${argument} (score ${score})`;
}

export async function runDebateSwarmExample(): Promise<void> {
  const viz = await connectAgentViz(TRACE_URL, { idPrefix: "debate-swarm" });

  try {
    await viz.run({
      id: "debate-root",
      label: "MODERATOR",
      prompt: "Debate whether Agent Viz should prioritize SDK adapters or a browser proxy next.",
    }, async (moderator) => {
      moderator.think("Open debate. Assign three perspectives, then synthesize.");

      const sdk = moderator.subagent({ id: "debate-sdk", label: "SDK ADV" }, (agent) => {
        return deliberate(agent, "sdk", "SDK adapters are highest leverage because coding agents can call hooks directly.");
      });

      await wait(180);

      const proxy = moderator.subagent({ id: "debate-proxy", label: "PROXY" }, (agent) => {
        return deliberate(agent, "proxy", "A browser or HTTP proxy catches opaque systems that cannot be modified.");
      });

      await wait(180);

      const ux = moderator.subagent({ id: "debate-ux", label: "UX" }, (agent) => {
        return deliberate(agent, "ux", "The next milestone should make traces more legible and fun to watch.");
      });

      const argumentsByAgent = await Promise.all([sdk, proxy, ux]);

      moderator.step();
      const tally = await moderator.tool("tally_votes", { arguments: argumentsByAgent }, async () => {
        await wait(450);
        return { sdk: 2, proxy: 1, ux: 1 };
      });

      const synthesis = await moderator.llm({
        provider: "openai",
        model: USE_REAL_OPENAI ? MODEL : "moderator-mock-synthesis-model",
        input: { arguments: argumentsByAgent, tally },
      }, () => callOpenAI(
        `Synthesize this debate:\n${argumentsByAgent.join("\n")}\nVotes: ${JSON.stringify(tally)}`,
        `Decision: ship SDK adapters first, keep proxy as the next research track. Votes: ${JSON.stringify(tally)}.`,
      ));

      moderator.say(synthesis);
      return synthesis;
    });
  } finally {
    viz.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runDebateSwarmExample().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
