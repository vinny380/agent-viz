import { describe, it, expect } from "vitest";
import { parseServerMessage } from "./net";

describe("parseServerMessage", () => {
  it("parses a valid event", () => {
    const raw = JSON.stringify({ type: "loop_step_started", seq: 1, ts: 0, agentId: "a", step: 1 });
    expect(parseServerMessage(raw)?.type).toBe("loop_step_started");
  });
  it("returns null for invalid JSON", () => {
    expect(parseServerMessage("{not json")).toBeNull();
  });
  it("returns null for non-events", () => {
    expect(parseServerMessage(JSON.stringify({ hello: "world" }))).toBeNull();
  });
});
