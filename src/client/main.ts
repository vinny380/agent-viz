import { Application } from "pixi.js";
import { Scene } from "./scene";
import { connect } from "./net";
import { initialWorld, reduce, type WorldState } from "./store";

const WS_URL = "ws://localhost:8787";

async function main() {
  const app = new Application();
  await app.init({ resizeTo: window, background: 0x05030a, antialias: false });
  document.getElementById("app")!.appendChild(app.canvas);

  const scene = new Scene(app);
  let world: WorldState = initialWorld();
  scene.setWorld(world);

  const net = connect(WS_URL, (event) => {
    world = reduce(world, event);
    scene.setWorld(world);
  });

  // prompt input
  const bar = document.createElement("div");
  bar.style.cssText = "position:fixed;left:0;right:0;bottom:0;display:flex;gap:8px;padding:10px;background:#0a0f1ccc;font-family:monospace;z-index:10";
  const input = document.createElement("input");
  input.placeholder = "Give the hero a quest… (e.g. 'Read README.txt and tell me where the treasure is')";
  input.style.cssText = "flex:1;padding:10px;background:#101826;color:#9bd0ff;border:2px solid #48c9b0;font-family:monospace;font-size:14px";
  const btn = document.createElement("button");
  btn.textContent = "▶ START";
  btn.style.cssText = "padding:10px 18px;background:#48c9b0;color:#04121a;border:0;font-family:monospace;font-weight:bold;cursor:pointer";
  const go = () => { if (input.value.trim()) { net.startRun(input.value.trim()); input.value = ""; } };
  btn.onclick = go;
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
  bar.append(input, btn);
  document.body.appendChild(bar);
}

main();
