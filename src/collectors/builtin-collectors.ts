import { ariaSnapshotCollector } from './aria-snapshot';
import { axeCollector } from './axe';
import { consoleCollector } from './console';
import { domStatsCollector } from './dom-stats';
import { formsCollector } from './forms';
import { htmlCollector } from './html';
import { metadataCollector } from './metadata';
import { networkCollector } from './network';
import { networkTimingCollector } from './network-timing';
import { screenshotCollector } from './screenshot';
import { storageCollector } from './storage';
import { webVitalsCollector } from './web-vitals';

export const builtinCollectors = [
  screenshotCollector,
  htmlCollector,
  axeCollector,
  webVitalsCollector,
  consoleCollector,
  networkCollector,
  metadataCollector,
  ariaSnapshotCollector,
  domStatsCollector,
  formsCollector,
  storageCollector,
  networkTimingCollector,
];
