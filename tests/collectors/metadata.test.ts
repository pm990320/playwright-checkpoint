import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { metadataCollector } from '../../src/collectors';
import { createCollectorContext, MockPage } from '../helpers/mock-page';

async function makeCheckpointDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'playwright-checkpoint-metadata-'));
}

describe('metadataCollector', () => {
  it('extracts page metadata and parses JSON-LD', async () => {
    const checkpointDir = await makeCheckpointDir();
    const page = new MockPage();
    const previousDocument = globalThis.document;
    const previousLocation = globalThis.location;

    const scripts = [
      { textContent: '{"@context":"https://schema.org","@type":"Product","name":"Widget"}' },
      { textContent: '{"broken":' },
    ];

    const documentMock = {
      title: 'Widget',
      documentElement: {
        getAttribute: (name: string) => (name === 'lang' ? 'en' : null),
      },
      querySelector: (selector: string) => {
        const lookup: Record<string, { getAttribute: (name: string) => string | null } | null> = {
          'meta[name="description"]': { getAttribute: () => 'Best widget' },
          'meta[property="og:title"]': { getAttribute: () => 'Widget OG' },
          'meta[property="og:description"]': { getAttribute: () => 'Widget OG Description' },
          'meta[property="og:image"]': { getAttribute: () => 'https://example.com/widget.png' },
          'meta[name="viewport"]': { getAttribute: () => 'width=device-width, initial-scale=1' },
          'link[rel="canonical"]': { getAttribute: () => 'https://example.com/widget' },
        };

        return lookup[selector] ?? null;
      },
      querySelectorAll: (selector: string) => (selector === 'script[type="application/ld+json"]' ? scripts : []),
    };

    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: documentMock,
    });
    Object.defineProperty(globalThis, 'location', {
      configurable: true,
      value: { href: 'https://example.com/widget' },
    });

    try {
      const result = await metadataCollector.collect(createCollectorContext({ page, checkpointDir }));

      expect(result.summary).toEqual({
        url: 'https://example.com/widget',
        title: 'Widget',
        lang: 'en',
      });
      expect(result.data).toMatchObject({
        url: 'https://example.com/widget',
        title: 'Widget',
        description: 'Best widget',
        openGraph: {
          title: 'Widget OG',
          description: 'Widget OG Description',
          image: 'https://example.com/widget.png',
        },
        canonicalUrl: 'https://example.com/widget',
        lang: 'en',
        viewport: 'width=device-width, initial-scale=1',
      });
      expect((result.data as { structuredData: unknown[] }).structuredData).toEqual([
        {
          '@context': 'https://schema.org',
          '@type': 'Product',
          name: 'Widget',
        },
        {
          parseError: 'Invalid JSON-LD',
          raw: '{"broken":',
        },
      ]);
      expect(await fs.readFile(path.join(checkpointDir, 'metadata.json'), 'utf8')).toContain('Widget OG');
    } finally {
      Object.defineProperty(globalThis, 'document', {
        configurable: true,
        value: previousDocument,
      });
      Object.defineProperty(globalThis, 'location', {
        configurable: true,
        value: previousLocation,
      });
    }
  });
});
