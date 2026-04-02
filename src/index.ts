// Public API re-exports
export type * from './types';
export { type CheckpointCollector } from './types';
export { type ReportGenerator } from './types';

// Re-export fixture, collectors, and report sub-modules
export * from './fixture';
export * from './collectors';
export * from './report';

// Package version — used by the smoke test to verify the barrel is live
export const VERSION = '0.1.0';
