'use client';

import * as React from 'react';
import { cn } from '@segurasist/ui';

/**
 * 6-cell OTP input component.
 *
 * - Each cell is a 1-character `<input inputMode="numeric">` with `font-mono`
 *   styling so the digits visually separate from surrounding UI copy.
 * - Typing a digit advances the focus to the next cell.
 * - Backspace on an empty cell rewinds to the previous cell so users can
 *   delete from the right without re-clicking.
 * - Pasting a 6-digit string fills all cells in one shot (the most common
 *   real-world OTP flow on mobile).
 * - When the 6th digit is filled (either by typing or paste), `onComplete`
 *   fires once with the joined value.
 */
export interface OtpInputProps {
  length?: number;
  value: string;
  onChange: (next: string) => void;
  onComplete?: (value: string) => void;
  disabled?: boolean;
  invalid?: boolean;
  autoFocus?: boolean;
  ariaLabel?: string;
  ariaDescribedBy?: string;
}

const ONLY_DIGITS = /\D/g;

export function OtpInput({
  length = 6,
  value,
  onChange,
  onComplete,
  disabled = false,
  invalid = false,
  autoFocus = true,
  ariaLabel = 'Código de verificación',
  ariaDescribedBy,
}: OtpInputProps): JSX.Element {
  const refs = React.useRef<Array<HTMLInputElement | null>>([]);
  const lastCompletedRef = React.useRef<string>('');

  // Normalise the controlled value to exactly `length` chars (digit-only).
  const cells = React.useMemo(() => {
    const sanitised = value.replace(ONLY_DIGITS, '').slice(0, length);
    const padded = sanitised.padEnd(length, ' ');
    return Array.from({ length }, (_, i) => {
      const ch = padded.charAt(i);
      return ch === ' ' ? '' : ch;
    });
  }, [value, length]);

  React.useEffect(() => {
    if (value.length === length && value !== lastCompletedRef.current) {
      lastCompletedRef.current = value;
      onComplete?.(value);
    }
    if (value.length < length) {
      lastCompletedRef.current = '';
    }
  }, [value, length, onComplete]);

  React.useEffect(() => {
    if (autoFocus) {
      refs.current[0]?.focus();
    }
  }, [autoFocus]);

  const focusCell = (index: number): void => {
    const target = refs.current[Math.min(Math.max(index, 0), length - 1)];
    target?.focus();
    target?.select();
  };

  const writeAt = (index: number, digit: string): void => {
    const next = cells.slice();
    next[index] = digit;
    onChange(next.join('').replace(ONLY_DIGITS, ''));
  };

  const handleChange = (
    index: number,
    e: React.ChangeEvent<HTMLInputElement>,
  ): void => {
    const raw = e.target.value.replace(ONLY_DIGITS, '');
    if (raw.length === 0) {
      writeAt(index, '');
      return;
    }
    // If a user types into an already-filled cell, the input value is 2
    // chars — keep the new (last) one and advance.
    const digit = raw.charAt(raw.length - 1);
    writeAt(index, digit);
    if (index < length - 1) focusCell(index + 1);
  };

  const handleKeyDown = (
    index: number,
    e: React.KeyboardEvent<HTMLInputElement>,
  ): void => {
    if (e.key === 'Backspace') {
      if (cells[index]) {
        writeAt(index, '');
        return;
      }
      if (index > 0) {
        e.preventDefault();
        writeAt(index - 1, '');
        focusCell(index - 1);
      }
      return;
    }
    if (e.key === 'ArrowLeft' && index > 0) {
      e.preventDefault();
      focusCell(index - 1);
      return;
    }
    if (e.key === 'ArrowRight' && index < length - 1) {
      e.preventDefault();
      focusCell(index + 1);
    }
  };

  const handlePaste = (
    index: number,
    e: React.ClipboardEvent<HTMLInputElement>,
  ): void => {
    const pasted = e.clipboardData.getData('text').replace(ONLY_DIGITS, '');
    if (pasted.length === 0) return;
    e.preventDefault();
    const next = cells.slice();
    for (let i = 0; i < length; i += 1) {
      const sourceIndex = i - index;
      if (sourceIndex >= 0 && sourceIndex < pasted.length) {
        next[i] = pasted.charAt(sourceIndex);
      }
    }
    const joined = next.join('').replace(/\s/g, '');
    onChange(joined);
    const filledTo = Math.min(index + pasted.length, length);
    focusCell(filledTo >= length ? length - 1 : filledTo);
  };

  return (
    <div
      role="group"
      aria-label={ariaLabel}
      aria-describedby={ariaDescribedBy}
      className="flex items-center justify-center gap-2 sm:gap-3"
    >
      {cells.map((char, i) => (
        <input
          // eslint-disable-next-line react/no-array-index-key
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="text"
          inputMode="numeric"
          autoComplete={i === 0 ? 'one-time-code' : 'off'}
          maxLength={1}
          disabled={disabled}
          aria-label={`Dígito ${i + 1} de ${length}`}
          aria-invalid={invalid || undefined}
          value={char}
          onChange={(e) => handleChange(i, e)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          onPaste={(e) => handlePaste(i, e)}
          onFocus={(e) => e.currentTarget.select()}
          data-testid={`otp-cell-${i}`}
          className={cn(
            'h-14 w-12 rounded-lg border-2 bg-bg text-center font-mono text-2xl text-fg shadow-sm',
            'transition-colors duration-150 ease-out',
            'focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2 focus:ring-offset-bg',
            invalid
              ? 'border-danger focus:border-danger focus:ring-danger'
              : 'border-border focus:border-accent',
            disabled && 'cursor-not-allowed opacity-50',
          )}
        />
      ))}
    </div>
  );
}
