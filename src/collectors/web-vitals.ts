import fs from 'node:fs/promises';
import path from 'node:path';
import type { Page } from '@playwright/test';
import type {
  CheckpointCollector,
  WebVitalMetric,
  WebVitalRating,
  WebVitalsSnapshot,
} from '../types';

type RawWebVitals = {
  cls: number | null;
  fcp: number | null;
  lcp: number | null;
  inp: number | null;
  ttfb: number | null;
  domContentLoaded: number | null;
  loadEvent: number | null;
  url: string;
};

const initializedPages = new WeakSet<Page>();

function rateMetric(
  value: number | null,
  thresholds: { good: number; needsImprovement: number },
): WebVitalRating {
  if (value == null || Number.isNaN(value)) {
    return 'unknown';
  }
  if (value <= thresholds.good) {
    return 'good';
  }
  if (value <= thresholds.needsImprovement) {
    return 'needs-improvement';
  }
  return 'poor';
}

function metric(value: number | null, thresholds: { good: number; needsImprovement: number }): WebVitalMetric {
  return {
    value,
    rating: rateMetric(value, thresholds),
  };
}

async function captureWebVitals(page: Page): Promise<WebVitalsSnapshot> {
  const raw = await page.evaluate(() => {
    const globalState = globalThis as typeof globalThis & {
      __e2eWebVitals?: {
        cls: number;
        fcp: number | null;
        lcp: number | null;
        inp: number | null;
      };
    };

    const state = globalState.__e2eWebVitals ?? {
      cls: 0,
      fcp: null,
      lcp: null,
      inp: null,
    };
    const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;

    return {
      cls: state.cls,
      fcp: state.fcp,
      lcp: state.lcp,
      inp: state.inp,
      ttfb: navigation ? navigation.responseStart : null,
      domContentLoaded: navigation ? navigation.domContentLoadedEventEnd : null,
      loadEvent: navigation ? navigation.loadEventEnd : null,
      url: location.href,
    } satisfies RawWebVitals;
  });

  return {
    url: raw.url,
    capturedAt: new Date().toISOString(),
    cls: metric(raw.cls, { good: 0.1, needsImprovement: 0.25 }),
    fcpMs: metric(raw.fcp, { good: 1800, needsImprovement: 3000 }),
    lcpMs: metric(raw.lcp, { good: 2500, needsImprovement: 4000 }),
    inpMs: metric(raw.inp, { good: 200, needsImprovement: 500 }),
    ttfbMs: metric(raw.ttfb, { good: 800, needsImprovement: 1800 }),
    domContentLoadedMs: raw.domContentLoaded,
    loadEventMs: raw.loadEvent,
  };
}

export const webVitalsCollector: CheckpointCollector = {
  name: 'web-vitals',
  defaultEnabled: true,

  async setup({ page }) {
    if (initializedPages.has(page)) {
      return;
    }

    initializedPages.add(page);

    await page.addInitScript(() => {
      const globalState = globalThis as typeof globalThis & {
        __e2eWebVitals?: {
          cls: number;
          fcp: number | null;
          lcp: number | null;
          inp: number | null;
        };
      };

      if (!globalState.__e2eWebVitals) {
        globalState.__e2eWebVitals = {
          cls: 0,
          fcp: null,
          lcp: null,
          inp: null,
        };
      }

      const state = globalState.__e2eWebVitals;

      try {
        const paintObserver = new PerformanceObserver((entryList) => {
          for (const entry of entryList.getEntries()) {
            if (entry.name === 'first-contentful-paint') {
              state.fcp = entry.startTime;
            }
          }
        });
        paintObserver.observe({ type: 'paint', buffered: true });
      } catch {
        // Unsupported in this browser context.
      }

      try {
        const lcpObserver = new PerformanceObserver((entryList) => {
          const entries = entryList.getEntries();
          const lastEntry = entries[entries.length - 1];
          if (lastEntry) {
            state.lcp = lastEntry.startTime;
          }
        });
        lcpObserver.observe({ type: 'largest-contentful-paint', buffered: true });
        addEventListener('pagehide', () => lcpObserver.disconnect(), { once: true });
      } catch {
        // Unsupported in this browser context.
      }

      try {
        const clsObserver = new PerformanceObserver((entryList) => {
          for (const entry of entryList.getEntries() as Array<PerformanceEntry & { hadRecentInput?: boolean; value?: number }>) {
            if (!entry.hadRecentInput) {
              state.cls += entry.value ?? 0;
            }
          }
        });
        clsObserver.observe({ type: 'layout-shift', buffered: true });
        addEventListener('pagehide', () => clsObserver.disconnect(), { once: true });
      } catch {
        // Unsupported in this browser context.
      }

      try {
        const inpObserver = new PerformanceObserver((entryList) => {
          for (const entry of entryList.getEntries() as Array<PerformanceEntry & { duration?: number }>) {
            const duration = entry.duration ?? 0;
            if (state.inp == null || duration > state.inp) {
              state.inp = duration;
            }
          }
        });
        inpObserver.observe({ type: 'event', buffered: true, durationThreshold: 40 } as PerformanceObserverInit);
        addEventListener('pagehide', () => inpObserver.disconnect(), { once: true });
      } catch {
        // Unsupported in this browser context.
      }
    });
  },

  async collect(ctx) {
    const snapshot = await captureWebVitals(ctx.page);
    const outputPath = path.join(ctx.checkpointDir, 'web-vitals.json');

    await fs.writeFile(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');

    return {
      data: snapshot,
      artifacts: [
        {
          name: 'web-vitals',
          path: outputPath,
          contentType: 'application/json',
        },
      ],
      summary: {
        cls: snapshot.cls,
        fcp: snapshot.fcpMs,
        lcp: snapshot.lcpMs,
        inp: snapshot.inpMs,
        ttfb: snapshot.ttfbMs,
      },
    };
  },

  async teardown({ page }) {
    initializedPages.delete(page);
  },
};
