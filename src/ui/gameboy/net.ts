import { isAgentEvent, type AgentEvent, type ClientMessage } from "../../shared/events";

export function parseServerMessage(raw: string): AgentEvent | null {
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return null; }
  return isAgentEvent(value) ? value : null;
}

export function connect(url: string, onEvent: (e: AgentEvent) => void) {
  const ws = new WebSocket(url);
  ws.addEventListener("message", (m: MessageEvent) => {
    const event = parseServerMessage(String(m.data));
    if (event) onEvent(event);
  });
  const send = (msg: ClientMessage) => {
    const fire = () => ws.send(JSON.stringify(msg));
    if (ws.readyState === WebSocket.OPEN) fire();
    else ws.addEventListener("open", fire, { once: true });
  };
  return {
    startRun(prompt: string) { send({ type: "start_run", prompt }); },
    runExample(id: string) { send({ type: "run_example", id }); },
    close() { ws.close(); },
  };
}
