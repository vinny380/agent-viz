export function defaultTraceUrl(): string {
  return process.env.AGENT_VIZ_URL
    ?? process.env.VITE_TRACE_WS_URL
    ?? `ws://127.0.0.1:${process.env.AGENT_VIZ_PORT ?? "8788"}`;
}
