import { Application, Graphics, Texture } from "pixi.js";
import { spriteMatrix, paletteFor } from "./sprite-data";

// Each sprite pixel → 2 screen px. With the 16-row matrix and scene scale ~1.0
// this yields a ~32px-tall sprite, sized for the 320x288 Game Boy LCD.
const CELL = 2;

export function makeSpriteTexture(app: Application, agentId: string): Texture {
  const matrix = spriteMatrix(agentId);
  const palette = paletteFor(agentId);
  const g = new Graphics();
  for (let y = 0; y < matrix.length; y++) {
    for (let x = 0; x < matrix[y]!.length; x++) {
      const idx = matrix[y]![x]!;
      if (idx === 0) continue; // transparent
      g.rect(x * CELL, y * CELL, CELL, CELL).fill(palette[idx]!);
    }
  }
  const texture = app.renderer.generateTexture(g);
  texture.source.scaleMode = "nearest";
  g.destroy();
  return texture;
}
