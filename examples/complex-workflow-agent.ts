import "dotenv/config";
import { RunnableLambda } from "@langchain/core/runnables";
import { DynamicTool } from "@langchain/core/tools";
import { connectAgentViz } from "../src/listener/websocket";
import { defaultTraceUrl } from "../src/listener/config";
import type { AgentTrace } from "../src/listener/index";

const TRACE_URL = defaultTraceUrl();
const SPEED = Number(process.env.WORKFLOW_SPEED_MS ?? "1");

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms * SPEED)));

async function streamThink(agent: AgentTrace, lines: string[]): Promise<void> {
  agent.startThinking();
  for (const line of lines) {
    agent.thinking(line);
    await wait(220);
  }
  agent.stopThinking();
}

async function streamSay(agent: AgentTrace, lines: string[]): Promise<void> {
  for (const line of lines) {
    agent.say(line);
    await wait(180);
  }
}

async function mockLlm(agent: AgentTrace, label: string, prompt: string, result: string): Promise<string> {
  const runnable = RunnableLambda.from(async (input: string) => {
    return agent.llm({ provider: label, model: "langchain-runnable-mock", input: { prompt: input } }, async () => {
      await wait(650);
      return result;
    });
  });
  return runnable.invoke(prompt);
}

export async function runComplexWorkflowExample(): Promise<void> {
  const viz = await connectAgentViz(TRACE_URL, { idPrefix: "complex-workflow" });

  try {
    await viz.run({
      id: "workflow-root",
      label: "COMMAND",
      prompt: "Coordinate a multi-agent release readiness mission for Agent Viz.",
    }, async (commander) => {
      const scanRepo = new DynamicTool({
        name: "scan_repo",
        description: "Scan repository areas relevant to listener examples.",
        func: async () => {
          await wait(500);
          return JSON.stringify(["src/listener/index.ts", "examples/langchain-agent.ts", "scripts/smoke-listener-examples.mjs"]);
        },
      });
      const validateTraceShape = new DynamicTool({
        name: "validate_trace_shape",
        description: "Validate that the trace hierarchy remains readable.",
        func: async (input: string) => {
          await wait(420);
          return `shape ok for ${input}`;
        },
      });
      const applyAdapterPatch = new DynamicTool({
        name: "apply_adapter_patch",
        description: "Simulate applying adapter example patches.",
        func: async (input: string) => {
          await wait(700);
          return `patched ${input}`;
        },
      });
      const listenerSmoke = new DynamicTool({
        name: "listener_smoke",
        description: "Check required listener event families.",
        func: async (input: string) => {
          await wait(800);
          return `all required event families observed for ${input}`;
        },
      });
      const compileDigest = new DynamicTool({
        name: "compile_release_digest",
        description: "Compile release reports into a digest.",
        func: async (input: string) => {
          await wait(550);
          return input;
        },
      });

      await streamThink(commander, [
        "Map the mission. ",
        "Split work across scouts, builders, and QA. ",
        "Merge their reports into a launch call.",
      ]);

      const mission = await mockLlm(
        commander,
        "planner",
        "Create a release readiness plan.",
        "Mission plan: discover risks, design instrumentation, build adapter, verify end-to-end.",
      );
      await streamSay(commander, [`${mission} `]);

      const discovery = commander.subagent({ id: "workflow-discovery", label: "DISCOVERY" }, async (agent) => {
        await streamThink(agent, ["Scan package scripts. ", "Find integration surfaces. "]);
        const filesJson = await agent.tool(scanRepo.name, { globs: ["src/listener", "examples", "scripts"] }, () => scanRepo.invoke("src/listener examples scripts"));
        const files = JSON.parse(filesJson) as string[];
        agent.step();
        const report = await mockLlm(
          agent,
          "langchain",
          `Summarize ${files.length} repo findings.`,
          "Discovery: listener API is simple; examples need richer event density.",
        );
        await streamSay(agent, [`${report} `]);
        return report;
      });

      await wait(250);

      const architecture = commander.subagent({ id: "workflow-architecture", label: "ARCHITECT" }, async (agent) => {
        await streamThink(agent, ["Trace hierarchy should stay shallow. ", "Direct children read best on the LCD. "]);
        const sketch = await mockLlm(
          agent,
          "anthropic",
          "Design the agent choreography.",
          "Architecture: COMMAND owns four direct workers; each worker emits steps, tools, and summaries.",
        );
        agent.step();
        const check = await agent.tool(validateTraceShape.name, { maxDepth: 1, workers: 4 }, () => validateTraceShape.invoke("root plus direct workers"));
        await streamSay(agent, [`${sketch} ${check}. `]);
        return `${sketch} ${check}`;
      });

      await wait(250);

      const builder = commander.subagent({ id: "workflow-builder", label: "BUILDER" }, async (agent) => {
        await streamThink(agent, ["Assemble adapter glue. ", "Add example script. ", "Keep commands copyable. "]);
        const patch = await agent.tool(applyAdapterPatch.name, { files: ["examples/complex-workflow-agent.ts"] }, () => applyAdapterPatch.invoke("examples/complex-workflow-agent.ts"));
        agent.step();
        const notes = await mockLlm(
          agent,
          "builder",
          "Explain the patch.",
          "Builder: added live delays, streaming summaries, parallel workers, and final synthesis.",
        );
        await streamSay(agent, [`${patch}. ${notes} `]);
        return notes;
      });

      await wait(250);

      const qa = commander.subagent({ id: "workflow-qa", label: "QA" }, async (agent) => {
        await streamThink(agent, ["Watch event counts. ", "Check model and tool coverage. "]);
        const smoke = await agent.tool(listenerSmoke.name, { required: ["llm", "tool", "subagent", "finish"] }, () => listenerSmoke.invoke("llm tool subagent finish"));
        agent.step();
        const verdict = await mockLlm(
          agent,
          "qa",
          `Assess smoke result: ${smoke}`,
          "QA: workflow is visible, deterministic, and safe to run without API keys.",
        );
        await streamSay(agent, [`${verdict} `]);
        return verdict;
      });

      const reports = await Promise.all([discovery, architecture, builder, qa]);

      commander.step();
      await streamThink(commander, ["Merge reports. ", "Decide launch status. "]);
      const digestInput = reports.map((report, index) => `${index + 1}. ${report}`).join("\n");
      const digest = await commander.tool(compileDigest.name, { reports: reports.length }, () => compileDigest.invoke(digestInput));

      const final = await mockLlm(
        commander,
        "commander",
        digest,
        "Launch call: Agent Viz listener is ready for mainstream SDK demos.",
      );
      await streamSay(commander, [`${final} `]);
      return final;
    });
  } finally {
    viz.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runComplexWorkflowExample().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
