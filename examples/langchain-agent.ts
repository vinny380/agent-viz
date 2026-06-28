import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import { RunnableLambda, RunnableSequence } from "@langchain/core/runnables";
import { DynamicTool } from "@langchain/core/tools";
import { connectAgentViz } from "../src/listener/websocket";
import { defaultTraceUrl } from "../src/listener/config";
import type { AgentTrace } from "../src/listener/index";

const TRACE_URL = defaultTraceUrl();
const SPEED = Number(process.env.WORKFLOW_SPEED_MS ?? "1");
const MODEL = process.env.ANTHROPIC_EXAMPLE_MODEL ?? "claude-opus-4-8";

// Real Claude calls when a key is present; the smoke harness forces them off
// (ANTHROPIC_EXAMPLE_REAL=0) and we auto-mock when no key is set, so the
// keyless/offline paths still work.
// ponytail: reuses @anthropic-ai/sdk (already a dep) — no @langchain/anthropic.
const USE_REAL = process.env.ANTHROPIC_EXAMPLE_REAL !== "0" && Boolean(process.env.ANTHROPIC_API_KEY);
const client = USE_REAL ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }) : null;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms * SPEED)));

/** One Claude turn, or a deterministic mock string when running offline. */
async function callClaude(prompt: string, mock: string): Promise<string> {
  if (!client) {
    await wait(420);
    return mock;
  }
  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 512, // ponytail: short demo replies; bump if outputs truncate
    messages: [{ role: "user", content: prompt }],
  });
  return message.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("");
}

async function runLangChainWorker(
  parent: AgentTrace,
  id: string,
  label: string,
  mission: string,
  tool: DynamicTool,
  toolInput: string,
): Promise<string> {
  return parent.subagent({ id, label }, async (agent) => {
    agent.think(`Build LangChain chain for ${label}.`);

    const planStep = RunnableLambda.from(async (task: string) => {
      return agent.llm(
        { provider: "anthropic", model: USE_REAL ? MODEL : "langchain-mock-chat", input: { task } },
        () => callClaude(
          `You are ${label}, a release-readiness worker. In two sentences, outline a plan to: ${task}`,
          `${label} plan: ${task}`,
        ),
      );
    });

    const toolStep = RunnableLambda.from(async (plan: string) => {
      const output = await agent.tool(tool.name, { input: toolInput }, () => tool.invoke(toolInput));
      return `${plan}. ${tool.name} => ${output}`;
    });

    const summaryStep = RunnableLambda.from(async (toolReport: string) => {
      agent.step();
      return agent.llm(
        { provider: "anthropic", model: USE_REAL ? MODEL : "langchain-mock-summary", input: { toolReport } },
        () => callClaude(
          `Summarize this ${label} tool report in one sentence:\n${toolReport}`,
          `${label} summary: ${toolReport}`,
        ),
      );
    });

    const chain = RunnableSequence.from([planStep, toolStep, summaryStep]);
    const report = await chain.invoke(mission);
    agent.say(report);
    return report;
  });
}

export async function runLangChainExample(): Promise<void> {
  const viz = await connectAgentViz(TRACE_URL, { idPrefix: "langchain-example" });

  try {
    await viz.run({
      id: "langchain-root",
      prompt: "Use LangChain chains and tools to prepare a release readiness packet.",
      label: "LC COMMAND",
    }, async (agent) => {
      const inventoryTool = new DynamicTool({
        name: "inventory_repo",
        description: "Return important files for a release review.",
        func: async () => {
          await wait(360);
          return "src/listener, examples, scripts, docs";
        },
      });

      const testTool = new DynamicTool({
        name: "simulate_test_plan",
        description: "Return a deterministic test plan.",
        func: async (input: string) => {
          await wait(420);
          return `test plan for ${input}: unit, smoke, visual trace`;
        },
      });

      const docsTool = new DynamicTool({
        name: "audit_docs",
        description: "Check documentation coverage.",
        func: async () => {
          await wait(320);
          return "docs mention setup, examples, real SDK flags";
        },
      });

      agent.think("Launch LangChain worker chains in parallel.");

      const discovery = runLangChainWorker(
        agent,
        "langchain-discovery",
        "LC SCOUT",
        "Find integration surfaces for Agent Viz.",
        inventoryTool,
        "release-readiness",
      );

      await wait(160);

      const testing = runLangChainWorker(
        agent,
        "langchain-testing",
        "LC TEST",
        "Design verification for listener examples.",
        testTool,
        "listener examples",
      );

      await wait(160);

      const docs = runLangChainWorker(
        agent,
        "langchain-docs",
        "LC DOCS",
        "Check whether humans can run the examples.",
        docsTool,
        "listener docs",
      );

      const reports = await Promise.all([discovery, testing, docs]);

      const synthesisChain = RunnableSequence.from([
        RunnableLambda.from(async (items: string[]) => {
          agent.step();
          return agent.tool("merge_langchain_reports", { reports: items.length }, async () => {
            await wait(380);
            return items.join("\n---\n");
          });
        }),
        RunnableLambda.from(async (merged: string) => {
          return agent.llm(
            { provider: "anthropic", model: USE_REAL ? MODEL : "langchain-mock-synthesis", input: { merged } },
            () => callClaude(
              `You are a release manager. Combine these worker reports into a short release-readiness packet:\n${merged}`,
              `LangChain release packet ready:\n${merged}`,
            ),
          );
        }),
      ]);

      const final = await synthesisChain.invoke(reports);
      agent.say("LangChain packet complete.");
      return final;
    });
  } finally {
    viz.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runLangChainExample().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
