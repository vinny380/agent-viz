import Anthropic from "@anthropic-ai/sdk";

export interface ModelMessage { role: "user" | "assistant"; content: unknown; }
export interface ModelToolDef { name: string; description: string; input_schema: Record<string, unknown>; }
export interface ModelTurnInput { system: string; messages: ModelMessage[]; tools: ModelToolDef[]; }
export interface NormalizedToolUse { id: string; name: string; input: unknown; }

export type ModelStreamEvent =
  | { type: "thinking_start" }
  | { type: "thinking_delta"; text: string }
  | { type: "thinking_stop" }
  | { type: "text_delta"; text: string }
  | { type: "done"; stopReason: string; assistantContent: unknown; text: string; toolUses: NormalizedToolUse[] };

export interface ModelClient {
  stream(input: ModelTurnInput): AsyncIterable<ModelStreamEvent>;
}

export function createAnthropicModelClient(apiKey: string): ModelClient {
  const client = new Anthropic({ apiKey });

  return {
    async *stream(input: ModelTurnInput): AsyncIterable<ModelStreamEvent> {
      // newer params (thinking.display, output_config) may outpace the SDK's
      // published types; build the object and cast once.
      const params = {
        model: "claude-opus-4-8",
        max_tokens: 16000,
        thinking: { type: "adaptive", display: "summarized" },
        output_config: { effort: "high" },
        system: input.system,
        tools: input.tools,
        messages: input.messages as Anthropic.MessageParam[],
      } as unknown as Anthropic.MessageStreamParams;

      const stream = client.messages.stream(params);
      const blockTypeByIndex = new Map<number, string>();

      for await (const ev of stream) {
        if (ev.type === "content_block_start") {
          blockTypeByIndex.set(ev.index, ev.content_block.type);
          if (ev.content_block.type === "thinking") yield { type: "thinking_start" };
        } else if (ev.type === "content_block_delta") {
          if (ev.delta.type === "thinking_delta") yield { type: "thinking_delta", text: ev.delta.thinking };
          else if (ev.delta.type === "text_delta") yield { type: "text_delta", text: ev.delta.text };
        } else if (ev.type === "content_block_stop") {
          if (blockTypeByIndex.get(ev.index) === "thinking") yield { type: "thinking_stop" };
        }
      }

      const final = await stream.finalMessage();
      const text = final.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("");
      const toolUses: NormalizedToolUse[] = final.content
        .filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use")
        .map((b) => ({ id: b.id, name: b.name, input: b.input }));

      yield {
        type: "done",
        stopReason: final.stop_reason ?? "end_turn",
        assistantContent: final.content,
        text,
        toolUses,
      };
    },
  };
}
