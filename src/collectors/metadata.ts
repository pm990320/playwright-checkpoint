import fs from 'node:fs/promises';
import path from 'node:path';
import type { CheckpointCollector, PageMetadata } from '../types';

function normalizeStructuredData(scriptContents: Array<string | null>): unknown[] {
  const values: unknown[] = [];

  for (const content of scriptContents) {
    const value = content?.trim();
    if (!value) {
      continue;
    }

    try {
      values.push(JSON.parse(value));
    } catch {
      values.push({
        parseError: 'Invalid JSON-LD',
        raw: value,
      });
    }
  }

  return values;
}

export const metadataCollector: CheckpointCollector = {
  name: 'metadata',
  defaultEnabled: true,

  async collect(ctx) {
    const metadata = await ctx.page.evaluate(() => {
      const meta = (selector: string): string | null => document.querySelector(selector)?.getAttribute('content') ?? null;
      const canonicalLink = document.querySelector('link[rel="canonical"]');
      const html = document.documentElement;
      const structuredDataScripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]')).map((script) => script.textContent ?? null);

      return {
        url: location.href,
        title: document.title,
        description: meta('meta[name="description"]'),
        openGraph: {
          title: meta('meta[property="og:title"]'),
          description: meta('meta[property="og:description"]'),
          image: meta('meta[property="og:image"]'),
        },
        canonicalUrl: canonicalLink?.getAttribute('href') ?? null,
        lang: html.getAttribute('lang'),
        viewport: meta('meta[name="viewport"]'),
        structuredDataScripts,
      };
    });

    const normalizedMetadata: PageMetadata = {
      url: metadata.url,
      title: metadata.title,
      description: metadata.description,
      openGraph: metadata.openGraph,
      canonicalUrl: metadata.canonicalUrl,
      lang: metadata.lang,
      viewport: metadata.viewport,
      structuredData: normalizeStructuredData(metadata.structuredDataScripts),
    };

    const outputPath = path.join(ctx.checkpointDir, 'metadata.json');
    await fs.writeFile(outputPath, `${JSON.stringify(normalizedMetadata, null, 2)}\n`, 'utf8');

    return {
      data: normalizedMetadata,
      artifacts: [
        {
          name: 'metadata',
          path: outputPath,
          contentType: 'application/json',
        },
      ],
      summary: {
        url: normalizedMetadata.url,
        title: normalizedMetadata.title,
        lang: normalizedMetadata.lang,
      },
    };
  },
};
