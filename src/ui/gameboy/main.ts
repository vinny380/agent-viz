import { Application } from "pixi.js";
import { Scene } from "./scene";
import { connect } from "./net";
import { createMindLog } from "./mindlog";
import { setupZoom } from "./zoom";
import { setupInput, type Btn } from "./input";
import { Menu } from "./menu";
import { blip, blipBack, blipSelect } from "./sound";
import { initialWorld, reduce, type WorldState } from "./store";
import { createFeedback } from "./feedback";

const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
const WS_URL = env?.VITE_TRACE_WS_URL ?? "ws://127.0.0.1:8788";
const QUEST_KEY = "aq.quests"; // recent quests, for HIGH SCORES

const MENU_ITEMS = [
  { id: "start", label: "START GAME" },
  { id: "examples", label: "EXAMPLES" },
  { id: "options", label: "OPTIONS" },
  { id: "highscores", label: "HIGH SCORES" },
  { id: "credits", label: "CREDITS" },
  { id: "shutdown", label: "SHUT DOWN" },
];

// Demo agents the hub can spawn on our behalf (ids must match server EXAMPLES).
const EXAMPLES = [
  { id: "workflow", label: "WORKFLOW" },
  { id: "debate", label: "DEBATE SWARM" },
  { id: "incident", label: "INCIDENT" },
  { id: "langchain", label: "LANGCHAIN" },
  { id: "anthropic", label: "ANTHROPIC SDK" },
  { id: "openai", label: "OPENAI SDK" },
];

async function main() {
  // Fixed internal resolution: the 320x288 buffer is stretched to fill the
  // Game Boy's LCD by CSS (image-rendering: pixelated) for chunky pixels.
  const app = new Application();
  await app.init({ width: 320, height: 288, background: "#9bbc0f", antialias: false });
  const screen = document.getElementById("screen")!;
  screen.appendChild(app.canvas);

  // Audio + haptic feedback driven by the live agent event stream.
  const feedback = createFeedback();

  const scene = new Scene(app);
  scene.setArenaVisible(false); // boot to the menu, not an empty arena

  // CRT terminal transcript beside the Game Boy.
  const mindlog = createMindLog(document.getElementById("mindlog")!);

  let world: WorldState = initialWorld();
  scene.setWorld(world);
  mindlog.render(world);

  const net = connect(WS_URL, (event) => {
    feedback.event(event);
    world = reduce(world, event);
    scene.setWorld(world);
    mindlog.render(world);
    // A run starting (locally OR from an external producer) takes over the LCD,
    // so a watcher sitting on the menu doesn't miss it.
    if (event.type === "run_started") enterRunView();
  });

  // ── Console state machine: the LCD is either the boot MENU or the QUEST
  //    (agent arena). SHUT DOWN parks it in a powered-off state. ──────────────
  type Mode = "menu" | "quest";
  let mode: Mode = "menu";
  let poweredOff = false;
  let crtOn = true;

  const powerOverlay = document.getElementById("screen-power")!;

  const zoom = setupZoom(screen, { onExit: returnToMenu });
  const menu = new Menu(app, MENU_ITEMS, onSelect);

  // Clicking the LCD enlarges the console (and the menu with it) — it does NOT
  // pick a menu item. Items become mouse-clickable once zoomed.
  screen.addEventListener("click", () => {
    if (poweredOff || zoom.zoomed) return;
    zoom.enter();
    menu.pointerEnabled = true;
  });

  function startGame() {
    enterRunView();
    if (!zoom.zoomed) zoom.enter();
    zoom.setPrompt(true); // START GAME is the only thing that opens the chat
  }

  // Switch the LCD from the menu to the agent arena. Shared by START GAME and
  // any incoming run_started (e.g. an example launched from the menu).
  function enterRunView() {
    if (poweredOff) { poweredOff = false; powerOverlay.classList.remove("on"); }
    mode = "quest";
    menu.pointerEnabled = false;
    menu.visible = false;
    scene.setArenaVisible(true);
  }

  function openExamples() {
    menu.openPage({
      title: "EXAMPLES",
      items: EXAMPLES,
      onItem: (id) => net.runExample(id), // run_started will flip us to the arena
    });
  }

  function returnToMenu() {
    mode = "menu";
    zoom.setPrompt(false);
    menu.pointerEnabled = false;
    if (zoom.zoomed) zoom.exit();
    scene.setArenaVisible(false);
    menu.visible = true;
  }

  function openOptions() {
    const build = () => ({
      title: "OPTIONS",
      lines: [`CRT SCANLINES    ${crtOn ? "ON" : "OFF"}`, "", "SOUND            ON"],
      onA: () => { crtOn = !crtOn; scene.setCrt(crtOn); menu.openPage(build()); },
    });
    menu.openPage(build());
  }

  function openHighScores() {
    const quests: string[] = readQuests();
    const lines = quests.length
      ? quests.slice(-6).reverse().map((q, i) => `${i + 1}. ${clip(q, 24)}`)
      : ["NO QUESTS YET.", "", "BE THE FIRST HERO!"];
    menu.openPage({ title: "HIGH SCORES", lines });
  }

  function openCredits() {
    menu.openPage({
      title: "CREDITS",
      lines: ["AGENT QUEST", "", "A live view of a Claude", "agent on a quest.", "", "Built with PixiJS."],
    });
  }

  function shutDown() {
    poweredOff = true;
    menu.visible = false;
    scene.setArenaVisible(false);
    powerOverlay.classList.add("on");
    blipBack();
  }

  function powerOn() {
    poweredOff = false;
    powerOverlay.classList.remove("on");
    menu.visible = true;
    blip(180);
    blipSelect();
  }

  function onSelect(id: string) {
    if (id === "start") startGame();
    else if (id === "examples") openExamples();
    else if (id === "options") openOptions();
    else if (id === "highscores") openHighScores();
    else if (id === "credits") openCredits();
    else if (id === "shutdown") shutDown();
  }

  // Route every button press by mode.
  setupInput((btn: Btn) => {
    if (poweredOff) { powerOn(); return; }
    if (mode === "menu") { menu.handle(btn); return; }
    // QUEST mode: B or SELECT backs out to the menu.
    if (btn === "b" || btn === "select") returnToMenu();
  });

  // Quest prompt bar (shown docked on the LCD while zoomed).
  const input = document.getElementById("prompt-input") as HTMLInputElement;
  const goBtn = document.getElementById("prompt-go") as HTMLButtonElement;
  const go = () => {
    const quest = input.value.trim();
    if (!quest) return;
    net.startRun(quest);
    saveQuest(quest);
    input.value = "";
    blipSelect();
  };
  goBtn.onclick = go;
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") go();
    if (e.key === "Escape") returnToMenu();
  });
}

function readQuests(): string[] {
  try { return JSON.parse(localStorage.getItem(QUEST_KEY) ?? "[]"); } catch { return []; }
}

function saveQuest(quest: string): void {
  try {
    const all = [...readQuests(), quest].slice(-20);
    localStorage.setItem(QUEST_KEY, JSON.stringify(all));
  } catch { /* storage blocked — high scores just stay empty */ }
}

function clip(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

main();
