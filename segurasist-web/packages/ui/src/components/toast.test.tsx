import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import { Toaster, toast } from './toast';

describe('<Toaster> + toast()', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('mounts without throwing', () => {
    expect(() => render(<Toaster />)).not.toThrow();
  });

  it('shows a success toast when toast.success is called', async () => {
    render(<Toaster />);
    act(() => {
      toast.success('Guardado');
    });
    await waitFor(() => {
      expect(screen.getByText('Guardado')).toBeTruthy();
    });
  });

  it('shows an error toast when toast.error is called', async () => {
    render(<Toaster />);
    act(() => {
      toast.error('Falló');
    });
    await waitFor(() => {
      expect(screen.getByText('Falló')).toBeTruthy();
    });
  });

  it('dismisses a toast when toast.dismiss is called by id', async () => {
    render(<Toaster />);
    let id: string | number = '';
    act(() => {
      id = toast('Hola');
    });
    await waitFor(() => {
      expect(screen.getByText('Hola')).toBeTruthy();
    });
    act(() => {
      toast.dismiss(id);
    });
    await waitFor(() => {
      expect(screen.queryByText('Hola')).toBeNull();
    });
  });
});
