import path from 'node:path';
import type { CheckpointCollector, ScreenshotCollectorData } from '../types';

export const screenshotCollector: CheckpointCollector = {
  name: 'screenshot',
  defaultEnabled: true,

  async collect(ctx) {
    const fullPage = ctx.options.fullPage ?? true;
    const screenshotPath = path.join(ctx.checkpointDir, 'page.png');

    await ctx.page.screenshot({ path: screenshotPath, fullPage });

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
