import { describe, expect, it } from 'vitest';
import { sexOf, tierForAthlete, tierForBodyweight } from '../weightClass';

describe('tierForBodyweight', () => {
  it('splits the IWF classes three, three and two', () => {
    expect(tierForBodyweight('men', 59)).toBe('lower');
    expect(tierForBodyweight('men', 71)).toBe('lower');
    expect(tierForBodyweight('men', 71.5)).toBe('middle');
    expect(tierForBodyweight('men', 94)).toBe('middle');
    expect(tierForBodyweight('men', 100)).toBe('upper');
    expect(tierForBodyweight('men', 140)).toBe('upper');
    expect(tierForBodyweight('women', 58)).toBe('lower');
    expect(tierForBodyweight('women', 63)).toBe('middle');
    expect(tierForBodyweight('women', 90)).toBe('upper');
    expect(tierForBodyweight('women', null)).toBeNull();
  });
});

describe('tierForAthlete', () => {
  it('reads the declared class before the bodyweight', () => {
    expect(tierForAthlete({ sex: 'men', weightClass: '89', bodyweightKg: 60 })).toBe('middle');
    expect(tierForAthlete({ sex: 'women', weightClass: '-58', bodyweightKg: 70 })).toBe('lower');
    expect(tierForAthlete({ sex: 'men', weightClass: '+110' })).toBe('upper');
  });

  it('falls to the bodyweight, and to nothing without a sex', () => {
    expect(tierForAthlete({ sex: 'kvinde', bodyweightKg: 75 })).toBe('middle');
    expect(tierForAthlete({ sex: null, weightClass: '89', bodyweightKg: 89 })).toBeNull();
    expect(tierForAthlete({ sex: 'men' })).toBeNull();
  });
});

describe('sexOf', () => {
  it('reads the words a coach types', () => {
    expect(sexOf('M')).toBe('men');
    expect(sexOf('female')).toBe('women');
    expect(sexOf('Kvinder')).toBe('women');
    expect(sexOf('other')).toBeNull();
  });
});
