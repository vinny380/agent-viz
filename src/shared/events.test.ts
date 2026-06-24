import { describe, it, expect } from "vitest";
import { isAgentEvent } from "./events";

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
});
