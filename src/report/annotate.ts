import { createRequire } from 'node:module';
import path from 'node:path';
import type { BoundingBox } from '../types';

type SharpLike = {
  (input: string | Buffer): {
    metadata(): Promise<{ width?: number; height?: number }>;
    composite(items: Array<{ input: Buffer; top?: number; left?: number }>): {
      png(): {
        toFile(filePath: string): Promise<void>;
      };
    };
  };
};

const require = (() => {
  try {
    return Function('return require')() as NodeRequire;
  } catch {
    return createRequire(path.join(process.cwd(), 'playwright-checkpoint-annotate-runtime.cjs'));
  }
})();

async function loadSharp(): Promise<SharpLike | null> {
  try {
    const loaded = require('sharp') as SharpLike | { default?: SharpLike };
    return typeof loaded === 'function' ? loaded : loaded.default ?? null;
  } catch {
    return null;
  }
}

function buildOverlaySvg(width: number, height: number, bounds: BoundingBox): Buffer {
  const strokeWidth = Math.max(2, Math.round(Math.min(width, height) * 0.005));
  const radius = Math.max(6, Math.round(Math.min(bounds.width, bounds.height) * 0.08));

  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
      <rect
        x="${bounds.x}"
        y="${bounds.y}"
        width="${bounds.width}"
        height="${bounds.height}"
        rx="${radius}"
        ry="${radius}"
        fill="rgba(239, 68, 68, 0.10)"
        stroke="rgba(239, 68, 68, 0.95)"
        stroke-width="${strokeWidth}"
      />
    </svg>
  `.trim();

  return Buffer.from(svg, 'utf8');
}

export async function annotateScreenshot(
  imagePath: string,
  bounds: BoundingBox,
  outputPath: string,
): Promise<string | null> {
  const sharp = await loadSharp();
  if (!sharp) {
    return null;
  }

  const image = sharp(imagePath);
  const metadata = await image.metadata();
  if (!metadata.width || !metadata.height) {
    return null;
  }

  const overlay = buildOverlaySvg(metadata.width, metadata.height, bounds);
  await image.composite([{ input: overlay, top: 0, left: 0 }]).png().toFile(outputPath);
  return outputPath;
}
