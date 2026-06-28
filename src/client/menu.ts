/* ───────────────────────────────────────────────────────────────────────────
   The Game Boy boot menu, drawn in Pixi on the LCD (so it gets the same chunky
   pixels + CRT filter as the arena). Navigable with the D-pad/keyboard via the
   shared input stream. START GAME hands off to the quest flow; the other items
   open simple text PAGES (OPTIONS / HIGH SCORES / CREDITS) dismissed with B.
   ─────────────────────────────────────────────────────────────────────────── */

import { Application, Container, Graphics, Text } from "pixi.js";
import type { Btn } from "./input";
import { blipMove, blipSelect, blipBack } from "./sound";

const DARK = 0x0f380f;
const MID = 0x306230;
const LIGHTEST = 0x9bbc0f;
const W = 320;
const H = 288;

export interface MenuItem { id: string; label: string; }

/** A text page (CREDITS / OPTIONS / HIGH SCORES). `onA` makes A do something
    (e.g. toggle a setting) instead of just closing the page. */
export interface Page { title: string; lines: string[]; onA?: () => void; }

export class Menu {
  readonly container = new Container();
  private gfx = new Graphics();
  private layer = new Container(); // text rebuilt each redraw
  private items: MenuItem[];
  private index = 0;
  private page: Page | null = null;
  private blinkOn = true;
  private onSelect: (id: string) => void;

  constructor(app: Application, items: MenuItem[], onSelect: (id: string) => void) {
    this.items = items;
    this.onSelect = onSelect;
    this.container.addChild(this.gfx, this.layer);
    app.stage.addChild(this.container);

    // Blink the selector arrow (~1.4Hz) for that idle-menu shimmer.
    let t = 0;
    app.ticker.add(() => {
      t += app.ticker.deltaMS;
      const on = Math.floor(t / 350) % 2 === 0;
      if (on !== this.blinkOn) {
        this.blinkOn = on;
        if (this.container.visible && !this.page) this.redraw();
      }
    });

    this.redraw();
  }

  get visible(): boolean { return this.container.visible; }
  set visible(v: boolean) {
    this.container.visible = v;
    if (v) { this.page = null; this.redraw(); }
  }

  openPage(p: Page): void { this.page = p; this.redraw(); }

  /** Route one button press. Returns nothing — side effects drive the UI. */
  handle(btn: Btn): void {
    if (this.page) {
      if (btn === "a" && this.page.onA) { this.page.onA(); blipSelect(); this.redraw(); return; }
      if (btn === "a" || btn === "b") { blipBack(); this.page = null; this.redraw(); }
      return;
    }
    const n = this.items.length;
    if (btn === "up") { this.index = (this.index - 1 + n) % n; blipMove(); this.redraw(); }
    else if (btn === "down" || btn === "select") { this.index = (this.index + 1) % n; blipMove(); this.redraw(); }
    else if (btn === "a") { blipSelect(); this.onSelect(this.items[this.index]!.id); }
    else if (btn === "start") { blipSelect(); this.onSelect("start"); }
  }

  private text(str: string, x: number, y: number, size: number, color: number, anchorX = 0): void {
    const t = new Text({ text: str, style: { fontFamily: "monospace", fontWeight: "bold", fontSize: size, fill: color } });
    t.anchor.set(anchorX, 0);
    t.x = x; t.y = y;
    this.layer.addChild(t);
  }

  private redraw(): void {
    this.gfx.clear();
    this.layer.removeChildren().forEach((c) => c.destroy());

    // LCD field + inner frame.
    this.gfx.rect(0, 0, W, H).fill(LIGHTEST);
    this.gfx.roundRect(6, 6, W - 12, H - 12, 6).stroke({ color: DARK, width: 2 });

    if (this.page) { this.drawPage(this.page); return; }

    // Title.
    this.text("AGENT QUEST", W / 2, 18, 16, DARK, 0.5);
    this.gfx.rect(20, 44, W - 40, 1).fill(MID);

    // Menu items.
    const startY = 66;
    const gap = 34;
    this.items.forEach((item, i) => {
      const y = startY + i * gap;
      if (i === this.index) {
        this.gfx.roundRect(12, y - 4, W - 24, 30, 3).fill(DARK);
        if (this.blinkOn) this.text(">", 22, y, 20, LIGHTEST);
        this.text(item.label, 44, y, 20, LIGHTEST);
      } else {
        this.text(item.label, 44, y, 20, DARK);
      }
    });

    // Footer.
    this.gfx.rect(20, H - 34, W - 40, 1).fill(MID);
    this.text("SELECT ITEM", 20, H - 26, 11, DARK);
    this.text("v1.0.0", W - 20, H - 26, 11, MID, 1);
  }

  private drawPage(p: Page): void {
    this.text(p.title, W / 2, 20, 16, DARK, 0.5);
    this.gfx.rect(20, 46, W - 40, 1).fill(MID);
    p.lines.forEach((line, i) => this.text(line, 22, 66 + i * 24, 13, DARK));
    this.gfx.rect(20, H - 34, W - 40, 1).fill(MID);
    this.text(p.onA ? "A: TOGGLE   B: BACK" : "B: BACK", 20, H - 26, 11, MID);
  }
}
