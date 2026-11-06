import { describe, expect, it } from 'vitest';
import { initialsOf } from './initials';

describe('initialsOf', () => {
  it('takes the first letters of the first two words of a name', () => {
    expect(initialsOf({ displayName: 'Ada Lovelace King' })).toBe('AL');
    expect(initialsOf({ displayName: 'cher' })).toBe('C');
  });

  it('reads an address the same way when there is no name', () => {
    expect(initialsOf({ email: 'john.smith@example.com' })).toBe('JS');
    expect(initialsOf({ displayName: '', email: 'ops@example.com' })).toBe('OE');
  });

  it('falls back to a question mark', () => {
    expect(initialsOf({})).toBe('?');
    expect(initialsOf({ displayName: '   ' })).toBe('?');
  });
});
