'use client';

import * as React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { Route } from 'next';
import { Button } from '@segurasist/ui';
import { OtpInput } from './otp-input';

const CODE_TTL_SECONDS = 5 * 60; // 5 minutes
const RESEND_COOLDOWN_SECONDS = 30;
const MAX_ATTEMPTS = 3;

interface VerifyProblemDetails {
  title?: string;
  detail?: string;
  status?: number;
  attemptsRemaining?: number;
  remainingAttempts?: number;
}

function formatMmSs(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function OtpForm(): JSX.Element {
  const router = useRouter();
  const searchParams = useSearchParams();
  const channel = (searchParams.get('channel') ?? 'email') as 'email' | 'sms';
  const masked = searchParams.get('masked');
  const session = searchParams.get('session');

  const [code, setCode] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [attemptsRemaining, setAttemptsRemaining] = React.useState<number>(MAX_ATTEMPTS);
  const [secondsLeft, setSecondsLeft] = React.useState<number>(CODE_TTL_SECONDS);
  const [resendCooldown, setResendCooldown] = React.useState<number>(RESEND_COOLDOWN_SECONDS);

  // Use a ref so the auto-submit effect doesn't double-fire while the
  // request is in-flight (React 18 strict mode mounts effects twice in dev).
  const submittedRef = React.useRef<string>('');

  React.useEffect(() => {
    const intervalId = window.setInterval(() => {
      setSecondsLeft((s) => (s > 0 ? s - 1 : 0));
      setResendCooldown((s) => (s > 0 ? s - 1 : 0));
    }, 1000);
    return () => window.clearInterval(intervalId);
  }, []);

  const verify = React.useCallback(
    async (value: string): Promise<void> => {
      if (submittedRef.current === value) return;
      submittedRef.current = value;

      setLoading(true);
      setError(null);
      try {
        const res = await fetch('/api/auth/portal-otp-verify', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ code: value, ...(session ? { session } : {}) }),
        });

        if (res.ok) {
          // Hard navigation so the middleware sees the freshly-set cookie.
          window.location.assign('/');
          return;
        }

        let problem: VerifyProblemDetails | null = null;
        try {
          problem = (await res.json()) as VerifyProblemDetails;
        } catch {
          problem = null;
        }

        const remaining =
          typeof problem?.attemptsRemaining === 'number'
            ? problem.attemptsRemaining
            : typeof problem?.remainingAttempts === 'number'
              ? problem.remainingAttempts
              : Math.max(0, attemptsRemaining - 1);
        setAttemptsRemaining(remaining);

        if (remaining <= 0) {
          setError('Sesión expirada. Solicita un nuevo código.');
        } else {
          setError(`Código incorrecto. Te quedan ${remaining} intento${remaining === 1 ? '' : 's'}.`);
        }
        // Allow another submission of the same code if the backend says it's
        // recoverable — otherwise the user has to mutate the code first.
        submittedRef.current = '';
        setCode('');
      } catch {
        setError('No se pudo conectar al servidor. Verifica tu conexión.');
        submittedRef.current = '';
      } finally {
        setLoading(false);
      }
    },
    [attemptsRemaining, session],
  );

  const onResend = async (): Promise<void> => {
    if (resendCooldown > 0 || !session) {
      setResendCooldown(RESEND_COOLDOWN_SECONDS);
      return;
    }
    try {
      await fetch('/api/auth/portal-otp-request', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ session, channel }),
      });
    } catch {
      /* ignore — user will see the original error on next failed verify */
    }
    setSecondsLeft(CODE_TTL_SECONDS);
    setResendCooldown(RESEND_COOLDOWN_SECONDS);
    setAttemptsRemaining(MAX_ATTEMPTS);
    setError(null);
  };

  const expired = secondsLeft === 0 || attemptsRemaining <= 0;
  const countdownTone =
    secondsLeft === 0
      ? 'text-danger'
      : secondsLeft <= 60
        ? 'text-amber-600 dark:text-amber-400'
        : 'text-fg-muted';

  return (
    <div className="space-y-6" data-testid="portal-otp-form">
      <OtpInput
        value={code}
        onChange={setCode}
        onComplete={(v) => {
          if (!expired) {
            void verify(v);
          }
        }}
        disabled={loading || expired}
        invalid={Boolean(error)}
        ariaDescribedBy="otp-status"
      />

      <div id="otp-status" aria-live="polite" className="min-h-[1.25rem] text-center text-sm">
        {error ? (
          <span className="text-danger">{error}</span>
        ) : (
          <span className={countdownTone}>
            {expired
              ? 'El código expiró. Solicita uno nuevo.'
              : `El código vence en ${formatMmSs(secondsLeft)}`}
          </span>
        )}
      </div>

      <Button
        type="button"
        className="w-full active:scale-[0.97]"
        loading={loading}
        loadingText="Verificando..."
        disabled={loading || code.length !== 6 || expired}
        onClick={() => void verify(code)}
      >
        Verificar
      </Button>

      <button
        type="button"
        onClick={() => void onResend()}
        disabled={resendCooldown > 0}
        className="block w-full text-center text-sm font-medium text-accent transition-opacity duration-150 hover:opacity-80 disabled:cursor-not-allowed disabled:text-fg-muted"
      >
        {resendCooldown > 0 ? `Reenviar código en ${resendCooldown}s` : 'Reenviar código'}
      </button>

      <p className="text-center text-xs text-fg-muted">
        ¿Equivocaste tu CURP?{' '}
        <button
          type="button"
          onClick={() => router.push('/login' as Route)}
          className="font-medium text-accent hover:underline"
        >
          Volver
        </button>
      </p>
    </div>
  );
}

export { CODE_TTL_SECONDS, RESEND_COOLDOWN_SECONDS, MAX_ATTEMPTS };
