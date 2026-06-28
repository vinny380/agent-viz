import "dotenv/config";
import { RunnableLambda, RunnableSequence } from "@langchain/core/runnables";
import { DynamicTool } from "@langchain/core/tools";
import { connectAgentViz } from "../src/listener/websocket";
import { defaultTraceUrl } from "../src/listener/config";
import type { AgentTrace } from "../src/listener/index";

const TRACE_URL = defaultTraceUrl();
const SPEED = Number(process.env.WORKFLOW_SPEED_MS ?? "1");

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms * SPEED)));

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
      return agent.llm("langchain:mock-chat-model", async () => {
        await wait(420);
        return `${label} plan: ${task}`;
      });
    });

    const toolStep = RunnableLambda.from(async (plan: string) => {
      const output = await agent.tool(tool.name, { input: toolInput }, () => tool.invoke(toolInput));
      return `${plan}. ${tool.name} => ${output}`;
    });

    const summaryStep = RunnableLambda.from(async (toolReport: string) => {
      agent.step();
      return agent.llm("langchain:mock-summary-model", async () => {
        await wait(360);
        return `${label} summary: ${toolReport}`;
      });
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
          return agent.llm("langchain:mock-synthesis-model", async () => {
            await wait(520);
            return `LangChain release packet ready:\n${merged}`;
          });
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
