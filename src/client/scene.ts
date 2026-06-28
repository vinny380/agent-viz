import { Application, Container, Graphics, Sprite, Text, type Texture } from "pixi.js";
import { CRTFilter } from "pixi-filters";
import { makeSpriteTexture } from "./sprites";
import type { WorldState, AgentState, Phase } from "./store";

// Authentic Game Boy DMG ramp (darkest → lightest).
const DMG_DARK = 0x0f380f; // outlines, active, text, tethers
const DMG_MID = 0x306230; // secondary / idle / grid
const DMG_LIGHT = 0x8bac0f; // faint grid, dim accents
const DMG_LIGHTEST = 0x9bbc0f; // LCD backdrop

// The LCD is monochrome: phase is read from the LABEL + animation, not hue.
// Active phases use the darkest green; idle/terminal states use the mid green.
const PHASE_COLOR: Record<Phase, number> = {
  idle: DMG_MID,
  thinking: DMG_DARK,
  acting: DMG_DARK,
  observing: DMG_DARK,
  finished: DMG_MID,
  error: DMG_DARK,
};
const PHASE_LABEL: Record<Phase, string> = {
  idle: "IDLE", thinking: "THINK", acting: "ACT", observing: "OBSERVE", finished: "DONE", error: "ERROR",
};

const FONT = { fontFamily: "monospace", fill: DMG_DARK } as const;

// Sprite geometry tuned for the 320x288 LCD (downscaled into a small physical
// screen, so the characters are drawn large). Sprite ~48px tall at scale 1.5;
// the phase ring is centered on its mid-height.
const SPRITE_SCALE = 1.5;
const RING_CY = -24;
const RING_R = 24;
// Base horizontal gap between sibling subagents (clamped to fit the 320px LCD).
const CHILD_SPREAD = 106;

interface CharView {
  root: Container;
  sprite: Sprite;
  nameText: Text;
  phaseText: Text;
  stepText: Text;
  bubble: Container;
  bubbleText: Text;
  gauge: Graphics;
  ring: Graphics;
}

// Subagent spawn portal: a brief expanding-ring "summon" + sprite fade/scale-in.
const PORTAL_MS = 500;
// Result-return token: a small px square that rides the tether child→parent.
const TOKEN_MS = 600;

/** A one-shot expanding-ring portal played the first time a subagent appears. */
interface PortalFx {
  agentId: string;
  ms: number; // elapsed; clamped at PORTAL_MS
}

/** A one-shot token traveling along a tether from a finished child to its parent. */
interface TokenFx {
  agentId: string; // the finished child
  ms: number; // elapsed; clamped at TOKEN_MS
}

export class Scene {
  private app: Application;
  private world: Container;
  private crt: CRTFilter;
  private tethers: Graphics;
  private fx: Graphics; // portal rings + result-return tokens, above tethers/below sprites
  private views = new Map<string, CharView>();
  private textures = new Map<string, Texture>();
  private tick = 0;

  // --- subagent juice (ticker-driven, layered on top of per-agent views) ---
  // Latest layout positions, cached so the ticker can animate tethers/tokens
  // between renders without recomputing layout.
  private positions = new Map<string, { x: number; y: number }>();
  // Per-agent max name width (px), so each label is clipped to fit its column
  // and never collides with a sibling's. Computed by layout(), used by render().
  private nameMaxW = new Map<string, number>();
  // Subagents (depth>0) whose spawn portal has already played, so it fires once.
  private portalPlayed = new Set<string>();
  // Subagents whose result-return token has already played, so it fires once.
  private tokenPlayed = new Set<string>();
  private portals: PortalFx[] = [];
  private tokens: TokenFx[] = [];

  constructor(app: Application) {
    this.app = app;
    this.world = new Container();
    this.tethers = new Graphics();
    this.fx = new Graphics();
    this.world.addChild(this.tethers);
    this.world.addChild(this.fx);
    app.stage.addChild(this.world);

    // Subtle CRT vibe; gentle so the green LCD stays readable at 320x288.
    this.crt = new CRTFilter({ curvature: 3, lineWidth: 1, lineContrast: 0.2, vignetting: 0.2, noise: 0.04 });
    app.stage.filters = [this.crt];

    this.drawBackdrop();
    app.ticker.add(() => { this.tick += 1; this.animate(); });
  }

  /** Show/hide the agent arena (hidden while the boot menu is up). */
  setArenaVisible(visible: boolean) { this.world.visible = visible; }

  /** Toggle the CRT scanline filter (driven by the OPTIONS menu). */
  setCrt(on: boolean) { this.app.stage.filters = on ? [this.crt] : []; }

  private drawBackdrop() {
    const bg = new Graphics();
    const w = this.app.renderer.width, h = this.app.renderer.height;
    bg.rect(0, 0, w, h).fill(DMG_LIGHTEST);
    const grid = 16;
    for (let x = 0; x <= w; x += grid) bg.rect(x, 0, 1, h).fill({ color: DMG_LIGHT, alpha: 0.4 });
    for (let y = 0; y <= h; y += grid) bg.rect(0, y, w, 1).fill({ color: DMG_LIGHT, alpha: 0.4 });
    this.world.addChildAt(bg, 0);
  }

  /** Lay agents out for a 320x288 LCD: root near the top, children fanned beneath. */
  private layout(world: WorldState): Map<string, { x: number; y: number }> {
    const pos = new Map<string, { x: number; y: number }>();
    this.nameMaxW = new Map<string, number>();
    const w = this.app.renderer.width, h = this.app.renderer.height;
    const roots = Object.values(world.agents).filter((a) => a.parentId === null);
    roots.forEach((r, i) => {
      pos.set(r.agentId, { x: w / 2, y: h * 0.34 + i * 16 });
      this.nameMaxW.set(r.agentId, 200); // root is centered & alone: plenty of room
      const kids = Object.values(world.agents).filter((a) => a.parentId === r.agentId);
      const n = kids.length;
      // Fan children across the width. Clamp the gap so the OUTERMOST sprite+label
      // stays on-screen even with 4+ children (otherwise names run off the LCD).
      const maxHalf = w / 2 - 50;
      const step = n > 1 ? Math.min(CHILD_SPREAD, (maxHalf * 2) / (n - 1)) : 0;
      kids.forEach((k, j) => {
        const spread = (j - (n - 1) / 2) * step;
        pos.set(k.agentId, { x: w / 2 + spread, y: h * 0.82 });
        // A name must fit its column so it never collides with a neighbor's.
        this.nameMaxW.set(k.agentId, n > 1 ? Math.max(46, step - 12) : 160);
      });
    });
    // any deeper descendants: stack just below their parent if known
    for (const a of Object.values(world.agents)) {
      if (!pos.has(a.agentId) && a.parentId && pos.has(a.parentId)) {
        const p = pos.get(a.parentId)!;
        pos.set(a.agentId, { x: p.x, y: Math.min(h - 24, p.y + 70) });
        this.nameMaxW.set(a.agentId, 120);
      }
    }
    return pos;
  }

  private ensureView(agent: AgentState): CharView {
    let v = this.views.get(agent.agentId);
    if (v) return v;

    // The root HERO uses a stable sprite seed so it always looks like the SAME
    // hero across quests (each run gets a fresh agentId, but the hero is constant).
    const spriteKey = agent.depth === 0 ? "HERO" : agent.agentId;
    if (!this.textures.has(spriteKey)) this.textures.set(spriteKey, makeSpriteTexture(this.app, spriteKey));
    const root = new Container();

    const sprite = new Sprite(this.textures.get(spriteKey)!);
    sprite.anchor.set(0.5, 1);
    sprite.scale.set(SPRITE_SCALE);

    const ring = new Graphics();
    const gauge = new Graphics();

    const nameText = new Text({ text: agent.label, style: { ...FONT, fontSize: 11, fontWeight: "bold" } });
    nameText.anchor.set(0.5, 1);
    nameText.y = -56;

    const phaseText = new Text({ text: "", style: { ...FONT, fontSize: 11, fontWeight: "bold" } });
    phaseText.anchor.set(0.5, 0);
    phaseText.y = 6;

    const stepText = new Text({ text: "", style: { ...FONT, fontSize: 9, fill: DMG_MID } });
    stepText.anchor.set(0.5, 0);
    stepText.y = 22;

    // Minimal in-LCD bubble: shows only the current tool name / short glyph,
    // capped narrow so it never overflows the 320px screen. Detailed text
    // lives in the MIND LOG outside the LCD.
    const bubble = new Container();
    const bubbleBg = new Graphics();
    bubble.addChild(bubbleBg);
    const bubbleText = new Text({ text: "", style: { ...FONT, fontSize: 11, fill: DMG_DARK } });
    bubbleText.x = 6; bubbleText.y = 3;
    bubble.addChild(bubbleText);
    bubble.x = 16; bubble.y = -74;
    bubble.visible = false;
    (bubble as { __bg?: Graphics }).__bg = bubbleBg;

    root.addChild(ring, gauge, sprite, nameText, phaseText, stepText, bubble);
    this.world.addChild(root);

    v = { root, sprite, nameText, phaseText, stepText, bubble, bubbleText, gauge, ring };
    this.views.set(agent.agentId, v);
    return v;
  }

  render(world: WorldState) {
    const pos = this.layout(world);
    // Cache positions so the ticker can animate tethers/tokens between renders.
    this.positions = pos;

    // Tethers are now drawn by the ticker (animate) so they can pulse while a
    // subagent is active; clear any stale draw here.
    this.tethers.clear();

    for (const agent of Object.values(world.agents)) {
      // Spawn portal: fire once the first time a subagent (depth>0) appears.
      if (agent.depth > 0 && !this.portalPlayed.has(agent.agentId)) {
        this.portalPlayed.add(agent.agentId);
        this.portals.push({ agentId: agent.agentId, ms: 0 });
      }
      // Result return: when a subagent reaches "finished", send one token back.
      if (agent.depth > 0 && agent.phase === "finished" && !this.tokenPlayed.has(agent.agentId)) {
        this.tokenPlayed.add(agent.agentId);
        this.tokens.push({ agentId: agent.agentId, ms: 0 });
      }
    }

    for (const agent of Object.values(world.agents)) {
      const v = this.ensureView(agent);
      const p = pos.get(agent.agentId) ?? { x: 32, y: 32 };
      v.root.x = p.x; v.root.y = p.y;

      // Clip the name to its column width so siblings never overlap (see layout()).
      fitText(v.nameText, agent.label, this.nameMaxW.get(agent.agentId) ?? 120);

      const color = PHASE_COLOR[agent.phase];
      // Monochrome LCD: dim idle sprites toward the mid green, keep others crisp.
      v.sprite.tint = agent.phase === "idle" ? DMG_MID : 0xffffff;

      // phase ring (DMG green)
      v.ring.clear();
      v.ring.circle(0, RING_CY, RING_R).stroke({ color, width: 2, alpha: 0.85 });

      v.phaseText.text = PHASE_LABEL[agent.phase];
      v.phaseText.style.fill = color;
      v.stepText.text = agent.step > 0 ? `STEP ${agent.step}` : "";

      // Bubble: the agent's FINAL answer once it finishes; otherwise the active
      // tool name while it works. Final text wraps and is clipped to fit the tiny
      // LCD — the complete answer always lives in the MIND LOG.
      let bubbleStr = "";
      let isResult = false;
      if (agent.phase === "finished" && agent.finalText && agent.finalText.trim()) {
        // Keep results to ~2 lines so up to four bubbles coexist on the 320px LCD.
        const maxChars = agent.depth === 0 ? 56 : 33;
        bubbleStr = clip(agent.finalText.replace(/\s+/g, " ").trim(), maxChars);
        isResult = true;
      } else if ((agent.phase === "acting" || agent.phase === "observing") && agent.currentTool) {
        bubbleStr = clip(agent.currentTool.name, 12);
      }

      v.bubble.visible = bubbleStr.length > 0;
      if (v.bubble.visible) {
        const maxW = isResult ? (agent.depth === 0 ? 200 : 100) : 150;
        v.bubbleText.text = bubbleStr;
        v.bubbleText.style.wordWrap = isResult;
        v.bubbleText.style.wordWrapWidth = maxW - 12;
        v.bubbleText.style.fontSize = isResult ? 10 : 11;

        const bg = (v.bubble as { __bg?: Graphics }).__bg!;
        const bw = Math.min(maxW, Math.max(36, v.bubbleText.width + 12));
        const bh = v.bubbleText.height + 7;
        bg.clear();
        bg.roundRect(0, 0, bw, bh, 3).fill({ color: DMG_LIGHTEST, alpha: 0.96 }).stroke({ color: DMG_DARK, width: 1 });

        if (isResult) {
          // Center the result bubble on the agent, sitting ABOVE its name label,
          // clamped inside the LCD. The hero (top) lands near the top edge and the
          // subagents (bottom) land in the middle band, so they never collide.
          const W = this.app.renderer.width, H = this.app.renderer.height;
          const bx = Math.max(2, Math.min(W - bw - 2, p.x - bw / 2));
          const by = Math.max(2, Math.min(H - bh - 2, p.y - 72 - bh));
          v.bubble.x = bx - p.x;
          v.bubble.y = by - p.y;
        } else {
          v.bubble.x = 16;
          v.bubble.y = -74;
        }
      }
    }

    // drop views for agents no longer present (rare; runs are additive)
    for (const id of [...this.views.keys()]) {
      if (!world.agents[id]) {
        this.views.get(id)!.root.destroy({ children: true });
        this.views.delete(id);
        this.portalPlayed.delete(id);
        this.tokenPlayed.delete(id);
        this.portals = this.portals.filter((p) => p.agentId !== id);
        this.tokens = this.tokens.filter((t) => t.agentId !== id);
      }
    }
  }

  /**
   * Per-frame juice, all DMG-green and driven from `lastWorld` + cached layout:
   *  - the loop gauge orbiting each active character (one lap ≈ one ReAct step),
   *  - pulsing parent→child tethers while a subagent is active (static/dim otherwise),
   *  - expanding-ring spawn portals + sprite fade/scale-in for new subagents,
   *  - result-return tokens riding the tether child→parent when a subagent finishes,
   *  - dimming a subagent's sprite once its return token has landed.
   */
  private animate() {
    const dt = this.app.ticker.deltaMS;
    const agents = this.lastWorld?.agents ?? {};

    this.drawTethers(agents);

    // Advance portal + token timelines (consumed by sprite styling below).
    for (const p of this.portals) p.ms = Math.min(PORTAL_MS, p.ms + dt);
    for (const t of this.tokens) t.ms = Math.min(TOKEN_MS, t.ms + dt);

    this.fx.clear();
    this.drawPortals();
    this.drawTokens(agents);

    // active-by-id for the spent-token dim check
    for (const [id, v] of this.views) {
      const a = agents[id];

      // Loop gauge: a marker orbiting each active character.
      const active = a && (a.phase === "thinking" || a.phase === "acting" || a.phase === "observing");
      v.gauge.clear();
      if (active) {
        const angle = (this.tick % 90) / 90 * Math.PI * 2;
        const cx = Math.cos(angle) * RING_R;
        const cy = RING_CY + Math.sin(angle) * RING_R;
        v.gauge.circle(cx, cy, 3.5).fill(DMG_DARK);
      }

      // Sprite fade/scale for subagents: portal scale-in, then dim once returned.
      if (a && a.depth > 0) {
        const portal = this.portals.find((p) => p.agentId === id);
        if (portal) {
          // ease-out scale-in + fade over the portal lifetime
          const k = portal.ms / PORTAL_MS;
          const e = 1 - (1 - k) * (1 - k);
          v.sprite.alpha = e;
          v.sprite.scale.set(0.4 + 0.6 * e);
        } else {
          v.sprite.scale.set(1);
          const tokenLanded = a.phase === "finished" && !this.tokens.some((t) => t.agentId === id);
          v.sprite.alpha = tokenLanded ? 0.45 : 1;
        }
      }
    }

    // Reap finished one-shot FX.
    this.portals = this.portals.filter((p) => p.ms < PORTAL_MS);
    this.tokens = this.tokens.filter((t) => t.ms < TOKEN_MS);
  }

  /**
   * Parent→child tethers in DMG dark green. While a subagent's phase is active
   * we pulse the tether (moving dash gaps + breathing alpha); finished/idle
   * subagents get a static, dim line.
   */
  private drawTethers(agents: Record<string, AgentState>) {
    this.tethers.clear();
    for (const a of Object.values(agents)) {
      if (!a.parentId) continue;
      const p = this.positions.get(a.parentId);
      const c = this.positions.get(a.agentId);
      if (!p || !c) continue;

      const activePhase = a.phase === "thinking" || a.phase === "acting" || a.phase === "observing";
      if (activePhase) {
        // Pulsing animated dash: draw dashes whose offset scrolls along the line.
        const dx = c.x - p.x, dy = c.y - p.y;
        const len = Math.hypot(dx, dy) || 1;
        const ux = dx / len, uy = dy / len;
        const period = 10; // dash + gap, in px
        const offset = (this.tick * 0.6) % period;
        const alpha = 0.55 + 0.35 * Math.sin(this.tick * 0.15); // breathing
        for (let d = offset - period; d < len; d += period) {
          const s = Math.max(0, d), e = Math.min(len, d + period / 2);
          if (e <= s) continue;
          this.tethers
            .moveTo(p.x + ux * s, p.y + uy * s)
            .lineTo(p.x + ux * e, p.y + uy * e)
            .stroke({ color: DMG_DARK, width: 1, alpha });
        }
      } else {
        // Static, dim tether for idle / finished subagents.
        this.tethers.moveTo(p.x, p.y).lineTo(c.x, c.y).stroke({ color: DMG_DARK, width: 1, alpha: 0.3 });
      }
    }
  }

  /** Expanding-ring "summon portal" at each new subagent's position. */
  private drawPortals() {
    for (const portal of this.portals) {
      const c = this.positions.get(portal.agentId);
      if (!c) continue;
      const k = portal.ms / PORTAL_MS; // 0 → 1
      const r = 4 + k * (RING_R + 10);
      const alpha = (1 - k) * 0.9;
      // Centered on the sprite mid-height (matches the per-agent phase ring).
      this.fx.circle(c.x, c.y + RING_CY, r).stroke({ color: DMG_DARK, width: 2, alpha });
      // a second, trailing ring for a touch more juice
      const r2 = 2 + k * (RING_R + 2);
      this.fx.circle(c.x, c.y + RING_CY, r2).stroke({ color: DMG_DARK, width: 1, alpha: alpha * 0.6 });
    }
  }

  /** A small px square riding the tether from a finished child up to its parent. */
  private drawTokens(agents: Record<string, AgentState>) {
    for (const token of this.tokens) {
      const child = agents[token.agentId];
      if (!child || !child.parentId) continue;
      const c = this.positions.get(token.agentId);
      const p = this.positions.get(child.parentId);
      if (!c || !p) continue;
      const k = token.ms / TOKEN_MS; // 0 (at child) → 1 (at parent)
      const x = c.x + (p.x - c.x) * k;
      const y = (c.y + RING_CY) + ((p.y + RING_CY) - (c.y + RING_CY)) * k;
      this.fx.rect(x - 2.5, y - 2.5, 5, 5).fill(DMG_DARK);
    }
  }

  private lastWorld: WorldState | null = null;
  setWorld(world: WorldState) { this.lastWorld = world; this.render(world); }
}

/** Clip a string to a narrow cap so it fits the 320px LCD. */
function clip(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

/** Trim a Text's content with an ellipsis until it renders within maxWidth (px). */
function fitText(t: Text, full: string, maxWidth: number): void {
  if (t.text !== full) t.text = full; // reset (maxWidth may have grown)
  if (t.width <= maxWidth) return;
  let s = full;
  while (s.length > 1) {
    s = s.slice(0, -1);
    t.text = s + "…";
    if (t.width <= maxWidth) return;
  }
}
