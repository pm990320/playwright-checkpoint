import path from 'node:path';
import type { CheckpointCollector, ScreenshotCollectorData } from '../types';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function readPngSize(buffer: Buffer): ScreenshotCollectorData['imageSize'] {
  if (buffer.length < 24 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return null;
  }

  if (buffer.toString('ascii', 12, 16) !== 'IHDR') {
    return null;
  }

  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

export const screenshotCollector: CheckpointCollector = {
  name: 'screenshot',
  defaultEnabled: true,

  async collect(ctx) {
    const fullPage = ctx.options.fullPage ?? true;
    const screenshotPath = path.join(ctx.checkpointDir, 'page.png');
    const screenshotBuffer = await ctx.page.screenshot({ path: screenshotPath, fullPage });

    let highlightBounds: ScreenshotCollectorData['highlightBounds'] = null;
    if (ctx.options.highlightSelector) {
      highlightBounds = await ctx.page
        .locator(ctx.options.highlightSelector)
        .boundingBox()
        .catch(() => null);
    }

    return {
      data: {
        fullPage,
        highlightBounds,
        highlightSelector: ctx.options.highlightSelector ?? null,
        imageSize: Buffer.isBuffer(screenshotBuffer) ? readPngSize(screenshotBuffer) : null,
      } satisfies ScreenshotCollectorData,
      artifacts: [
        {
          name: 'screenshot',
          path: screenshotPath,
          contentType: 'image/png',
        },
      ],
      summary: {
        screenshotPath: 'page.png',
      },
    };
  },
};
