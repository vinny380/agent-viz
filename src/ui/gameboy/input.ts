/* ───────────────────────────────────────────────────────────────────────────
   Game Boy input. Turns the physical CSS buttons (D-pad / A / B / START /
   SELECT) AND the keyboard into one stream of `Btn` presses. The controller
   (main.ts) decides what each press does based on the current LCD mode.
   Keyboard is ignored while the user is typing in the quest input.
   ─────────────────────────────────────────────────────────────────────────── */

export type Btn = "up" | "down" | "left" | "right" | "a" | "b" | "start" | "select";

const KEY_MAP: Record<string, Btn> = {
  ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right",
  Enter: "a", z: "a", " ": "a",
  x: "b", Backspace: "b",
};

export function setupInput(onPress: (b: Btn) => void): void {
  const fire = (b: Btn, el?: Element | null) => { flash(el); onPress(b); };

  const bind = (sel: string, b: Btn) => {
    const el = document.querySelector<HTMLElement>(sel);
    el?.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      fire(b, el);
    });
  };

  // Face + shoulder buttons.
  bind(".gb-btn--a", "a");
  bind(".gb-btn--b", "b");
  bind(".gb-pill--start", "start");
  bind(".gb-pill--select", "select");

  // D-pad: four transparent hit zones over the cross arms (see index.html).
  document.querySelectorAll<HTMLElement>(".gb-dpad [data-dir]").forEach((zone) => {
    const dir = zone.dataset.dir as Btn;
    zone.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      fire(dir, zone.closest(".gb-dpad"));
    });
  });

  // (The LCD click is owned by main.ts: it zooms the console rather than firing
  // A, so clicking the screen enlarges the menu instead of selecting an item.)

  // Keyboard — but never steal keys while the player is typing a quest.
  window.addEventListener("keydown", (e) => {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
    const b = KEY_MAP[e.key];
    if (!b) return;
    e.preventDefault();
    fire(b);
  });
}

/** Brief depress animation on the pressed control. */
function flash(el?: Element | null): void {
  if (!el) return;
  el.classList.add("gb-pressed");
  setTimeout(() => el.classList.remove("gb-pressed"), 120);
}
