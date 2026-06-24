import { Application, Graphics, Texture } from "pixi.js";
import { spriteMatrix, paletteFor } from "./sprite-data";

const CELL = 6; // each sprite pixel → 6 screen px before scene scaling

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
