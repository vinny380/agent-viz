import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createToolRegistry, type ToolContext } from "./tools";

let dir: string;
let ctx: ToolContext;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "aq-"));
  writeFileSync(join(dir, "hello.txt"), "world");
  ctx = { sandboxDir: dir, spawn: async () => "unused" };
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("tool registry", () => {
  const reg = createToolRegistry();

  it("exposes tool defs with schemas", () => {
    const names = reg.defs.map((d) => d.name).sort();
    expect(names).toContain("calculate");
    expect(names).toContain("list_files");
    expect(names).toContain("read_file");
  });

  it("calculate evaluates arithmetic", async () => {
    const out = await reg.execute("calculate", { expression: "2 + 3 * 4" }, ctx);
    expect(out.ok).toBe(true);
    expect(out.resultForModel).toBe("14");
  });

  it("calculate rejects non-arithmetic input", async () => {
    const out = await reg.execute("calculate", { expression: "process.exit(1)" }, ctx);
    expect(out.ok).toBe(false);
  });

  it("list_files lists the sandbox", async () => {
    const out = await reg.execute("list_files", {}, ctx);
    expect(out.ok).toBe(true);
    expect(out.resultForModel).toContain("hello.txt");
  });

  it("read_file reads inside the sandbox", async () => {
    const out = await reg.execute("read_file", { path: "hello.txt" }, ctx);
    expect(out.ok).toBe(true);
    expect(out.resultForModel).toBe("world");
  });

  it("read_file blocks path traversal", async () => {
    const out = await reg.execute("read_file", { path: "../../etc/passwd" }, ctx);
    expect(out.ok).toBe(false);
  });

  it("reports unknown tools", async () => {
    const out = await reg.execute("nope", {}, ctx);
    expect(out.ok).toBe(false);
  });
});
