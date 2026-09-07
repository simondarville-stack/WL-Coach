/**
 * featureFlags — switches for KinEMOS paths that are built but not yet
 * verified on real footage.
 *
 * Two ways to flip one: a build-time `VITE_KINEMOS_*` variable, or a
 * localStorage key a local session sets in the browser console to try the
 * path on the testset without a rebuild (`verify/testset.html` runs the same
 * adapter). Both default to off; a flag that is on in a build is on for
 * everyone who loads it.
 */

/** localStorage key for the luma-region frame reads (P6 plan §4). */
export const LUMA_REGION_KEY = 'kinemos.lumaRegion';

/**
 * Luma-plane region reads for the tracker (P6 plan §4): the Y plane of the
 * region copied straight from the decoded frame instead of a canvas round
 * trip. OFF until measured on the testset clips against the canvas path.
 */
export function lumaRegionReadsEnabled(): boolean {
  if (import.meta.env.VITE_KINEMOS_LUMA_REGION === '1') return true;
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(LUMA_REGION_KEY) === '1';
  } catch {
    return false;
  }
}
