import { describe, it, expect } from "vitest";
import { spriteMatrix, paletteFor } from "./sprite-data";

describe("sprite-data", () => {
  it("produces a 16x16 matrix", () => {
    const m = spriteMatrix("agent-1");
    expect(m).toHaveLength(16);
    for (const row of m) expect(row).toHaveLength(16);
  });
  it("is deterministic per id", () => {
    expect(spriteMatrix("agent-1")).toEqual(spriteMatrix("agent-1"));
    expect(paletteFor("agent-1")).toEqual(paletteFor("agent-1"));
  });
  it("differs across ids", () => {
    expect(spriteMatrix("agent-1")).not.toEqual(spriteMatrix("agent-2"));
  });
  it("is left-right symmetric (character faces forward)", () => {
    const m = spriteMatrix("agent-7");
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 8; x++)
        expect(m[y]![x]).toBe(m[y]![15 - x]);
  });
  it("only uses valid palette indices", () => {
    const pal = paletteFor("agent-3");
    for (const row of spriteMatrix("agent-3"))
      for (const idx of row) expect(idx).toBeLessThan(pal.length);
  });
});
