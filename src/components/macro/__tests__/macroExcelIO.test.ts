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

  /**
   * A non-kg column exports a unit tag so the sheet says what its numbers mean.
   * The tag sits BEFORE the block suffix, so the suffix must be stripped first —
   * doing it the other way round matches nothing and the export stops
   * round-tripping through its own import.
   */
  describe('unit tags', () => {
    it('strips the tag that sits before the block suffix', () => {
      expect(splitExerciseHeader('SN [%] (Target)')).toEqual({
        name: 'SN', block: 'target', unitTag: 'percentage',
      });
    });

    it('strips a tag on a bare template header', () => {
      expect(splitExerciseHeader('SN [text]')).toEqual({
        name: 'SN', block: 'plain', unitTag: 'free_text_reps',
      });
      expect(splitExerciseHeader('SN [kg]')).toEqual({
        name: 'SN', block: 'plain', unitTag: 'absolute_kg',
      });
    });

    it('survives a name that has its own parentheses', () => {
      expect(splitExerciseHeader('Squat (front) [%] (Target)')).toEqual({
        name: 'Squat (front)', block: 'target', unitTag: 'percentage',
      });
    });

    it('leaves brackets that are part of the name alone', () => {
      // Only the three strings unitLabel emits are units. "Snatch [comp]" is an
      // exercise a coach named, and eating that bracket would unmap the column.
      expect(splitExerciseHeader('Snatch [comp]')).toEqual({ name: 'Snatch [comp]', block: 'plain' });
      expect(splitExerciseHeader('Snatch [comp] (Target)')).toEqual({ name: 'Snatch [comp]', block: 'target' });
    });

    it('omits unitTag entirely when there is none, so old headers compare equal', () => {
      expect(splitExerciseHeader('SN (Target)')).not.toHaveProperty('unitTag');
    });
  });
});
