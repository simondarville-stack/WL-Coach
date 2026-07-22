import { describe, it, expect } from 'vitest';
import { splitExerciseHeader } from '../macroExcelHeaders';

/**
 * The macro Excel export writes one header band per exercise, suffixed
 * "(Target)" / "(Actual)". The import used to match that whole cell against
 * the exercise code, so a file EMOS had just exported mapped zero columns and
 * imported nothing. These cases lock the round trip.
 */
describe('splitExerciseHeader', () => {
  it('splits an exported target band into code + block', () => {
    expect(splitExerciseHeader('SN (Target)')).toEqual({ name: 'SN', block: 'target' });
  });

  it('splits an exported actual band, which must not be imported', () => {
    expect(splitExerciseHeader('SN (Actual)')).toEqual({ name: 'SN', block: 'actual' });
  });

  it('leaves a plain template header (no suffix) untouched', () => {
    expect(splitExerciseHeader('SN')).toEqual({ name: 'SN', block: 'plain' });
  });

  it('keeps parentheses that belong to the exercise name', () => {
    expect(splitExerciseHeader('Squat (front)')).toEqual({ name: 'Squat (front)', block: 'plain' });
    expect(splitExerciseHeader('Squat (front) (Target)')).toEqual({ name: 'Squat (front)', block: 'target' });
  });

  it('tolerates casing and spacing from hand-edited files', () => {
    expect(splitExerciseHeader('Clean & Jerk  (target)')).toEqual({ name: 'Clean & Jerk', block: 'target' });
  });
});
