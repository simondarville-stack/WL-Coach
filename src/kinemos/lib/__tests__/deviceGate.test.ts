/**
 * The gate decides whether a phone may spend a minute of decoding on a
 * clip nobody asked it to analyse (P8 plan §2). Pure over a snapshot, so
 * every threshold is asserted on the struct; the reader is checked once
 * against a stubbed navigator.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { MIN_BATTERY_LEVEL, canAnalyseOnDevice, readDeviceState, type DeviceState } from '../deviceGate';

const fine: DeviceState = { hasWebCodecs: true, saveData: false, battery: null };

describe('canAnalyseOnDevice', () => {
  it('goes on a phone with WebCodecs, no data saver and no battery reading', () => {
    expect(canAnalyseOnDevice(fine)).toEqual({ ok: true });
  });

  it('refuses without WebCodecs — the frame server has no other decoder', () => {
    expect(canAnalyseOnDevice({ ...fine, hasWebCodecs: false })).toEqual({ ok: false, reason: 'no-webcodecs' });
  });

  it('respects data saver, since the first run downloads OpenCV', () => {
    expect(canAnalyseOnDevice({ ...fine, saveData: true })).toEqual({ ok: false, reason: 'save-data' });
  });

  it('refuses under 20 % unplugged and goes at 20 % or above', () => {
    expect(canAnalyseOnDevice({ ...fine, battery: { level: 0.19, charging: false } })).toEqual({
      ok: false,
      reason: 'battery',
    });
    expect(canAnalyseOnDevice({ ...fine, battery: { level: MIN_BATTERY_LEVEL, charging: false } }).ok).toBe(true);
    expect(canAnalyseOnDevice({ ...fine, battery: { level: 0.8, charging: false } }).ok).toBe(true);
  });

  it('goes at any level while charging', () => {
    expect(canAnalyseOnDevice({ ...fine, battery: { level: 0.05, charging: true } }).ok).toBe(true);
  });

  it('checks WebCodecs before anything else', () => {
    // A phone that cannot decode is refused for that, whatever else it says.
    expect(
      canAnalyseOnDevice({ hasWebCodecs: false, saveData: true, battery: { level: 0.1, charging: false } }).reason,
    ).toBe('no-webcodecs');
  });
});

describe('readDeviceState', () => {
  const g = globalThis as { VideoDecoder?: unknown };
  const nav = navigator as Navigator & { connection?: unknown; getBattery?: unknown };
  const hadDecoder = 'VideoDecoder' in g;
  const decoder = g.VideoDecoder;

  afterEach(() => {
    if (hadDecoder) g.VideoDecoder = decoder;
    else delete g.VideoDecoder;
    Object.defineProperty(nav, 'connection', { value: undefined, configurable: true });
    Object.defineProperty(nav, 'getBattery', { value: undefined, configurable: true });
  });

  it('reports what the browser exposes', async () => {
    g.VideoDecoder = class {};
    Object.defineProperty(nav, 'connection', { value: { saveData: true }, configurable: true });
    Object.defineProperty(nav, 'getBattery', {
      value: async () => ({ level: 0.42, charging: true, extra: 'ignored' }),
      configurable: true,
    });
    expect(await readDeviceState()).toEqual({
      hasWebCodecs: true,
      saveData: true,
      battery: { level: 0.42, charging: true },
    });
  });

  it('reads an absent API as unknown, and a refusing one the same way', async () => {
    delete g.VideoDecoder;
    const absent = await readDeviceState();
    expect(absent).toEqual({ hasWebCodecs: false, saveData: false, battery: null });

    Object.defineProperty(nav, 'getBattery', {
      value: async () => {
        throw new Error('not allowed');
      },
      configurable: true,
    });
    expect((await readDeviceState()).battery).toBeNull();
  });
});
