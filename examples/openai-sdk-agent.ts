import "dotenv/config";
import OpenAI from "openai";
import { connectAgentViz } from "../src/listener/websocket";
import { defaultTraceUrl } from "../src/listener/config";

const TRACE_URL = defaultTraceUrl();
const MODEL = process.env.OPENAI_EXAMPLE_MODEL ?? "gpt-4.1-mini";
const USE_REAL_OPENAI = process.env.OPENAI_EXAMPLE_REAL === "1";
const SPEED = Number(process.env.WORKFLOW_SPEED_MS ?? "1");

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms * SPEED)));

async function callOpenAI(prompt: string): Promise<string> {
  if (!USE_REAL_OPENAI) {
    await wait(420);
    return `Mock OpenAI response: ${prompt}`;
  }

  if (!process.env.OPENAI_API_KEY) {
    throw new Error("Set OPENAI_API_KEY or omit OPENAI_EXAMPLE_REAL=1");
  }

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const response = await client.responses.create({
    model: MODEL,
    input: prompt,
  });
  return response.output_text;
}

export async function runOpenAISdkExample(): Promise<void> {
  const viz = await connectAgentViz(TRACE_URL, { idPrefix: "openai-sdk-example" });

  try {
    await viz.run({
      id: "openai-sdk-root",
      label: "OPENAI SDK",
      prompt: "Use OpenAI SDK style calls to plan, inspect, and summarize a feature launch.",
    }, async (agent) => {
      agent.think("Start an OpenAI SDK launch board with planner, evaluator, and writer.");

      const planner = agent.subagent({ id: "openai-sdk-planner", label: "PLANNER" }, async (worker) => {
        worker.think("Draft launch plan with OpenAI Responses API shape.");
        const plan = await worker.llm({
          provider: "openai",
          model: USE_REAL_OPENAI ? MODEL : "mock-gpt",
          input: { prompt: "Plan a launch checklist for Agent Viz SDK adapters." },
        }, () => callOpenAI("Plan a launch checklist for Agent Viz SDK adapters."));
        const checklist = await worker.tool("make_checklist", { plan }, async () => {
          await wait(360);
          return ["listener connected", "tool events visible", "subagent visible", "final answer emitted"];
        });
        worker.say(`Planner produced ${checklist.length} items.`);
        return { plan, checklist };
      });

      await wait(180);

      const riskReview = agent.subagent({ id: "openai-sdk-risk", label: "RISK" }, async (risk) => {
        risk.think("Checking obvious launch risks.");
        const planning = await planner;
        const risks = await risk.tool("score_risks", { checklist: planning.checklist }, async () => {
          await wait(330);
          return ["port mismatch", "missing API key", "silent mock mode"];
        });
        const verdict = await risk.llm("openai:mock-risk-model", async () => {
          await wait(380);
          return `Risk review found ${risks.length} manageable risks.`;
        });
        risk.say(verdict);
        return verdict;
      });

      await wait(180);

      const writer = agent.subagent({ id: "openai-sdk-writer", label: "WRITER" }, async (worker) => {
        worker.think("Prepare release copy after planner output lands.");
        const planning = await planner;
        const copy = await worker.llm({
          provider: "openai",
          model: USE_REAL_OPENAI ? MODEL : "mock-copy-model",
          input: { plan: planning.plan },
        }, () => callOpenAI(`Write release copy for this plan: ${planning.plan}`));
        const lint = await worker.tool("lint_release_copy", { copyLength: copy.length }, async () => {
          await wait(280);
          return "copy approved";
        });
        worker.say(`${lint}: ${copy}`);
        return copy;
      });

      const [planning, risk, copy] = await Promise.all([planner, riskReview, writer]);

      agent.step();
      const bundle = await agent.tool("bundle_launch_packet", {
        checklist: planning.checklist.length,
        risk,
        copyLength: copy.length,
      }, async () => {
        await wait(420);
        return "launch packet bundled";
      });

      const final = await agent.llm({
        provider: "openai",
        model: USE_REAL_OPENAI ? MODEL : "mock-final-model",
        input: { bundle, risk },
      }, () => callOpenAI(`Finalize launch decision. Bundle=${bundle}. Risk=${risk}.`));

      agent.say(final);
      return `OpenAI SDK example complete: ${bundle}.`;
    });
  } finally {
    viz.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runOpenAISdkExample().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
