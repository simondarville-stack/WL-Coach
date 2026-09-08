/**
 * deviceGate — may this device run an analysis right now?
 *
 * The automatic pipeline is a minute or more of flat-out decoding and
 * correlation, and on the athlete's phone (P8 plan) it runs behind an
 * upload nobody asked to be analysed. So it runs only when the phone can
 * plainly afford it, and the decision is a pure function over a snapshot of
 * what the browser reports — testable on the struct, with the one reader
 * that touches `navigator` kept apart.
 *
 * Three checks, in the order they are cheap:
 *
 *   1. **WebCodecs.** The frame server decodes with `VideoDecoder` and has
 *      no other way. iOS before 16.4 and Firefox for Android stop here.
 *   2. **Data saver.** The first run downloads OpenCV (~13 MB). Save-data
 *      is the one explicit thing the athlete has said about their
 *      connection, and it is respected even though the clip itself just
 *      went up over the same link.
 *   3. **Battery.** Under 20 % and not charging is a phone that is about
 *      to be needed for something else. The Battery API is Chromium-only;
 *      where it is absent (iOS Safari) the level is unknown, and unknown
 *      means go — the library's own on-power check makes the same call.
 *
 * The thresholds are what the P8 brief set; each is a constant here so the
 * phone numbers (P8 plan §6) can move them without a hunt.
 */

export interface DeviceState {
  /** `typeof VideoDecoder !== 'undefined'`. */
  hasWebCodecs: boolean;
  /** `navigator.connection.saveData`; false where the API is absent. */
  saveData: boolean;
  /** From the Battery API; null where it is absent or refused. */
  battery: { level: number; charging: boolean } | null;
}

export type DeviceRefusal = 'no-webcodecs' | 'save-data' | 'battery';

export interface DeviceDecision {
  ok: boolean;
  reason?: DeviceRefusal;
}

/** Below this fraction of charge, unplugged, nothing starts. */
export const MIN_BATTERY_LEVEL = 0.2;

export function canAnalyseOnDevice(state: DeviceState): DeviceDecision {
  if (!state.hasWebCodecs) return { ok: false, reason: 'no-webcodecs' };
  if (state.saveData) return { ok: false, reason: 'save-data' };
  if (state.battery && !state.battery.charging && state.battery.level < MIN_BATTERY_LEVEL) {
    return { ok: false, reason: 'battery' };
  }
  return { ok: true };
}

interface NavigatorWithHints extends Navigator {
  connection?: { saveData?: boolean };
  getBattery?: () => Promise<{ level: number; charging: boolean }>;
}

/** What the browser says right now. Never throws: an API that refuses is
 *  an API that is absent. */
export async function readDeviceState(): Promise<DeviceState> {
  const hasWebCodecs = typeof globalThis !== 'undefined' && typeof (globalThis as { VideoDecoder?: unknown }).VideoDecoder !== 'undefined';
  const nav = (typeof navigator !== 'undefined' ? navigator : undefined) as NavigatorWithHints | undefined;
  const saveData = nav?.connection?.saveData === true;
  let battery: DeviceState['battery'] = null;
  if (nav && typeof nav.getBattery === 'function') {
    try {
      const b = await nav.getBattery();
      battery = { level: b.level, charging: b.charging };
    } catch {
      battery = null;
    }
  }
  return { hasWebCodecs, saveData, battery };
}
