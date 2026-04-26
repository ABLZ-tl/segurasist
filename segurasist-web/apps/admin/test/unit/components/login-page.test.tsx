import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Stub @segurasist/ui's `toast` module so we don't depend on sonner's
// portal mounting in jsdom.
vi.mock('@segurasist/ui', async () => {
  const actual = await vi.importActual<typeof import('@segurasist/ui')>(
    '@segurasist/ui',
  );
  const toastFn = Object.assign(vi.fn(), {
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    message: vi.fn(),
    promise: vi.fn(),
    dismiss: vi.fn(),
    custom: vi.fn(),
    loading: vi.fn(),
  });
  return {
    ...actual,
    toast: toastFn,
  };
});

import LoginPage from '../../../app/(auth)/login/page';

const originalLocation = window.location;
const assignSpy = vi.fn();

beforeEach(() => {
  // Some tests assert on window.location.assign for the success path.
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...originalLocation, assign: assignSpy },
  });
  assignSpy.mockReset();
});

afterEach(() => {
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: originalLocation,
  });
  vi.restoreAllMocks();
});

describe('<LoginPage />', () => {
  it('shows inline error when email is empty on submit', async () => {
    const user = userEvent.setup();
    render(<LoginPage />);

    await user.type(screen.getByLabelText(/contraseña/i), 'secret');
    await user.click(screen.getByRole('button', { name: /continuar/i }));

    expect(
      await screen.findByText(/ingresa tu correo electrónico/i),
    ).toBeInTheDocument();
  });

  it('shows inline error when email format is invalid', async () => {
    const user = userEvent.setup();
    render(<LoginPage />);

    await user.type(screen.getByLabelText(/correo/i), 'not-an-email');
    await user.type(screen.getByLabelText(/contraseña/i), 'secret');
    await user.click(screen.getByRole('button', { name: /continuar/i }));

    expect(
      await screen.findByText(/no tiene un formato válido/i),
    ).toBeInTheDocument();
  });

  it('shows inline error when password is empty', async () => {
    const user = userEvent.setup();
    render(<LoginPage />);

    await user.type(screen.getByLabelText(/correo/i), 'a@b.c');
    await user.click(screen.getByRole('button', { name: /continuar/i }));

    expect(
      await screen.findByText(/ingresa tu contraseña/i),
    ).toBeInTheDocument();
  });

  it('posts to /api/auth/local-login with credentials include on a valid submit', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('{}', { status: 200 }));

    const user = userEvent.setup();
    render(<LoginPage />);

    await user.type(screen.getByLabelText(/correo/i), 'op@hospitalesmac.com');
    await user.type(screen.getByLabelText(/contraseña/i), 'Sup3rSecret!');
    await user.click(screen.getByRole('button', { name: /continuar/i }));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/auth/local-login');
    expect(init?.method).toBe('POST');
    expect(init?.credentials).toBe('include');
    expect(JSON.parse(init?.body as string)).toEqual({
      email: 'op@hospitalesmac.com',
      password: 'Sup3rSecret!',
    });
  });

  it('shows "Credenciales incorrectas" on a 401 response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ title: 'unauthorized' }), { status: 401 }),
    );

    const user = userEvent.setup();
    render(<LoginPage />);
    await user.type(screen.getByLabelText(/correo/i), 'a@b.c');
    await user.type(screen.getByLabelText(/contraseña/i), 'wrong');
    await user.click(screen.getByRole('button', { name: /continuar/i }));

    expect(
      await screen.findByText(/credenciales incorrectas/i),
    ).toBeInTheDocument();
  });

  it('shows "Error temporal" on a 500 response', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ title: 'oops' }), {
        status: 500,
        headers: { 'x-trace-id': 'tr-1' },
      }),
    );

    const user = userEvent.setup();
    render(<LoginPage />);
    await user.type(screen.getByLabelText(/correo/i), 'a@b.c');
    await user.type(screen.getByLabelText(/contraseña/i), 'p');
    await user.click(screen.getByRole('button', { name: /continuar/i }));

    expect(
      await screen.findByText(/error temporal del servidor/i),
    ).toBeInTheDocument();
  });

  it('falls back to a generic message on 4xx without a problem body', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('not json', { status: 422 }),
    );

    const user = userEvent.setup();
    render(<LoginPage />);
    await user.type(screen.getByLabelText(/correo/i), 'a@b.c');
    await user.type(screen.getByLabelText(/contraseña/i), 'p');
    await user.click(screen.getByRole('button', { name: /continuar/i }));

    expect(
      await screen.findByText(/no se pudo iniciar sesión/i),
    ).toBeInTheDocument();
  });

  it('navigates to ?next= via window.location.assign on success', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('{}', { status: 200 }),
    );
    const user = userEvent.setup();
    render(<LoginPage />);
    await user.type(screen.getByLabelText(/correo/i), 'a@b.c');
    await user.type(screen.getByLabelText(/contraseña/i), 'p');
    await user.click(screen.getByRole('button', { name: /continuar/i }));

    // The page reads searchParams which the setup mock returns empty → /dashboard.
    await vi.waitFor(() => {
      expect(assignSpy).toHaveBeenCalledWith('/dashboard');
    });
  });

  it('shows a network error if fetch rejects', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('offline'));
    const user = userEvent.setup();
    render(<LoginPage />);
    await user.type(screen.getByLabelText(/correo/i), 'a@b.c');
    await user.type(screen.getByLabelText(/contraseña/i), 'p');
    await user.click(screen.getByRole('button', { name: /continuar/i }));

    expect(
      await screen.findByText(/no se pudo conectar al servidor/i),
    ).toBeInTheDocument();
  });
});
