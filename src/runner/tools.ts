import { readdir, readFile } from "node:fs/promises";
import { resolve, relative, isAbsolute } from "node:path";
import type { ModelToolDef } from "./model";

export interface ToolOutcome { ok: boolean; preview: string; resultForModel: string; }
export interface ToolContext {
  sandboxDir: string;
  spawn: (task: string, role: string) => Promise<string>;
}
export type ToolExecutor = (input: any, ctx: ToolContext) => Promise<ToolOutcome>;

export interface ToolRegistry {
  defs: ModelToolDef[];
  execute(name: string, input: unknown, ctx: ToolContext): Promise<ToolOutcome>;
}

function preview(s: string, n = 80): string {
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length > n ? flat.slice(0, n) + "…" : flat;
}

/** Evaluate a strict arithmetic expression: digits, + - * / ( ) . and spaces only. */
function safeArithmetic(expr: string): number {
  if (!/^[\d+\-*/().\s]+$/.test(expr)) throw new Error("only arithmetic is allowed");
  // eslint-disable-next-line no-new-func
  const value = Function(`"use strict"; return (${expr});`)();
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error("not a finite number");
  return value;
}

function resolveInSandbox(sandboxDir: string, rel: string): string {
  if (isAbsolute(rel)) throw new Error("absolute paths are not allowed");
  const abs = resolve(sandboxDir, rel);
  const r = relative(sandboxDir, abs);
  if (r.startsWith("..") || isAbsolute(r)) throw new Error("path escapes the sandbox");
  return abs;
}

const EXECUTORS: Record<string, ToolExecutor> = {
  async calculate(input) {
    try {
      const value = safeArithmetic(String(input?.expression ?? ""));
      const out = String(value);
      return { ok: true, preview: out, resultForModel: out };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, preview: `error: ${msg}`, resultForModel: `Error: ${msg}` };
    }
  },

  async list_files(_input, ctx) {
    try {
      const entries = await readdir(ctx.sandboxDir, { withFileTypes: true });
      const list = entries.map((e) => (e.isDirectory() ? `${e.name}/` : e.name)).join("\n");
      return { ok: true, preview: preview(list), resultForModel: list || "(empty)" };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, preview: `error: ${msg}`, resultForModel: `Error: ${msg}` };
    }
  },

  async read_file(input, ctx) {
    try {
      const abs = resolveInSandbox(ctx.sandboxDir, String(input?.path ?? ""));
      const text = await readFile(abs, "utf8");
      return { ok: true, preview: preview(text), resultForModel: text };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, preview: `error: ${msg}`, resultForModel: `Error: ${msg}` };
    }
  },
};

const DEFS: ModelToolDef[] = [
  {
    name: "calculate",
    description: "Evaluate an arithmetic expression (numbers and + - * / ( ) only).",
    input_schema: {
      type: "object",
      properties: { expression: { type: "string", description: "e.g. (2 + 3) * 4" } },
      required: ["expression"],
    },
  },
  {
    name: "list_files",
    description: "List files in the sandbox working directory.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "read_file",
    description: "Read a UTF-8 text file from the sandbox by relative path.",
    input_schema: {
      type: "object",
      properties: { path: { type: "string", description: "relative path inside the sandbox" } },
      required: ["path"],
    },
  },
];

export function createToolRegistry(): ToolRegistry {
  const executors = { ...EXECUTORS };
  const defs = [...DEFS];
  return {
    defs,
    async execute(name, input, ctx) {
      const exec = executors[name];
      if (!exec) return { ok: false, preview: `unknown tool: ${name}`, resultForModel: `Error: unknown tool ${name}` };
      return exec(input, ctx);
    },
  };
}
