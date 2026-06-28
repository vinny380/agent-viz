import type { WorldState, LogEntry } from "./store";

/**
 * MIND LOG — a threaded, graph-style transcript of the agent run.
 *
 * Each entry renders as a row in an interaction tree (think Sentry spans):
 *   • a left RAIL of connector lines, indented + coloured by the agent's hue,
 *     so HERO → SCOUT reads as a threaded conversation;
 *   • a colour-coded ICON BADGE keyed to the entry KIND, so thinking, tool
 *     calls, tool results and final answers are distinguishable at a glance;
 *   • a title (agent label · kind) and the inline message/preview text.
 *
 * It is stream-friendly: a rendered-count cursor means we only append DOM for
 * genuinely new entries, and if the trailing entry's text grew (coalesced
 * streaming thinking/say) we patch just that row's text node in place.
 */

// A small fixed palette of CRT-friendly hues for the per-agent thread rails.
// Agents are assigned a colour in order of first appearance.
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

// Per-kind presentation: badge glyph, accent colour, and a human title tag.
const KIND: Record<LogEntry["kind"], { glyph: string; color: string; tag: string }> = {
  think: { glyph: "\u{1F9E0}", color: "#b69bff", tag: "thinking" },
  say: { glyph: "\u{1F4AC}", color: "#7fd0ff", tag: "message" },
  model: { glyph: "◇", color: "#9b8bff", tag: "llm" },
  tool: { glyph: "⚙", color: "#ffb38b", tag: "tool" },
  result: { glyph: "←", color: "#9bffd6", tag: "result" },
  final: { glyph: "✓", color: "#8bff9b", tag: "final" },
  error: { glyph: "✖", color: WARN_COLOR, tag: "error" },
};

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
  // The .ml-text node for each rendered row, indexed by log position, so we can
  // patch the trailing one in place when streaming text grows.
  const textNodes: HTMLElement[] = [];
  // How many log entries we have already turned into DOM rows.
  let renderedCount = 0;

  function colorFor(agentId: string): string {
    let c = colors.get(agentId);
    if (c === undefined) {
      c = PALETTE[colors.size % PALETTE.length]!;
      colors.set(agentId, c);
    }
    return c;
  }

  /** Accent colour for an entry's icon — kind colour, or warn for failures. */
  function accentFor(entry: LogEntry): string {
    const warn = entry.kind === "error" || (entry.kind === "result" && entry.ok === false);
    return warn ? WARN_COLOR : KIND[entry.kind].color;
  }

  function makeRow(entry: LogEntry): { row: HTMLDivElement; text: HTMLElement } {
    const hue = colorFor(entry.agentId);
    const accent = accentFor(entry);

    const row = document.createElement("div");
    row.className = "ml-row";
    row.dataset.kind = entry.kind;

    // Left rail: one connector cell per ancestor depth, coloured by agent hue.
    // The last cell (--branch) tees an elbow into the node.
    for (let d = 0; d < entry.depth; d++) {
      const guide = document.createElement("span");
      guide.className = d === entry.depth - 1 ? "ml-guide ml-guide--branch" : "ml-guide";
      guide.style.setProperty("--thread", hue);
      row.appendChild(guide);
    }

    const node = document.createElement("div");
    node.className = "ml-node";

    const icon = document.createElement("span");
    icon.className = "ml-icon";
    icon.style.setProperty("--accent", accent);
    icon.textContent = KIND[entry.kind].glyph;

    const main = document.createElement("div");
    main.className = "ml-main";

    const title = document.createElement("div");
    title.className = "ml-title";
    title.style.color = hue;
    title.textContent = `${entry.label} · ${KIND[entry.kind].tag}`;

    const text = document.createElement("div");
    text.className = "ml-text";
    text.textContent = entry.text;

    main.append(title, text);
    node.append(icon, main);
    row.appendChild(node);

    return { row, text };
  }

  function render(world: WorldState): void {
    const log = world.log;

    // If the world was reset (fewer entries than we have rendered), start over.
    if (log.length < renderedCount) {
      body.replaceChildren();
      textNodes.length = 0;
      renderedCount = 0;
    }

    // The trailing entry may have grown (coalesced streaming text); patch just
    // its text node rather than re-appending the row.
    if (renderedCount > 0 && renderedCount <= log.length) {
      const lastIndex = renderedCount - 1;
      const entry = log[lastIndex];
      const text = textNodes[lastIndex];
      if (entry !== undefined && text !== undefined && text.textContent !== entry.text) {
        text.textContent = entry.text;
      }
    }

    // Append rows for any genuinely new entries.
    if (log.length > renderedCount) {
      const frag = document.createDocumentFragment();
      for (let i = renderedCount; i < log.length; i++) {
        const { row, text } = makeRow(log[i]!);
        textNodes[i] = text;
        frag.appendChild(row);
      }
      body.appendChild(frag);
      renderedCount = log.length;
    }

    // Auto-scroll to the bottom so the latest thought is always in view.
    body.scrollTop = body.scrollHeight;
  }

  return { render };
}
