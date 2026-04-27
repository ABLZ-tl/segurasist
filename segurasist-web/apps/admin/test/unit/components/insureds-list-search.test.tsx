import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDebouncedValue } from '../../../lib/hooks/use-debounced-value';

describe('useDebouncedValue (S3-07 — debounce 300ms)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('devuelve el valor inicial inmediatamente', () => {
    const { result } = renderHook(() => useDebouncedValue('hola', 300));
    expect(result.current).toBe('hola');
  });

  it('NO cambia el valor antes de los 300ms', () => {
    const { result, rerender } = renderHook(({ v }: { v: string }) => useDebouncedValue(v, 300), {
      initialProps: { v: 'a' },
    });
    rerender({ v: 'ab' });
    rerender({ v: 'abc' });
    act(() => {
      vi.advanceTimersByTime(150);
    });
    // Pasaron 150ms <300ms → sigue valor inicial.
    expect(result.current).toBe('a');
  });

  it('actualiza al pasar exactamente 300ms desde el último cambio', () => {
    const { result, rerender } = renderHook(({ v }: { v: string }) => useDebouncedValue(v, 300), {
      initialProps: { v: 'a' },
    });
    rerender({ v: 'lopez' });
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(result.current).toBe('lopez');
  });

  it('typing rápido reinicia el timer (cancel previous)', () => {
    const { result, rerender } = renderHook(({ v }: { v: string }) => useDebouncedValue(v, 300), {
      initialProps: { v: '' },
    });
    rerender({ v: 'l' });
    act(() => {
      vi.advanceTimersByTime(200);
    });
    rerender({ v: 'lo' });
    act(() => {
      vi.advanceTimersByTime(200);
    });
    rerender({ v: 'lop' });
    act(() => {
      vi.advanceTimersByTime(200);
    });
    // En total 600ms pero como cada cambio reinicia el timer, aún no cumplió 300
    // desde el último cambio.
    expect(result.current).toBe('');
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(result.current).toBe('lop');
  });
});
