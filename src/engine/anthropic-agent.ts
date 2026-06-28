import { ANTHROPIC_MODEL, type ModelClient, type ModelMessage } from "./model";
import type { ToolRegistry, ToolContext } from "./tools";
import type { AgentEventInput, AgentRole } from "../shared/events";

export interface AgentDeps {
  model: ModelClient;
  tools: ToolRegistry;
  emit: (e: AgentEventInput) => void;
  toolContext: ToolContext;
  maxSteps?: number;
}

export interface RunAgentParams {
  agentId: string;
  parentId: string | null;
  role: AgentRole;
  label: string;
  systemPrompt: string;
  userPrompt: string;
}

const DEFAULT_MAX_STEPS = 12;

export async function runAgent(deps: AgentDeps, params: RunAgentParams): Promise<string> {
  const { model, tools, emit, toolContext } = deps;
  const maxSteps = deps.maxSteps ?? DEFAULT_MAX_STEPS;
  const { agentId } = params;

  emit({ type: "agent_spawned", agentId, parentId: params.parentId, role: params.role, label: params.label });

  const messages: ModelMessage[] = [{ role: "user", content: params.userPrompt }];
  let finalText = "";

  for (let step = 1; step <= maxSteps; step++) {
    emit({ type: "loop_step_started", agentId, step });

    let assistantContent: unknown = [];
    let toolUses: { id: string; name: string; input: unknown }[] = [];
    let stopReason = "end_turn";
    let stepText = "";
    const modelCallId = `${agentId}-step-${step}-llm`;

    emit({
      type: "model_call_started",
      agentId,
      modelCallId,
      provider: "anthropic",
      model: ANTHROPIC_MODEL,
      input: { step, messageCount: messages.length, toolCount: tools.defs.length },
    });
    try {
      for await (const ev of model.stream({ system: params.systemPrompt, messages, tools: tools.defs })) {
        switch (ev.type) {
          case "thinking_start": emit({ type: "thinking_started", agentId }); break;
          case "thinking_delta": emit({ type: "thinking_delta", agentId, text: ev.text }); break;
          case "thinking_stop": emit({ type: "thinking_stopped", agentId }); break;
          case "text_delta": emit({ type: "message_delta", agentId, text: ev.text }); stepText += ev.text; break;
          case "done":
            assistantContent = ev.assistantContent;
            toolUses = ev.toolUses;
            stopReason = ev.stopReason;
            if (ev.text) finalText = ev.text;
            break;
        }
      }
      emit({ type: "model_call_finished", agentId, modelCallId, ok: true, preview: `stop: ${stopReason}` });
    } catch (e) {
      emit({ type: "model_call_finished", agentId, modelCallId, ok: false, preview: e instanceof Error ? e.message : String(e) });
      throw e;
    }

    if (stopReason !== "tool_use" || toolUses.length === 0) {
      if (!finalText) finalText = stepText;
      break;
    }

    // Intercept and execute each tool call.
    messages.push({ role: "assistant", content: assistantContent });
    const toolResults: { type: "tool_result"; tool_use_id: string; content: string }[] = [];
    for (const call of toolUses) {
      emit({ type: "tool_call_started", agentId, toolCallId: call.id, name: call.name, input: call.input });
      const outcome = await tools.execute(call.name, call.input, toolContext);
      emit({ type: "tool_call_result", agentId, toolCallId: call.id, ok: outcome.ok, preview: outcome.preview });
      toolResults.push({ type: "tool_result", tool_use_id: call.id, content: outcome.resultForModel });
    }
    messages.push({ role: "user", content: toolResults });

    if (step === maxSteps) {
      finalText = finalText || "(stopped: reached step limit)";
    }
  }

  emit({ type: "agent_finished", agentId, finalText });
  return finalText;
}
