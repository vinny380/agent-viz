import { describe, it, expect } from "vitest";
import { isAgentEvent, isAgentEventInput } from "./events";

describe("isAgentEvent", () => {
  it("accepts a well-formed event", () => {
    expect(isAgentEvent({ type: "thinking_delta", seq: 1, ts: 0, agentId: "a", text: "hi" })).toBe(true);
  });
  it("rejects an unknown type", () => {
    expect(isAgentEvent({ type: "nope", seq: 1, ts: 0, agentId: "a" })).toBe(false);
  });
  it("rejects non-objects", () => {
    expect(isAgentEvent(null)).toBe(false);
    expect(isAgentEvent("x")).toBe(false);
  });
  it("accepts unstamped event inputs for external listeners", () => {
    expect(isAgentEventInput({ type: "model_call_started", agentId: "a", modelCallId: "m1" })).toBe(true);
  });
  it("does not accept stamped events without seq and ts", () => {
    expect(isAgentEvent({ type: "model_call_started", agentId: "a", modelCallId: "m1" })).toBe(false);
  });
});
