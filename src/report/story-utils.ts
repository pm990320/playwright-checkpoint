import type { RunRecord } from '../types';

export function groupByStory(runs: RunRecord[]): Map<string, RunRecord[]> {
  const stories = new Map<string, RunRecord[]>();

  for (const run of runs) {
    const existing = stories.get(run.title) ?? [];
    existing.push(run);
    stories.set(run.title, existing);
  }

  return stories;
}

export function orderedCheckpointNames(runs: RunRecord[]): string[] {
  const names: string[] = [];
  const seen = new Set<string>();

  for (const run of runs) {
    for (const checkpoint of run.checkpoints) {
      if (seen.has(checkpoint.name)) {
        continue;
      }

      seen.add(checkpoint.name);
      names.push(checkpoint.name);
    }
  }

  return names;
}
