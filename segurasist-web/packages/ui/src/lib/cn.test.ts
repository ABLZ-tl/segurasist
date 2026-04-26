import { describe, it, expect } from 'vitest';
import { cn } from './cn';

describe('cn()', () => {
  it('merges plain strings', () => {
    expect(cn('a', 'b', 'c')).toBe('a b c');
  });

  it('drops falsy values', () => {
    expect(cn('a', false, undefined, null, 'b')).toBe('a b');
  });

  it('deduplicates conflicting tailwind classes (last wins)', () => {
    expect(cn('px-2', 'px-4')).toBe('px-4');
  });

  it('preserves non-conflicting tailwind classes', () => {
    expect(cn('px-2', 'py-2')).toBe('px-2 py-2');
  });

  it('supports arrays and objects (clsx semantics)', () => {
    expect(cn(['a', { b: true, c: false }])).toBe('a b');
  });
});
