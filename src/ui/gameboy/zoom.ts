/* ───────────────────────────────────────────────────────────────────────────
   Click-to-focus ZOOM + on-screen quest input.

   Normal view: the whole Game Boy is a big, inviting click target — click it
   anywhere (or press Enter) and the LCD lifts into a large focused view via a
   FLIP transform. Zooming reveals the quest input as a Game-Boy "dialogue box"
   docked on the screen, focused and ready to type. Exit via Esc, the X button,
   or clicking the dim backdrop. Honors prefers-reduced-motion (CSS) and is
   keyboard-operable.
   ─────────────────────────────────────────────────────────────────────────── */

const TARGET_VH = 0.84; // zoomed LCD fills ~84% of viewport height
// The LCD box is already a 10:9 (320:288) rectangle, so a uniform FLIP scale
// preserves the Pixi buffer aspect. A floor keeps the zoom perceptible on narrow
// viewports where the width clamp would otherwise barely enlarge it.
const MIN_SCALE = 1.25;

interface Geom {
  transform: string;
  // Where to dock the quest box (fixed coords), over the bottom of the zoomed LCD.
  promptLeft: number;
  promptWidth: number;
  promptBottom: number;
}

export interface ZoomControl {
  enter(): void;
  exit(): void;
  readonly zoomed: boolean;
}

/** Wire up zoom on the LCD element. Call once, after the canvas is mounted.
    The controller drives enter()/exit(); `onExit` fires when the user backs out
    via Esc / the X button / the backdrop so the controller can return to the menu. */
export function setupZoom(screenEl: HTMLElement, opts: { onExit?: () => void } = {}): ZoomControl {
  const device = screenEl.closest("#device") as HTMLElement | null;
  const backdrop = document.getElementById("zoom-backdrop");
  const closeBtn = document.getElementById("screen-close");
  const promptBox = document.getElementById("screen-prompt");
  const input = document.getElementById("prompt-input") as HTMLInputElement | null;
  if (!device || !backdrop || !closeBtn || !promptBox) {
    return { enter() {}, exit() {}, get zoomed() { return false; } };
  }

  let zoomed = false;

  /** FLIP geometry mapping the LCD onto the target box + the docked prompt rect. */
  const computeGeom = (): Geom => {
    const from = screenEl.getBoundingClientRect();

    // Target: a 10:9 box ~84vh tall, centered in the space LEFT of the MIND LOG
    // so the log stays uncovered.
    const targetH = window.innerHeight * TARGET_VH;
    const mindlog = document.getElementById("mindlog");
    const leftBound = 0;
    const rightBound = mindlog ? mindlog.getBoundingClientRect().left : window.innerWidth;
    const targetCx = (leftBound + rightBound) / 2;
    const targetCy = window.innerHeight / 2;

    const heightScale = targetH / from.height;
    const widthScale = ((rightBound - leftBound) * 0.94) / from.width;
    const s = Math.max(Math.min(heightScale, widthScale), MIN_SCALE);
    const fromCx = from.left + from.width / 2;
    const fromCy = from.top + from.height / 2;
    const dx = targetCx - fromCx;
    const dy = targetCy - fromCy;

    // The LCD's final on-screen rect (after scaling), used to dock the prompt.
    const finalW = from.width * s;
    const finalH = from.height * s;
    const lcdLeft = targetCx - finalW / 2;
    const lcdBottom = targetCy + finalH / 2;

    return {
      transform: `translate(${dx}px, ${dy}px) scale(${s})`,
      promptLeft: lcdLeft + finalW * 0.06,
      promptWidth: finalW * 0.88,
      promptBottom: window.innerHeight - lcdBottom + finalH * 0.05,
    };
  };

  const apply = () => {
    const g = computeGeom();
    screenEl.style.transform = g.transform;
    promptBox.style.left = `${g.promptLeft}px`;
    promptBox.style.width = `${g.promptWidth}px`;
    promptBox.style.bottom = `${g.promptBottom}px`;
  };

  const enter = () => {
    if (zoomed) return; // guard against re-entering while already zoomed
    zoomed = true;
    apply();
    device.classList.add("zoomed");
    backdrop.classList.add("visible");
    promptBox.classList.add("visible");
    screenEl.setAttribute("aria-label", "Exit zoom");
    // Focus the quest input so the player can type immediately.
    if (input) input.focus();
  };

  // Restore focus to the LCD only on keyboard-driven exit, so a mouse exit
  // doesn't flash the focus outline on the glass.
  const exit = (viaKeyboard = false) => {
    if (!zoomed) return;
    zoomed = false;
    screenEl.style.transform = ""; // transition back to none
    device.classList.remove("zoomed");
    backdrop.classList.remove("visible");
    promptBox.classList.remove("visible");
    screenEl.setAttribute("aria-label", "Zoom into the screen");
    if (viaKeyboard) screenEl.focus();
  };

  // User-initiated back-out (Esc / X / backdrop): exit AND notify the controller
  // so it can restore the boot menu.
  const userExit = (viaKeyboard = false) => {
    if (!zoomed) return;
    exit(viaKeyboard);
    opts.onExit?.();
  };

  // Esc exits when zoomed.
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && zoomed) userExit(true);
  });

  // X button and backdrop both exit. Stop the X click from bubbling (so it
  // doesn't read as an LCD/A press).
  closeBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    userExit();
  });
  backdrop.addEventListener("click", () => userExit());

  // Keep the LCD framed + the prompt docked across resizes while zoomed.
  window.addEventListener("resize", () => {
    if (zoomed) apply();
  });

  return { enter, exit: () => exit(false), get zoomed() { return zoomed; } };
}
