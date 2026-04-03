import fs from 'node:fs/promises';
import path from 'node:path';
import type { CheckpointCollector, AriaSnapshotCollectorData } from '../types';

function countSnapshotNodes(value: unknown): number {
  if (value == null) {
    return 0;
  }

  if (Array.isArray(value)) {
    return value.reduce((total, item) => total + countSnapshotNodes(item), 0);
  }

  if (typeof value !== 'object') {
    return 1;
  }

  const node = value as { children?: unknown };
  const children = Array.isArray(node.children) ? node.children : [];
  return 1 + children.reduce((total, child) => total + countSnapshotNodes(child), 0);
}

async function captureAriaSnapshot(page: {
  locator: (selector: string) => { ariaSnapshot?: () => Promise<unknown> };
  accessibility?: { snapshot?: (options?: { interestingOnly?: boolean }) => Promise<unknown> };
}): Promise<unknown | null> {
  try {
    const root = page.locator(':root');
    if (typeof root.ariaSnapshot === 'function') {
      const snapshot = await root.ariaSnapshot();
      return snapshot ?? null;
    }
  } catch {
    // Fall through to accessibility.snapshot.
  }

  if (typeof page.accessibility?.snapshot === 'function') {
    try {
      const snapshot = await page.accessibility.snapshot({ interestingOnly: false });
      return snapshot ?? null;
    } catch {
      return null;
    }
  }

  return null;
}

export const ariaSnapshotCollector: CheckpointCollector = {
  name: 'aria-snapshot',
  defaultEnabled: false,

  async collect(ctx) {
    const snapshot = await captureAriaSnapshot(ctx.page as unknown as Parameters<typeof captureAriaSnapshot>[0]);
    const nodeCount = countSnapshotNodes(snapshot);
    const outputPath = path.join(ctx.checkpointDir, 'aria-snapshot.json');

    const data: AriaSnapshotCollectorData = {
      snapshot,
      nodeCount,
    };

    await fs.writeFile(outputPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');

    return {
      data,
      artifacts: [
        {
          name: 'aria-snapshot',
          path: outputPath,
          contentType: 'application/json',
        },
      ],
      summary: {
        nodeCount,
      },
    };
  },
};
