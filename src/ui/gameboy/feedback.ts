import type { AgentEvent } from "../../shared/events";

type Cue =
  | "boot"
  | "select"
  | "step"
  | "spawn"
  | "llm"
  | "tool"
  | "ok"
  | "fail"
  | "finish";

export interface Feedback {
  event(event: AgentEvent): void;
}

const HAPTIC: Record<Cue, number | number[]> = {
  boot: [12, 28, 18],
  select: 10,
  step: 6,
  spawn: [8, 18, 8],
  llm: 8,
  tool: [10, 18, 10],
  ok: 14,
  fail: [35, 30, 35],
  finish: [14, 25, 14, 25, 22],
};

export function cueForEvent(event: AgentEvent): Cue | null {
  switch (event.type) {
    case "run_started": return "boot";
    case "agent_spawned": return event.parentId === null ? null : "spawn";
    case "loop_step_started": return "step";
    case "model_call_started": return "llm";
    case "tool_call_started": return "tool";
    case "tool_call_result": return event.ok ? "ok" : "fail";
    case "model_call_finished": return event.ok ? null : "fail";
    case "agent_finished": return "finish";
    case "error": return "fail";
    default: return null;
  }
}

function vibrate(cue: Cue): void {
  const nav = typeof navigator === "undefined" ? null : navigator;
  if (nav && "vibrate" in nav) nav.vibrate(HAPTIC[cue]);
}

export function createFeedback(): Feedback {
  const Ctx = typeof window === "undefined"
    ? undefined
    : window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  const audio = Ctx ? new GameBoyAudio(Ctx) : null;

  const unlock = () => audio?.unlock();
  window.addEventListener("pointerdown", unlock, { passive: true });
  window.addEventListener("keydown", unlock);

  function play(cue: Cue): void {
    vibrate(cue);
    audio?.play(cue);
  }

  return {
    event(event) {
      const cue = cueForEvent(event);
      if (cue) play(cue);
    },
  };
}

class GameBoyAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private lastCueAt = new Map<Cue, number>();

  constructor(private readonly AudioCtx: typeof AudioContext) {}

  unlock(): void {
    const ctx = this.ensure();
    void ctx.resume();
  }

  play(cue: Cue): void {
    const ctx = this.ensure();
    const now = ctx.currentTime;
    if (this.throttled(cue, now)) return;

    switch (cue) {
      case "boot":
        this.square(196, 0.03, 0.08, 0.10);
        this.square(392, 0.11, 0.08, 0.10);
        this.square(784, 0.20, 0.12, 0.09);
        break;
      case "select":
        this.square(880, 0, 0.045, 0.08);
        break;
      case "step":
        this.square(330, 0, 0.025, 0.035);
        break;
      case "spawn":
        this.square(523, 0, 0.055, 0.07);
        this.square(659, 0.06, 0.055, 0.07);
        break;
      case "llm":
        this.square(247, 0, 0.04, 0.035);
        this.square(294, 0.045, 0.04, 0.03);
        break;
      case "tool":
        this.noise(0, 0.055, 0.04);
        this.square(587, 0.025, 0.05, 0.06);
        break;
      case "ok":
        this.square(740, 0, 0.05, 0.065);
        this.square(988, 0.055, 0.06, 0.055);
        break;
      case "fail":
        this.square(155, 0, 0.11, 0.09);
        this.noise(0.02, 0.13, 0.08);
        break;
      case "finish":
        this.square(392, 0, 0.08, 0.08);
        this.square(523, 0.08, 0.08, 0.08);
        this.square(659, 0.16, 0.08, 0.08);
        this.square(1047, 0.25, 0.14, 0.065);
        break;
    }
  }

  private ensure(): AudioContext {
    if (!this.ctx) {
      this.ctx = new this.AudioCtx();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.16;
      this.master.connect(this.ctx.destination);
    }
    return this.ctx;
  }

  private throttled(cue: Cue, now: number): boolean {
    const minGap = cue === "step" || cue === "llm" ? 0.16 : 0.035;
    const last = this.lastCueAt.get(cue) ?? -Infinity;
    if (now - last < minGap) return true;
    this.lastCueAt.set(cue, now);
    return false;
  }

  private square(freq: number, delay: number, duration: number, volume: number): void {
    if (!this.ctx || !this.master) return;
    const start = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = "square";
    osc.frequency.setValueAtTime(freq, start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(volume, start + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    osc.connect(gain).connect(this.master);
    osc.start(start);
    osc.stop(start + duration + 0.015);
  }

  private noise(delay: number, duration: number, volume: number): void {
    if (!this.ctx || !this.master) return;
    const start = this.ctx.currentTime + delay;
    const length = Math.max(1, Math.floor(this.ctx.sampleRate * duration));
    const buffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

    const src = this.ctx.createBufferSource();
    const gain = this.ctx.createGain();
    src.buffer = buffer;
    gain.gain.setValueAtTime(volume, start);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    src.connect(gain).connect(this.master);
    src.start(start);
    src.stop(start + duration + 0.01);
  }
}
