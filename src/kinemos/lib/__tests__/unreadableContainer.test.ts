/**
 * The import gate for containers a browser cannot read. A WMV that reaches the
 * clip editor fails there with a message about trimming; the gate exists so the
 * coach hears "convert it" instead.
 */
import { describe, expect, it } from 'vitest';
import { unreadableContainer } from '../directImport';

describe('unreadableContainer', () => {
  it('names WMV by extension or by the mime type Windows reports', () => {
    expect(unreadableContainer({ name: 'Træk side.wmv', type: 'video/x-ms-wmv' })).toBe('WMV');
    expect(unreadableContainer({ name: 'clip.WMV', type: '' })).toBe('WMV');
    expect(unreadableContainer({ name: 'renamed.bin', type: 'video/x-ms-asf' })).toBe('WMV');
  });

  it('catches the other camera-card formats', () => {
    expect(unreadableContainer({ name: 'MVI_0012.AVI', type: 'video/x-msvideo' })).toBe('AVI');
    expect(unreadableContainer({ name: 'old.flv', type: '' })).toBe('FLV');
    expect(unreadableContainer({ name: 'dvd.vob', type: '' })).toBe('MPEG');
  });

  it('lets everything a browser can read through', () => {
    expect(unreadableContainer({ name: 'lift.mp4', type: 'video/mp4' })).toBeNull();
    expect(unreadableContainer({ name: 'IMG_0421.MOV', type: 'video/quicktime' })).toBeNull();
    expect(unreadableContainer({ name: 'clip.webm', type: 'video/webm' })).toBeNull();
    expect(unreadableContainer({ name: 'clip.mkv', type: 'video/x-matroska' })).toBeNull();
  });
});
