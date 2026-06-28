import type { AgentEventInput, AgentRole } from "../shared/events";

export type TraceSink = (event: AgentEventInput) => void;

export interface AgenticListenerOptions {
  idPrefix?: string;
}

export interface StartRunOptions {
  prompt: string;
  id?: string;
  label?: string;
  role?: AgentRole;
}

export interface AgentOptions {
  id?: string;
  parentId: string | null;
  role?: AgentRole;
  label?: string;
}

export interface ModelCallOptions {
  modelCallId?: string;
  provider?: string;
  model?: string;
  input?: unknown;
}

export interface ToolCallOptions {
  toolCallId?: string;
  name: string;
  input?: unknown;
}

export type TraceCall<T> = () => Promise<T> | T;
export type RunCallback<T> = (agent: AgentTrace) => Promise<T> | T;
export type RunInput = string | StartRunOptions;
export type AgentInput = string | Omit<AgentOptions, "parentId">;
export type LlmInput = string | ModelCallOptions;

function defaultPreview(value: unknown): string {
  if (value instanceof Error) return value.message;
  if (typeof value === "string") return value.replace(/\s+/g, " ").trim().slice(0, 140);
  try {
    return JSON.stringify(value)?.slice(0, 140) ?? String(value);
  } catch {
    return String(value).slice(0, 140);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class AgenticListener {
  private seq = 0;
  private readonly idPrefix: string;

  constructor(private readonly sink: TraceSink, options: AgenticListenerOptions = {}) {
    this.idPrefix = options.idPrefix ?? `trace-${Date.now().toString(36)}`;
  }

  emit(event: AgentEventInput): void {
    this.sink(event);
  }

  nextId(kind: string): string {
    this.seq += 1;
    return `${this.idPrefix}-${kind}-${this.seq}`;
  }

  startRun(options: StartRunOptions): AgentTrace {
    const rootAgentId = options.id ?? this.nextId("root");
    const label = options.label ?? "AGENT";
    const role = options.role ?? "orchestrator";
    this.emit({ type: "run_started", agentId: rootAgentId, rootAgentId, prompt: options.prompt });
    return this.agent({ id: rootAgentId, parentId: null, role, label });
  }

  agent(options: AgentOptions): AgentTrace {
    const agentId = options.id ?? this.nextId("agent");
    const role = options.role ?? (options.parentId === null ? "orchestrator" : "subagent");
    const label = options.label ?? (role === "orchestrator" ? "AGENT" : "SUBAGENT");
    this.emit({ type: "agent_spawned", agentId, parentId: options.parentId, role, label });
    return new AgentTrace(this, agentId);
  }

  finishRun(rootAgentId: string): void {
    this.emit({ type: "run_finished", agentId: rootAgentId, rootAgentId });
  }

  async run<T>(input: RunInput, fn: RunCallback<T>): Promise<T> {
    const options = typeof input === "string" ? { prompt: input } : input;
    const root = this.startRun(options);
    root.step();
    try {
      const result = await fn(root);
      if (!root.isFinished()) root.finish(typeof result === "string" ? result : "done");
      return result;
    } catch (error) {
      root.error(error);
      if (!root.isFinished()) root.finish("failed");
      throw error;
    } finally {
      this.finishRun(root.agentId);
    }
  }
}

export class AgentTrace {
  private stepCount = 0;
  private finished = false;

  constructor(
    private readonly listener: AgenticListener,
    readonly agentId: string,
  ) {}

  step(): void {
    this.stepCount += 1;
    this.listener.emit({ type: "loop_step_started", agentId: this.agentId, step: this.stepCount });
  }

  startThinking(): void {
    this.listener.emit({ type: "thinking_started", agentId: this.agentId });
  }

  thinking(text: string): void {
    this.listener.emit({ type: "thinking_delta", agentId: this.agentId, text });
  }

  think(text: string): void {
    this.startThinking();
    this.thinking(text);
    this.stopThinking();
  }

  stopThinking(): void {
    this.listener.emit({ type: "thinking_stopped", agentId: this.agentId });
  }

  message(text: string): void {
    this.listener.emit({ type: "message_delta", agentId: this.agentId, text });
  }

  say(text: string): void {
    this.message(text);
  }

  spawn(options: AgentInput = {}): AgentTrace {
    const normalized = typeof options === "string" ? { label: options } : options;
    return this.listener.agent({ ...normalized, parentId: this.agentId });
  }

  subagent(options?: AgentInput): AgentTrace;
  subagent<T>(options: AgentInput, fn: RunCallback<T>): Promise<T>;
  subagent<T>(fn: RunCallback<T>): Promise<T>;
  subagent<T>(optionsOrFn: AgentInput | RunCallback<T> = {}, maybeFn?: RunCallback<T>): AgentTrace | Promise<T> {
    const hasInlineFn = typeof optionsOrFn === "function";
    const options = hasInlineFn ? {} : optionsOrFn;
    const fn = (hasInlineFn ? optionsOrFn : maybeFn) as RunCallback<T> | undefined;
    const child = this.spawn(options);
    if (!fn) return child;
    child.step();
    return runAgentCallback(child, fn);
  }

  async modelCall<T>(options: ModelCallOptions, call: TraceCall<T>): Promise<T> {
    const modelCallId = options.modelCallId ?? this.listener.nextId("llm");
    this.listener.emit({
      type: "model_call_started",
      agentId: this.agentId,
      modelCallId,
      provider: options.provider,
      model: options.model,
      input: options.input,
    });
    try {
      const result = await call();
      this.listener.emit({
        type: "model_call_finished",
        agentId: this.agentId,
        modelCallId,
        ok: true,
        preview: defaultPreview(result),
      });
      return result;
    } catch (error) {
      this.listener.emit({
        type: "model_call_finished",
        agentId: this.agentId,
        modelCallId,
        ok: false,
        preview: errorMessage(error),
      });
      throw error;
    }
  }

  async llm<T>(input: LlmInput, call: TraceCall<T>): Promise<T> {
    const options = typeof input === "string" ? modelOptionsFromShorthand(input) : input;
    return this.modelCall(options, call);
  }

  async tool<T>(name: string, input: unknown, call: TraceCall<T>): Promise<T>;
  async tool<T>(name: string, call: TraceCall<T>): Promise<T>;
  async tool<T>(options: ToolCallOptions, call: TraceCall<T>): Promise<T>;
  async tool<T>(
    optionsOrName: ToolCallOptions | string,
    inputOrCall: unknown | TraceCall<T>,
    maybeCall?: TraceCall<T>,
  ): Promise<T> {
    const options = typeof optionsOrName === "string"
      ? { name: optionsOrName, input: typeof inputOrCall === "function" ? undefined : inputOrCall }
      : optionsOrName;
    const call = (typeof inputOrCall === "function" ? inputOrCall : maybeCall) as TraceCall<T> | undefined;
    if (!call) throw new Error("tool call function is required");
    return this.runTool(options, call);
  }

  private async runTool<T>(options: ToolCallOptions, call: TraceCall<T>): Promise<T> {
    const toolCallId = options.toolCallId ?? this.listener.nextId("tool");
    this.listener.emit({
      type: "tool_call_started",
      agentId: this.agentId,
      toolCallId,
      name: options.name,
      input: options.input,
    });
    try {
      const result = await call();
      this.listener.emit({
        type: "tool_call_result",
        agentId: this.agentId,
        toolCallId,
        ok: true,
        preview: defaultPreview(result),
      });
      return result;
    } catch (error) {
      this.listener.emit({
        type: "tool_call_result",
        agentId: this.agentId,
        toolCallId,
        ok: false,
        preview: errorMessage(error),
      });
      throw error;
    }
  }

  finish(finalText: string): void {
    this.finished = true;
    this.listener.emit({ type: "agent_finished", agentId: this.agentId, finalText });
  }

  error(error: unknown): void {
    this.listener.emit({ type: "error", agentId: this.agentId, message: errorMessage(error) });
  }

  isFinished(): boolean {
    return this.finished;
  }
}

export function createAgenticListener(sink: TraceSink, options?: AgenticListenerOptions): AgenticListener {
  return new AgenticListener(sink, options);
}

async function runAgentCallback<T>(agent: AgentTrace, fn: RunCallback<T>): Promise<T> {
  try {
    const result = await fn(agent);
    if (!agent.isFinished()) agent.finish(typeof result === "string" ? result : "done");
    return result;
  } catch (error) {
    agent.error(error);
    if (!agent.isFinished()) agent.finish("failed");
    throw error;
  }
}

function modelOptionsFromShorthand(input: string): ModelCallOptions {
  const [provider, ...modelParts] = input.split(":");
  if (modelParts.length === 0) return { model: input };
  return { provider, model: modelParts.join(":") };
}
