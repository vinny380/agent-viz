import WebSocket from "ws";
import type { AgentEventInput, ClientMessage } from "../shared/events";
import {
  createAgenticListener,
  type AgenticListener,
  type RunCallback,
  type RunInput,
  type TraceSink,
} from "./index";

export interface SimpleAgentViz {
  listener: AgenticListener;
  run<T>(input: RunInput, fn: RunCallback<T>): Promise<T>;
  close(): void;
}

export async function connectAgentViz(
  url = "ws://127.0.0.1:8788",
  options: { idPrefix?: string } = {},
): Promise<SimpleAgentViz> {
  const socket = new WebSocket(url);
  const queue: ClientMessage[] = [];

  const sink: TraceSink = (event: AgentEventInput) => {
    const message: ClientMessage = { type: "trace_event", event };
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
    else queue.push(message);
  };

  await new Promise<void>((resolve, reject) => {
    socket.once("open", () => {
      for (const message of queue.splice(0)) socket.send(JSON.stringify(message));
      resolve();
    });
    socket.once("error", reject);
  });

  const listener = createAgenticListener(sink, options);
  return {
    listener,
    run: listener.run.bind(listener),
    close: () => socket.close(),
  };
}
