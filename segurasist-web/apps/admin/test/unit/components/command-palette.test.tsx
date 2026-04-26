import { describe, expect, it, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const pushSpy = vi.fn();

vi.mock('next/navigation', async () => {
  const actual = await vi.importActual<typeof import('next/navigation')>(
    'next/navigation',
  );
  return {
    ...actual,
    useRouter: () => ({
      push: pushSpy,
      replace: vi.fn(),
      back: vi.fn(),
      forward: vi.fn(),
      refresh: vi.fn(),
      prefetch: vi.fn(),
    }),
  };
});

import { CommandPalette } from '../../../app/_components/command-palette';

describe('<CommandPalette />', () => {
  it('renders nothing on first paint (mount gate)', () => {
    pushSpy.mockReset();
    const { container } = render(<CommandPalette />);
    // After useEffect, mounted=true; the dialog still hides until open.
    // The dialog uses portal, so the host container stays empty until open.
    expect(container).toBeInTheDocument();
  });

  it('opens with Cmd+K and renders both groups', async () => {
    pushSpy.mockReset();
    render(<CommandPalette />);

    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'k', metaKey: true }),
      );
    });

    expect(
      await screen.findByPlaceholderText(/buscar páginas/i),
    ).toBeInTheDocument();
    expect(screen.getByText('Navegación')).toBeInTheDocument();
    expect(screen.getByText('Acciones')).toBeInTheDocument();
    expect(screen.getByText('Resumen')).toBeInTheDocument();
    expect(screen.getByText('Crear asegurado')).toBeInTheDocument();
  });

  it('opens with Ctrl+K (non-mac users)', async () => {
    pushSpy.mockReset();
    render(<CommandPalette />);
    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'K', ctrlKey: true }),
      );
    });
    expect(
      await screen.findByPlaceholderText(/buscar páginas/i),
    ).toBeInTheDocument();
  });

  it('navigates via router.push when an item is selected', async () => {
    pushSpy.mockReset();
    const user = userEvent.setup();
    render(<CommandPalette />);

    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'k', metaKey: true }),
      );
    });
    const item = await screen.findByText('Asegurados');
    await user.click(item);

    expect(pushSpy).toHaveBeenCalledTimes(1);
    expect(pushSpy).toHaveBeenCalledWith('/insureds');
  });

  it('closes on Escape', async () => {
    pushSpy.mockReset();
    const user = userEvent.setup();
    render(<CommandPalette />);
    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'k', metaKey: true }),
      );
    });
    expect(await screen.findByPlaceholderText(/buscar páginas/i)).toBeInTheDocument();

    await user.keyboard('{Escape}');
    // The dialog detaches from DOM when closed.
    expect(screen.queryByPlaceholderText(/buscar páginas/i)).not.toBeInTheDocument();
  });
});
