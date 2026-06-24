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

// Sprite geometry tuned for the 320x288 LCD. The sprite is ~32px tall at
// scale 1.0; the ring is centered on its mid-height.
const RING_CY = -16;
const RING_R = 18;

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

export class Scene {
  private app: Application;
  private world: Container;
  private tethers: Graphics;
  private views = new Map<string, CharView>();
  private textures = new Map<string, Texture>();
  private tick = 0;

  constructor(app: Application) {
    this.app = app;
    this.world = new Container();
    this.tethers = new Graphics();
    this.world.addChild(this.tethers);
    app.stage.addChild(this.world);

    // Subtle CRT vibe; gentle so the green LCD stays readable at 320x288.
    app.stage.filters = [new CRTFilter({ curvature: 3, lineWidth: 1, lineContrast: 0.2, vignetting: 0.2, noise: 0.04 })];

    this.drawBackdrop();
    app.ticker.add(() => { this.tick += 1; this.animate(); });
  }

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
    const w = this.app.renderer.width, h = this.app.renderer.height;
    const roots = Object.values(world.agents).filter((a) => a.parentId === null);
    roots.forEach((r, i) => {
      pos.set(r.agentId, { x: w / 2, y: h * 0.32 + i * 14 });
      const kids = Object.values(world.agents).filter((a) => a.parentId === r.agentId);
      kids.forEach((k, j) => {
        // Fan up to ~3 children across the width without overflowing 320px.
        const spread = (j - (kids.length - 1) / 2) * 90;
        pos.set(k.agentId, { x: w / 2 + spread, y: h * 0.78 });
      });
    });
    // any deeper descendants: stack just below their parent if known
    for (const a of Object.values(world.agents)) {
      if (!pos.has(a.agentId) && a.parentId && pos.has(a.parentId)) {
        const p = pos.get(a.parentId)!;
        pos.set(a.agentId, { x: p.x, y: Math.min(h - 24, p.y + 70) });
      }
    }
    return pos;
  }

  private ensureView(agent: AgentState): CharView {
    let v = this.views.get(agent.agentId);
    if (v) return v;

    if (!this.textures.has(agent.agentId)) this.textures.set(agent.agentId, makeSpriteTexture(this.app, agent.agentId));
    const root = new Container();

    const sprite = new Sprite(this.textures.get(agent.agentId)!);
    sprite.anchor.set(0.5, 1);
    sprite.scale.set(1);

    const ring = new Graphics();
    const gauge = new Graphics();

    const nameText = new Text({ text: agent.label, style: { ...FONT, fontSize: 9, fontWeight: "bold" } });
    nameText.anchor.set(0.5, 1);
    nameText.y = -38;

    const phaseText = new Text({ text: "", style: { ...FONT, fontSize: 9 } });
    phaseText.anchor.set(0.5, 0);
    phaseText.y = 4;

    const stepText = new Text({ text: "", style: { ...FONT, fontSize: 8, fill: DMG_MID } });
    stepText.anchor.set(0.5, 0);
    stepText.y = 15;

    // Minimal in-LCD bubble: shows only the current tool name / short glyph,
    // capped narrow so it never overflows the 320px screen. Detailed text
    // lives in the MIND LOG outside the LCD.
    const bubble = new Container();
    const bubbleBg = new Graphics();
    bubble.addChild(bubbleBg);
    const bubbleText = new Text({ text: "", style: { ...FONT, fontSize: 8, fill: DMG_DARK } });
    bubbleText.x = 4; bubbleText.y = 2;
    bubble.addChild(bubbleText);
    bubble.x = 12; bubble.y = -52;
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

    // tethers parent → child, in DMG dark green
    this.tethers.clear();
    for (const a of Object.values(world.agents)) {
      if (a.parentId && pos.has(a.parentId) && pos.has(a.agentId)) {
        const p = pos.get(a.parentId)!, c = pos.get(a.agentId)!;
        this.tethers.moveTo(p.x, p.y).lineTo(c.x, c.y).stroke({ color: DMG_DARK, width: 1, alpha: 0.5 });
      }
    }

    for (const agent of Object.values(world.agents)) {
      const v = this.ensureView(agent);
      const p = pos.get(agent.agentId) ?? { x: 32, y: 32 };
      v.root.x = p.x; v.root.y = p.y;

      const color = PHASE_COLOR[agent.phase];
      // Monochrome LCD: dim idle sprites toward the mid green, keep others crisp.
      v.sprite.tint = agent.phase === "idle" ? DMG_MID : 0xffffff;

      // phase ring (DMG green)
      v.ring.clear();
      v.ring.circle(0, RING_CY, RING_R).stroke({ color, width: 2, alpha: 0.85 });

      v.phaseText.text = PHASE_LABEL[agent.phase];
      v.phaseText.style.fill = color;
      v.stepText.text = agent.step > 0 ? `STEP ${agent.step}` : "";

      // Bubble shows only the active tool name (narrow), nothing else.
      let bubbleStr = "";
      if (agent.phase === "acting" && agent.currentTool) bubbleStr = clip(agent.currentTool.name, 12);
      else if (agent.phase === "observing" && agent.currentTool) bubbleStr = clip(agent.currentTool.name, 12);

      v.bubble.visible = bubbleStr.length > 0;
      if (v.bubble.visible) {
        v.bubbleText.text = bubbleStr;
        const bg = (v.bubble as { __bg?: Graphics }).__bg!;
        const bw = Math.min(96, Math.max(28, v.bubbleText.width + 8));
        const bh = v.bubbleText.height + 4;
        bg.clear();
        bg.roundRect(0, 0, bw, bh, 2).fill({ color: DMG_LIGHTEST, alpha: 0.95 }).stroke({ color: DMG_DARK, width: 1 });
      }
    }

    // drop views for agents no longer present (rare; runs are additive)
    for (const id of [...this.views.keys()]) {
      if (!world.agents[id]) { this.views.get(id)!.root.destroy({ children: true }); this.views.delete(id); }
    }
  }

  /** Per-frame loop gauge: a marker orbiting each active character (one lap ≈ one ReAct step). */
  private animate() {
    for (const [id, v] of this.views) {
      const a = (this.lastWorld?.agents ?? {})[id];
      const active = a && (a.phase === "thinking" || a.phase === "acting" || a.phase === "observing");
      v.gauge.clear();
      if (!active) continue;
      const angle = (this.tick % 90) / 90 * Math.PI * 2;
      const cx = Math.cos(angle) * RING_R;
      const cy = RING_CY + Math.sin(angle) * RING_R;
      v.gauge.circle(cx, cy, 2.5).fill(DMG_DARK);
    }
  }

  private lastWorld: WorldState | null = null;
  setWorld(world: WorldState) { this.lastWorld = world; this.render(world); }
}

/** Clip a string to a narrow cap so it fits the 320px LCD. */
function clip(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}
