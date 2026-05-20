/**
 * plannerUtils — backward-compat barrel.
 *
 * Pure utilities have moved to sentinelUtils.ts.
 * DB interaction (getOrCreateSentinel) has moved to sentinelService.ts.
 * This re-export barrel is kept so any remaining callers continue to compile.
 * Prefer importing directly from sentinelUtils / sentinelService in new code.
 *
 * UF-29 / E-17: refactored 2026-05-20.
 */
export {
  abbreviateExercise,
  getSentinelType,
  getYouTubeThumbnail,
  isDirectVideoFile,
} from './sentinelUtils';
export type { SentinelType } from './sentinelUtils';
export { getOrCreateSentinel } from './sentinelService';
