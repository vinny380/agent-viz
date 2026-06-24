// Palette index 0 is always transparent. Indices 1..3 are body/accent/eye colors.
export const PALETTES: readonly string[][] = [
  ["transparent", "#48c9b0", "#1f6f63", "#0a0f12"], // teal robot
  ["transparent", "#e74c3c", "#7d241a", "#0a0f12"], // red knight
  ["transparent", "#9b59b6", "#5b2c6f", "#0a0f12"], // purple mage
  ["transparent", "#f1c40f", "#9a7d0a", "#0a0f12"], // gold rogue
  ["transparent", "#5dade2", "#21618c", "#0a0f12"], // blue scout
];

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

export function paletteFor(agentId: string): string[] {
  return PALETTES[hash(agentId) % PALETTES.length]!.slice();
}

/**
 * 16x16 left-right-symmetric character: a chunky head/torso/legs silhouette
 * with body(1)/accent(2)/eye(3) pixels. Deterministic from the id.
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
  // Eyes
  set(5, 4, 3);
  // Torso (rows 7-11, cols 3-7)
  for (let y = 7; y <= 11; y++) for (let x = 3; x <= 7; x++) set(x, y, 1);
  // Accent stripe / detail, randomized per agent
  const stripeRow = 8 + Math.floor(rand() * 3);
  for (let x = 3; x <= 7; x++) set(x, stripeRow, 2);
  // Random shoulder accent
  if (rand() > 0.5) { set(3, 7, 2); }
  // Legs (rows 12-14, cols 4-5 and mirrored)
  for (let y = 12; y <= 14; y++) { set(4, y, 1); set(5, y, 1); }

  return m;
}
