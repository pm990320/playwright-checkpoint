import { builtinCollectors } from './builtin-collectors';
import { registerBuiltinCollectors } from './registry';

registerBuiltinCollectors(builtinCollectors);

export { registerBuiltinCollector, registerBuiltinCollectors, getBuiltinCollectors } from './registry';
export { screenshotCollector } from './screenshot';
export { htmlCollector } from './html';
export { axeCollector, setAxeLoaderForTests } from './axe';
export { webVitalsCollector } from './web-vitals';
export { consoleCollector } from './console';
export { networkCollector } from './network';
export { metadataCollector } from './metadata';
export { ariaSnapshotCollector } from './aria-snapshot';
export { domStatsCollector } from './dom-stats';
export { formsCollector } from './forms';
export { storageCollector } from './storage';
export { networkTimingCollector } from './network-timing';
export type { CheckpointCollector } from '../types';
