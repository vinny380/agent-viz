import type { WorldState, LogEntry } from "./store";

/**
 * MIND LOG — a persistent, color-coded, threaded transcript panel.
 *
 * This panel lives OUTSIDE the Game Boy's monochrome LCD, so colour is allowed
 * here: each agent gets its own hue (assigned by order of first appearance) and
 * subagents are indented under their parent so HERO → SCOUT reads like a
 * threaded conversation.
 *
 * It is stream-friendly: a rendered-count cursor means we only ever append DOM
 * nodes for genuinely new entries, and if the trailing entry's text grew
 * (coalesced streaming thinking/say), we patch that one node's text in place.
 */

// A small fixed palette of CRT-friendly hues. Agents are assigned a colour from
// this list in order of first appearance and the assignment is remembered.
const PALETTE = [
  "#8bff9b", // green   — typically the root HERO
  "#7fd0ff", // cyan
  "#ffd166", // amber
  "#ff9bd6", // pink
  "#b69bff", // violet
  "#9bffd6", // teal
  "#ffb38b", // orange
  "#d6ff8b", // lime
] as const;

// Warning colour for failed results (ok === false) and errors.
const WARN_COLOR = "#ff6b6b";

// Per-kind glyph prefixed to each entry.
const KIND_GLYPH: Record<LogEntry["kind"], string> = {
  think: "\u{1F9E0}", // 🧠
  say: "\u{1F4AC}", // 💬
  model: "◇", // ◇
  tool: "⚙", // ⚙
  result: "←", // ←
  final: "✓", // ✓
  error: "✖", // ✖
};

// Visual indent per depth level, in pixels.
const INDENT_PX = 18;

export interface MindLog {
  render(world: WorldState): void;
}

/**
 * Builds a MIND LOG bound to `container`. If the container exposes a
 * `.mindlog-body` child (the scroll region from the shell), entries render
 * there; otherwise they render directly into the container.
 */
export function createMindLog(container: HTMLElement): MindLog {
  const body = (container.querySelector<HTMLElement>(".mindlog-body") ?? container);

  // agentId → assigned colour. Order of insertion drives palette assignment.
  const colors = new Map<string, string>();
  // The DOM node for each rendered entry, indexed by log position, so we can
  // patch the trailing node's text in place when streaming text grows.
  const nodes: HTMLDivElement[] = [];
  // How many log entries we have already turned into DOM nodes.
  let renderedCount = 0;

  function colorFor(agentId: string): string {
    let c = colors.get(agentId);
    if (c === undefined) {
      c = PALETTE[colors.size % PALETTE.length]!;
      colors.set(agentId, c);
    }
    return c;
  }

  /** Composes the visible text for an entry: "LABEL glyph text". */
  function lineText(entry: LogEntry): string {
    const glyph = KIND_GLYPH[entry.kind];
    return `${entry.label} ${glyph} ${entry.text}`;
  }

  /** Applies colour, indent and warning state to a row for the given entry. */
  function style(node: HTMLDivElement, entry: LogEntry): void {
    const warn = entry.kind === "error" || (entry.kind === "result" && entry.ok === false);
    node.style.color = warn ? WARN_COLOR : colorFor(entry.agentId);
    node.style.marginLeft = `${entry.depth * INDENT_PX}px`;
  }

  function makeNode(entry: LogEntry): HTMLDivElement {
    const node = document.createElement("div");
    node.className = "mindlog-line";
    // Preserve newlines from multi-line tool output / final answers.
    node.style.whiteSpace = "pre-wrap";
    node.style.wordBreak = "break-word";
    style(node, entry);
    node.textContent = lineText(entry);
    return node;
  }

  function render(world: WorldState): void {
    const log = world.log;

    // If the world was reset (fewer entries than we have rendered), start over.
    if (log.length < renderedCount) {
      body.replaceChildren();
      nodes.length = 0;
      renderedCount = 0;
    }

    // The trailing entry may have grown (coalesced streaming text) since we last
    // rendered it; patch its node's text in place rather than re-appending.
    if (renderedCount > 0 && renderedCount <= log.length) {
      const lastIndex = renderedCount - 1;
      const entry = log[lastIndex];
      const node = nodes[lastIndex];
      if (entry !== undefined && node !== undefined) {
        const text = lineText(entry);
        if (node.textContent !== text) {
          node.textContent = text;
          style(node, entry);
        }
      }
    }

    // Append DOM nodes for any genuinely new entries.
    if (log.length > renderedCount) {
      const frag = document.createDocumentFragment();
      for (let i = renderedCount; i < log.length; i++) {
        const entry = log[i]!;
        const node = makeNode(entry);
        nodes[i] = node;
        frag.appendChild(node);
      }
      body.appendChild(frag);
      renderedCount = log.length;
    }

    // Auto-scroll to the bottom so the latest thought is always in view.
    body.scrollTop = body.scrollHeight;
  }

  return { render };
}
