import { Application, Container, Graphics, Sprite, Text, type Texture } from "pixi.js";
import { CRTFilter } from "pixi-filters";
import { makeSpriteTexture } from "./sprites";
import type { WorldState, AgentState, Phase } from "./store";

const PHASE_COLOR: Record<Phase, number> = {
  idle: 0x6b7280,
  thinking: 0x9b59b6,
  acting: 0x48c9b0,
  observing: 0xf1c40f,
  finished: 0x2ecc71,
  error: 0xe74c3c,
};
const PHASE_LABEL: Record<Phase, string> = {
  idle: "IDLE", thinking: "THINK", acting: "ACT", observing: "OBSERVE", finished: "DONE", error: "ERROR",
};

const FONT = { fontFamily: "monospace", fill: 0xffffff } as const;

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

    // 90s CRT vibe
    app.stage.filters = [new CRTFilter({ curvature: 6, lineWidth: 2, lineContrast: 0.35, vignetting: 0.3, noise: 0.08 })];

    this.drawBackdrop();
    app.ticker.add(() => { this.tick += 1; this.animate(); });
  }

  private drawBackdrop() {
    const bg = new Graphics();
    const w = this.app.renderer.width, h = this.app.renderer.height;
    bg.rect(0, 0, w, h).fill(0x0a0f1c);
    const grid = 32;
    for (let x = 0; x <= w; x += grid) bg.rect(x, 0, 1, h).fill({ color: 0x14306b, alpha: 0.35 });
    for (let y = 0; y <= h; y += grid) bg.rect(0, y, w, 1).fill({ color: 0x14306b, alpha: 0.35 });
    this.world.addChildAt(bg, 0);
  }

  /** Lay agents out: root centered, children fanned beneath their parent. */
  private layout(world: WorldState): Map<string, { x: number; y: number }> {
    const pos = new Map<string, { x: number; y: number }>();
    const w = this.app.renderer.width, h = this.app.renderer.height;
    const roots = Object.values(world.agents).filter((a) => a.parentId === null);
    roots.forEach((r, i) => {
      pos.set(r.agentId, { x: w / 2, y: h / 2 - 60 + i * 20 });
      const kids = Object.values(world.agents).filter((a) => a.parentId === r.agentId);
      kids.forEach((k, j) => {
        const spread = (j - (kids.length - 1) / 2) * 220;
        pos.set(k.agentId, { x: w / 2 + spread, y: h / 2 + 150 });
      });
    });
    // any deeper descendants: stack below their parent if known
    for (const a of Object.values(world.agents)) {
      if (!pos.has(a.agentId) && a.parentId && pos.has(a.parentId)) {
        const p = pos.get(a.parentId)!;
        pos.set(a.agentId, { x: p.x, y: p.y + 160 });
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
    sprite.scale.set(2);

    const ring = new Graphics();
    const gauge = new Graphics();

    const nameText = new Text({ text: agent.label, style: { ...FONT, fontSize: 14, fontWeight: "bold" } });
    nameText.anchor.set(0.5, 1);
    nameText.y = -120;

    const phaseText = new Text({ text: "", style: { ...FONT, fontSize: 11 } });
    phaseText.anchor.set(0.5, 0);
    phaseText.y = 8;

    const stepText = new Text({ text: "", style: { ...FONT, fontSize: 10, fill: 0x9bd0ff } });
    stepText.anchor.set(0.5, 0);
    stepText.y = 22;

    const bubble = new Container();
    const bubbleBg = new Graphics();
    bubble.addChild(bubbleBg);
    const bubbleText = new Text({ text: "", style: { ...FONT, fontSize: 11, wordWrap: true, wordWrapWidth: 200, fill: 0x101418 } });
    bubbleText.x = 8; bubbleText.y = 6;
    bubble.addChild(bubbleText);
    bubble.x = 24; bubble.y = -150;
    bubble.visible = false;
    (bubble as any).__bg = bubbleBg;

    root.addChild(ring, gauge, sprite, nameText, phaseText, stepText, bubble);
    this.world.addChild(root);

    v = { root, sprite, nameText, phaseText, stepText, bubble, bubbleText, gauge, ring };
    this.views.set(agent.agentId, v);
    return v;
  }

  render(world: WorldState) {
    const pos = this.layout(world);

    // tethers parent → child
    this.tethers.clear();
    for (const a of Object.values(world.agents)) {
      if (a.parentId && pos.has(a.parentId) && pos.has(a.agentId)) {
        const p = pos.get(a.parentId)!, c = pos.get(a.agentId)!;
        this.tethers.moveTo(p.x, p.y).lineTo(c.x, c.y).stroke({ color: 0x48c9b0, width: 2, alpha: 0.5 });
      }
    }

    for (const agent of Object.values(world.agents)) {
      const v = this.ensureView(agent);
      const p = pos.get(agent.agentId) ?? { x: 100, y: 100 };
      v.root.x = p.x; v.root.y = p.y;

      const color = PHASE_COLOR[agent.phase];
      v.sprite.tint = agent.phase === "idle" ? 0x8899aa : 0xffffff;

      // phase ring
      v.ring.clear();
      v.ring.circle(0, -40, 46).stroke({ color, width: 3, alpha: 0.8 });

      v.phaseText.text = PHASE_LABEL[agent.phase];
      v.phaseText.style.fill = color;
      v.stepText.text = agent.step > 0 ? `STEP ${agent.step}` : "";

      // bubble shows live thinking, else current tool, else final text
      let bubbleStr = "";
      if (agent.phase === "thinking" && agent.thinkingText) bubbleStr = agent.thinkingText.slice(-180);
      else if (agent.phase === "acting" && agent.currentTool) bubbleStr = `⚙ ${agent.currentTool.name}(${preview(agent.currentTool.input)})`;
      else if (agent.phase === "observing" && agent.currentTool) bubbleStr = `← ${agent.currentTool.preview ?? ""}`;
      else if (agent.phase === "finished" && agent.finalText) bubbleStr = agent.finalText.slice(0, 180);
      else if (agent.phase === "error" && agent.error) bubbleStr = `✖ ${agent.error}`;

      v.bubble.visible = bubbleStr.length > 0;
      if (v.bubble.visible) {
        v.bubbleText.text = bubbleStr;
        const bg = (v.bubble as any).__bg as Graphics;
        const w = Math.min(216, Math.max(80, v.bubbleText.width + 16));
        const h = v.bubbleText.height + 12;
        bg.clear();
        bg.roundRect(0, 0, w, h, 6).fill({ color: 0xeef6ff, alpha: 0.95 }).stroke({ color, width: 2 });
      }
    }

    // drop views for agents no longer present (rare; runs are additive)
    for (const id of [...this.views.keys()]) {
      if (!world.agents[id]) { this.views.get(id)!.root.destroy({ children: true }); this.views.delete(id); }
    }
  }

  /** Per-frame loop gauge: a marker orbiting each character, one lap suggesting one ReAct step. */
  private animate() {
    for (const [id, v] of this.views) {
      const a = (this.lastWorld?.agents ?? {})[id];
      const active = a && (a.phase === "thinking" || a.phase === "acting" || a.phase === "observing");
      v.gauge.clear();
      if (!active) continue;
      const angle = (this.tick % 90) / 90 * Math.PI * 2;
      const cx = Math.cos(angle) * 46;
      const cy = -40 + Math.sin(angle) * 46;
      v.gauge.circle(cx, cy, 5).fill(PHASE_COLOR[a!.phase]);
    }
  }

  private lastWorld: WorldState | null = null;
  setWorld(world: WorldState) { this.lastWorld = world; this.render(world); }
}

function preview(input: unknown): string {
  const s = typeof input === "string" ? input : JSON.stringify(input);
  return s.length > 40 ? s.slice(0, 40) + "…" : s;
}
