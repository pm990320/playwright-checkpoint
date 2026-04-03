import fs from 'node:fs/promises';
import path from 'node:path';
import type { CheckpointCollector, DomStatsCollectorData } from '../types';

export const domStatsCollector: CheckpointCollector = {
  name: 'dom-stats',
  defaultEnabled: false,

  async collect(ctx) {
    const stats = await ctx.page.evaluate(() => {
      const allNodes = document.querySelectorAll('*');

      const maxDepthFrom = (root: Element | null): number => {
        if (!root) {
          return 0;
        }

        let maxDepth = 1;
        const queue: Array<{ node: Element; depth: number }> = [{ node: root, depth: 1 }];

        while (queue.length > 0) {
          const current = queue.shift();
          if (!current) {
            continue;
          }

          maxDepth = Math.max(maxDepth, current.depth);
          for (const child of Array.from(current.node.children)) {
            queue.push({ node: child, depth: current.depth + 1 });
          }
        }

        return maxDepth;
      };

      const maybeGetEventListeners =
        (globalThis as { getEventListeners?: (target: EventTarget) => Record<string, unknown[]> }).getEventListeners;

      let eventListenerCount: number | null = null;
      if (typeof maybeGetEventListeners === 'function') {
        eventListenerCount = 0;
        const targets: EventTarget[] = [window, document, ...Array.from(allNodes)];

        for (const target of targets) {
          try {
            const listeners = maybeGetEventListeners(target) ?? {};
            for (const entries of Object.values(listeners)) {
              eventListenerCount += Array.isArray(entries) ? entries.length : 0;
            }
          } catch {
            // Ignore inaccessible targets.
          }
        }
      }

      return {
        nodeCount: allNodes.length,
        maxDepth: maxDepthFrom(document.documentElement),
        formCount: document.querySelectorAll('form').length,
        imageCount: document.querySelectorAll('img').length,
        scriptCount: document.querySelectorAll('script').length,
        stylesheetCount: document.styleSheets.length,
        eventListenerCount,
      };
    });

    const data: DomStatsCollectorData = {
      nodeCount: stats.nodeCount,
      maxDepth: stats.maxDepth,
      formCount: stats.formCount,
      imageCount: stats.imageCount,
      scriptCount: stats.scriptCount,
      stylesheetCount: stats.stylesheetCount,
      eventListenerCount: stats.eventListenerCount,
    };

    const outputPath = path.join(ctx.checkpointDir, 'dom-stats.json');
    await fs.writeFile(outputPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');

    return {
      data,
      artifacts: [
        {
          name: 'dom-stats',
          path: outputPath,
          contentType: 'application/json',
        },
      ],
      summary: {
        nodeCount: data.nodeCount,
        maxDepth: data.maxDepth,
        formCount: data.formCount,
        imageCount: data.imageCount,
      },
    };
  },
};
