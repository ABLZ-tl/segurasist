import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LoginForm } from '../../../components/auth/login-form';
import { __routerStub } from '../../../vitest.setup';

const VALID_CURP = 'PEPM800101HDFRRR03';
const INVALID_CURP_FORMAT = 'INVALID000000000000';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('<LoginForm />', () => {
  it('renders CURP input, channel select and submit button', () => {
    render(<LoginForm />);
    expect(screen.getByLabelText(/CURP/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/canal de envío/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /enviar código/i })).toBeInTheDocument();
  });

  it('uppercases the CURP as the user types', async () => {
    const user = userEvent.setup();
    render(<LoginForm />);
    const input = screen.getByLabelText(/CURP/i) as HTMLInputElement;

    await user.type(input, 'pepm800101hdfrrr03');

    expect(input.value).toBe(VALID_CURP);
  });

  it('shows an inline error when the CURP format is invalid', async () => {
    const user = userEvent.setup();
    render(<LoginForm />);
    const input = screen.getByLabelText(/CURP/i);

    await user.type(input, INVALID_CURP_FORMAT);
    // Force the touched state by tabbing out so the error can render.
    await user.tab();

    expect(
      await screen.findByText(/no tiene un formato válido/i),
    ).toBeInTheDocument();
  });

  it('keeps the submit button disabled until the CURP is valid', async () => {
    const user = userEvent.setup();
    render(<LoginForm />);
    const button = screen.getByRole('button', { name: /enviar código/i });

    expect(button).toBeDisabled();

    await user.type(screen.getByLabelText(/CURP/i), VALID_CURP);

    expect(button).not.toBeDisabled();
  });

  it('POSTs to /api/auth/portal-otp-request and routes to /otp on success', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ session: 'sess-1', masked: 'm***@gmail.com' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );

    const user = userEvent.setup();
    render(<LoginForm />);
    await user.type(screen.getByLabelText(/CURP/i), VALID_CURP);
    await user.click(screen.getByRole('button', { name: /enviar código/i }));

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/auth/portal-otp-request');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(init?.body as string)).toEqual({
      curp: VALID_CURP,
      channel: 'email',
    });

    await vi.waitFor(() => {
      expect(__routerStub.push).toHaveBeenCalledTimes(1);
    });
    const target = __routerStub.push.mock.calls[0]![0] as string;
    expect(target).toContain('/otp?');
    expect(target).toContain('channel=email');
    expect(target).toContain('session=sess-1');
  });

  it('shows the loading text while the request is in-flight', async () => {
    let resolveFetch!: (v: Response) => void;
    vi.spyOn(globalThis, 'fetch').mockImplementationOnce(
      () =>
        new Promise<Response>((r) => {
          resolveFetch = r;
        }),
    );
    const user = userEvent.setup();
    render(<LoginForm />);
    await user.type(screen.getByLabelText(/CURP/i), VALID_CURP);
    await user.click(screen.getByRole('button', { name: /enviar código/i }));

    expect(await screen.findByText(/enviando/i)).toBeInTheDocument();

    resolveFetch(new Response('{}', { status: 200 }));
  });
});
