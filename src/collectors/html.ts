import fs from 'node:fs/promises';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { settlePage } from '../page-utils';
import type { CheckpointCollector, HtmlCollectorData } from '../types';

async function readPageContent(page: Page): Promise<string> {
  try {
    await settlePage(page);
    return await page.content();
  } catch {
    await page.waitForTimeout(500);
    await settlePage(page);
    return await page.content();
  }
}

export const htmlCollector: CheckpointCollector = {
  name: 'html',
  defaultEnabled: true,

  async collect(ctx) {
    const htmlPath = path.join(ctx.checkpointDir, 'page.html');
    const html = await readPageContent(ctx.page);

    await fs.writeFile(htmlPath, html, 'utf8');

    return {
      data: {
        contentLength: html.length,
      } satisfies HtmlCollectorData,
      artifacts: [
        {
          name: 'html',
          path: htmlPath,
          contentType: 'text/html',
        },
      ],
      summary: {
        htmlPath: 'page.html',
      },
    };
  },
};
