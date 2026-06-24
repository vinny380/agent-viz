import { Application } from "pixi.js";
import { Scene } from "./scene";
import { connect } from "./net";
import { initialWorld, reduce, type WorldState } from "./store";

const WS_URL = "ws://localhost:8787";

async function main() {
  // Fixed internal resolution: the 320x288 buffer is stretched to fill the
  // Game Boy's LCD by CSS (image-rendering: pixelated) for chunky pixels.
  const app = new Application();
  await app.init({ width: 320, height: 288, background: "#9bbc0f", antialias: false });
  document.getElementById("screen")!.appendChild(app.canvas);

  const scene = new Scene(app);
  let world: WorldState = initialWorld();
  scene.setWorld(world);

  const net = connect(WS_URL, (event) => {
    world = reduce(world, event);
    scene.setWorld(world);
  });

  // Quest prompt bar (lives in the page layout; keep the same startRun behavior).
  const input = document.getElementById("prompt-input") as HTMLInputElement;
  const btn = document.getElementById("prompt-go") as HTMLButtonElement;
  const go = () => {
    const quest = input.value.trim();
    if (quest) {
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
