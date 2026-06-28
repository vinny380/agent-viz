// Authentic Game Boy DMG ramp (darkest → lightest):
//   #0f380f  #306230  #8bac0f  #9bbc0f
// The LCD is monochrome, so EVERY agent shares one palette. Index 0 is
// transparent; indices 1..3 are body / outline+eye / highlight, all drawn
// from the three darker DMG shades so sprites read on the lightest backdrop.
// Agents are told apart by their per-id matrix SHAPE, not by color.
const DMG_RAMP: readonly string[] = [
  "transparent",
  "#306230", // 1: body (mid green)
  "#0f380f", // 2: outline / eye (darkest green)
  "#8bac0f", // 3: highlight (light green)
];

export const PALETTES: readonly string[][] = [DMG_RAMP.slice()];

/** Cheap deterministic hash → 32-bit unsigned. */
function hash(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/** Seeded PRNG (mulberry32). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function paletteFor(_agentId: string): string[] {
  // Monochrome LCD: the DMG ramp is identical for every agent.
  return DMG_RAMP.slice();
}

/**
 * 16x16 left-right-symmetric character. Pixel values map to the shared DMG
 * ramp: 1 = body (mid green), 2 = outline/eye (darkest green), 3 = highlight
 * (light green). Because the LCD is monochrome, agents are distinguished by
 * the SHAPE seeded from their id — not by color. Deterministic and symmetric.
 */
export function spriteMatrix(agentId: string): number[][] {
  const rand = rng(hash(agentId) ^ 0x9e3779b9);
  const m: number[][] = Array.from({ length: 16 }, () => new Array<number>(16).fill(0));

  const set = (x: number, y: number, v: number) => {
    if (y < 0 || y > 15 || x < 0 || x > 15) return;
    m[y]![x] = v;
    m[y]![15 - x] = v; // mirror
  };

  // Head (rows 2-6, cols 4-7 mirrored to 8-11)
  for (let y = 2; y <= 6; y++) for (let x = 4; x <= 7; x++) set(x, y, 1);
  // Eyes — darkest shade (index 2)
  set(5, 4, 2);
  // Head highlight (index 3), per-agent placement
  if (rand() > 0.4) set(6, 3, 3);
  // Torso (rows 7-11, cols 3-7)
  for (let y = 7; y <= 11; y++) for (let x = 3; x <= 7; x++) set(x, y, 1);
  // Accent stripe / detail, randomized per agent — outline shade (index 2)
  const stripeRow = 8 + Math.floor(rand() * 3);
  for (let x = 3; x <= 7; x++) set(x, stripeRow, 2);
  // Random shoulder accent (highlight) for extra per-agent shape variation
  if (rand() > 0.5) { set(3, 7, 3); }
  // Legs (rows 12-14, cols 4-5 and mirrored)
  for (let y = 12; y <= 14; y++) { set(4, y, 1); set(5, y, 1); }

  return m;
}
