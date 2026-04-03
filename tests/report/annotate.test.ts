import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { annotateScreenshot } from '../../src/report';

const ONE_BY_ONE_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7Z0ioAAAAASUVORK5CYII=',
  'base64',
);

describe('annotateScreenshot', () => {
  it('returns null without sharp and writes an output file when sharp is available', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'playwright-checkpoint-annotate-'));
    const inputPath = path.join(tempDir, 'input.png');
    const outputPath = path.join(tempDir, 'output.png');
    await fs.writeFile(inputPath, ONE_BY_ONE_PNG);

    const result = await annotateScreenshot(inputPath, { x: 0, y: 0, width: 1, height: 1 }, outputPath);

    if (result === null) {
      await expect(fs.access(outputPath)).rejects.toThrow();
      return;
    }

    expect(result).toBe(outputPath);
    await expect(fs.access(outputPath)).resolves.toBeUndefined();
  });
});
