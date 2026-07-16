import { describe, it, expect } from 'vitest';
import { describeError, describeUniqueViolation } from '../errorMessage';

/**
 * The shape under test is a real postgrest error: a plain object (NOT an
 * Error), which is exactly why `err instanceof Error` checks used to drop the
 * message on the floor.
 */
const duplicateCategory = {
  code: '23505',
  message:
    'duplicate key value violates unique constraint "categories_owner_name_unique"',
  details: 'Key (owner_id, name)=(00000000-0000-0000-0000-000000000001, Squat) already exists.',
  hint: null,
};

describe('describeUniqueViolation', () => {
  it('maps a known constraint to coach-facing copy', () => {
    expect(describeUniqueViolation(duplicateCategory)).toBe(
      'A category with that name already exists.',
    );
  });

  it('falls back to generic copy for an unmapped 23505', () => {
    expect(
      describeUniqueViolation({ code: '23505', message: 'violates unique constraint "some_other_key"' }),
    ).toBe('That name is already taken — pick a different one.');
  });

  it('returns null for non-unique-violation errors so they keep their real message', () => {
    expect(describeUniqueViolation({ code: '23503', message: 'FK violation' })).toBeNull();
    expect(describeUniqueViolation(new Error('boom'))).toBeNull();
    expect(describeUniqueViolation(null)).toBeNull();
    expect(describeUniqueViolation('a string')).toBeNull();
  });
});

describe('describeError', () => {
  it('gives a duplicate name plain language instead of the constraint dump', () => {
    const msg = describeError(duplicateCategory);
    expect(msg).toBe('A category with that name already exists.');
    // The specific leaks this fix exists to stop.
    expect(msg).not.toContain('constraint');
    expect(msg).not.toContain('owner_id');
    expect(msg).not.toContain('23505');
  });

  it('still surfaces the real detail for other postgrest errors', () => {
    expect(
      describeError({ message: 'column x does not exist', details: 'somewhere', hint: null }),
    ).toBe('column x does not exist — somewhere');
  });

  it('handles Errors, strings and null unchanged', () => {
    expect(describeError(new Error('boom'))).toBe('boom');
    expect(describeError('plain')).toBe('plain');
    expect(describeError(null)).toBe('Unknown error');
  });
});
