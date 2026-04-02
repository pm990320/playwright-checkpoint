import { axeCollector } from './axe';
import { consoleCollector } from './console';
import { htmlCollector } from './html';
import { metadataCollector } from './metadata';
import { networkCollector } from './network';
import { screenshotCollector } from './screenshot';
import { webVitalsCollector } from './web-vitals';

export const builtinCollectors = [
  screenshotCollector,
  htmlCollector,
  axeCollector,
  webVitalsCollector,
  consoleCollector,
  networkCollector,
  metadataCollector,
];
