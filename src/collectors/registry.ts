import type { CheckpointCollector } from '../types';

const builtinCollectors = new Map<string, CheckpointCollector>();
let builtinsRegistered = false;

export function registerBuiltinCollector(collector: CheckpointCollector): void {
  builtinCollectors.set(collector.name, collector);
}

export function registerBuiltinCollectors(collectors: CheckpointCollector[]): void {
  if (builtinsRegistered) {
    return;
  }

  for (const collector of collectors) {
    registerBuiltinCollector(collector);
  }

  builtinsRegistered = true;
}

export function getBuiltinCollectors(): Map<string, CheckpointCollector> {
  return new Map(builtinCollectors);
}
