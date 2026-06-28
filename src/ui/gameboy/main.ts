import { Application } from "pixi.js";
import { Scene } from "./scene";
import { connect } from "./net";
import { createMindLog } from "./mindlog";
import { setupZoom } from "./zoom";
import { initialWorld, reduce, type WorldState } from "./store";
import { createFeedback } from "./feedback";

const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
const WS_URL = env?.VITE_TRACE_WS_URL ?? "ws://127.0.0.1:8788";

async function main() {
  // Fixed internal resolution: the 320x288 buffer is stretched to fill the
  // Game Boy's LCD by CSS (image-rendering: pixelated) for chunky pixels.
  const app = new Application();
  await app.init({ width: 320, height: 288, background: "#9bbc0f", antialias: false });
  const screen = document.getElementById("screen")!;
  screen.appendChild(app.canvas);

  const feedback = createFeedback();

  // Click-to-focus zoom on the LCD (chrome recedes, LCD lifts above a backdrop).
  setupZoom(screen, feedback);

  const scene = new Scene(app);

  // CRT terminal transcript beside the Game Boy (colour lives here, outside the LCD).
  const mindlog = createMindLog(document.getElementById("mindlog")!);

  let world: WorldState = initialWorld();
  scene.setWorld(world);
  mindlog.render(world);

  const net = connect(WS_URL, (event) => {
    feedback.event(event);
    world = reduce(world, event);
    scene.setWorld(world);
    mindlog.render(world);
  });

  // Quest prompt bar (lives in the page layout; keep the same startRun behavior).
  const input = document.getElementById("prompt-input") as HTMLInputElement;
  const btn = document.getElementById("prompt-go") as HTMLButtonElement;
  const go = () => {
    const quest = input.value.trim();
    if (quest) {
      feedback.ui("start");
      net.startRun(quest);
      input.value = "";
    }
  };
  btn.onclick = go;
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") go();
  });
}

main();
