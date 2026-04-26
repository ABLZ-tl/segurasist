'use client';

import * as React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { motion } from 'framer-motion';
import { AlertBanner, Button, Input, toast } from '@segurasist/ui';
import { ArrowRight } from 'lucide-react';

/**
 * Admin credentials login.
 *
 * Posts to the same-origin `/api/auth/local-login` route which forwards to
 * `${API_BASE_URL}/v1/auth/login` server-side and mirrors the resulting
 * session cookies onto the admin origin under the names the middleware
 * expects (`sa_session` / `sa_refresh`).
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface ProblemDetails {
  status?: number;
  title?: string;
  detail?: string;
  code?: string;
  traceId?: string;
}

export const dynamic = 'force-dynamic';

export default function AdminLoginPage(): JSX.Element {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextPath = searchParams.get('next') ?? '/dashboard';

  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [emailError, setEmailError] = React.useState<string | null>(null);
  const [passwordError, setPasswordError] = React.useState<string | null>(null);
  const [formError, setFormError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  const validate = React.useCallback((): boolean => {
    let ok = true;
    if (!email.trim()) {
      setEmailError('Ingresa tu correo electrónico.');
      ok = false;
    } else if (!EMAIL_RE.test(email.trim())) {
      setEmailError('El correo no tiene un formato válido.');
      ok = false;
    } else {
      setEmailError(null);
    }
    if (!password) {
      setPasswordError('Ingresa tu contraseña.');
      ok = false;
    } else {
      setPasswordError(null);
    }
    return ok;
  }, [email, password]);

  const onSubmit = async (e: React.FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    setFormError(null);
    if (!validate()) return;

    setSubmitting(true);
    try {
      const res = await fetch('/api/auth/local-login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email: email.trim(), password }),
      });

      if (res.ok) {
        // Hard navigation so the middleware sees the freshly-set cookie.
        window.location.assign(nextPath);
        return;
      }

      let problem: ProblemDetails | null = null;
      try {
        problem = (await res.json()) as ProblemDetails;
      } catch {
        problem = null;
      }

      if (res.status === 401) {
        setFormError('Credenciales incorrectas. Verifica tu correo y contraseña.');
      } else if (res.status >= 500) {
        const traceId = problem?.traceId ?? res.headers.get('x-trace-id') ?? 'unknown';
        // eslint-disable-next-line no-console
        console.error('[login] server error', { status: res.status, traceId, problem });
        setFormError('Error temporal del servidor, intenta de nuevo.');
        toast.error('Error temporal del servidor', {
          description: `Trace ID: ${traceId}`,
        });
      } else {
        setFormError(problem?.detail ?? problem?.title ?? 'No se pudo iniciar sesión.');
      }
    } catch {
      setFormError('No se pudo conectar al servidor. Verifica tu conexión.');
    } finally {
      setSubmitting(false);
    }
  };

  // Suppress unused-import warning when typedRoutes shifts router types
  void router;

  return (
    <div className="flex min-h-screen flex-col bg-bg md:grid md:grid-cols-2">
      <header className="flex h-16 shrink-0 items-center justify-between border-b border-border px-6 md:hidden">
        <div className="flex items-center gap-2">
          <div className="grid h-7 w-7 place-items-center rounded-md bg-fg text-bg">
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2">
              <path d="M5 12l4 4L19 6" />
            </svg>
          </div>
          <span className="text-[15px] font-semibold tracking-tightest text-fg">SegurAsist</span>
        </div>
        <span className="text-[12px] uppercase tracking-wider text-fg-subtle">Plataforma MAC</span>
      </header>

      <motion.section
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.18, delay: 0.08, ease: [0.16, 1, 0.3, 1] }}
        className="relative flex min-h-[calc(100vh-64px)] items-center justify-center px-6 py-10 md:min-h-0 md:px-12 md:py-12"
      >
        <div className="w-full max-w-[400px] space-y-7 md:space-y-8">
          <div className="hidden items-center gap-2 md:flex">
            <div className="grid h-7 w-7 place-items-center rounded-md bg-fg text-bg">
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2">
                <path d="M5 12l4 4L19 6" />
              </svg>
            </div>
            <span className="text-[15px] font-semibold tracking-tightest text-fg">SegurAsist</span>
          </div>

          <div className="space-y-2">
            <h1 className="text-2xl font-semibold tracking-tightest text-fg md:text-[28px]">Inicia sesión</h1>
            <p className="text-sm text-fg-muted">
              Accede a la consola de administración con tu cuenta corporativa.
            </p>
          </div>

          <form onSubmit={onSubmit} noValidate className="space-y-5">
            {formError && (
              <AlertBanner tone="danger" title="No pudimos iniciar sesión">
                {formError}
              </AlertBanner>
            )}

            <div className="space-y-2">
              <label htmlFor="email" className="text-[13px] font-medium text-fg">
                Correo electrónico
              </label>
              <Input
                id="email"
                name="email"
                type="email"
                inputMode="email"
                autoComplete="username"
                required
                value={email}
                placeholder="nombre@hospitalesmac.com"
                onChange={(e) => setEmail(e.target.value)}
                invalid={!!emailError}
                aria-describedby={emailError ? 'email-error' : undefined}
                disabled={submitting}
              />
              {emailError && (
                <p id="email-error" role="alert" className="text-xs text-danger">
                  {emailError}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <div className="flex items-baseline justify-between">
                <label htmlFor="password" className="text-[13px] font-medium text-fg">
                  Contraseña
                </label>
                <a
                  href="#"
                  className="text-xs text-fg-muted transition-colors duration-fast hover:text-accent"
                >
                  ¿Olvidaste tu contraseña?
                </a>
              </div>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                invalid={!!passwordError}
                aria-describedby={passwordError ? 'password-error' : undefined}
                disabled={submitting}
              />
              {passwordError && (
                <p id="password-error" role="alert" className="text-xs text-danger">
                  {passwordError}
                </p>
              )}
            </div>

            <Button
              type="submit"
              className="group w-full"
              loading={submitting}
              loadingText="Verificando..."
            >
              <span>Continuar</span>
              <ArrowRight className="h-4 w-4 transition-transform duration-fast group-hover:translate-x-0.5" />
            </Button>
          </form>

          <p className="text-xs text-fg-subtle">
            Al continuar aceptas el uso operativo del sistema. Tus accesos están auditados.
          </p>
        </div>
      </motion.section>

      <motion.aside
        initial={{ opacity: 0, x: 16 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
        aria-hidden
        className="relative hidden overflow-hidden border-l border-border bg-bg-elevated md:block"
      >
        <div className="absolute inset-0 grid-bg opacity-40" />
        <div className="absolute inset-0 mask-fade-edges">
          <svg
            className="absolute inset-0 h-full w-full text-accent/20"
            viewBox="0 0 600 800"
            preserveAspectRatio="xMidYMid slice"
          >
            <defs>
              <radialGradient id="g1" cx="50%" cy="40%" r="60%">
                <stop offset="0%" stopColor="hsl(var(--accent) / 0.18)" />
                <stop offset="100%" stopColor="transparent" />
              </radialGradient>
            </defs>
            <rect width="600" height="800" fill="url(#g1)" />
            <g stroke="currentColor" strokeWidth="0.8" fill="none">
              <circle cx="300" cy="380" r="80" />
              <circle cx="300" cy="380" r="140" opacity="0.7" />
              <circle cx="300" cy="380" r="220" opacity="0.45" />
              <circle cx="300" cy="380" r="320" opacity="0.25" />
            </g>
            <g stroke="hsl(var(--fg) / 0.12)" strokeWidth="0.8">
              <line x1="0" y1="380" x2="600" y2="380" />
              <line x1="300" y1="0" x2="300" y2="800" />
            </g>
          </svg>
        </div>

        <div className="relative flex h-full flex-col justify-between p-12">
          <div className="flex items-center gap-2 text-[13px] text-fg-muted">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-success" />
            Plataforma operativa
          </div>
          <div className="max-w-[360px] space-y-4">
            <p className="text-[15px] font-medium tracking-tighter text-fg">
              Plataforma de gestión de pólizas para hospitales MAC.
            </p>
            <p className="text-sm text-fg-muted">
              Asegurados, lotes, certificados y reportes en una sola consola, con trazabilidad por
              tenant y aislamiento por RLS.
            </p>
          </div>
        </div>
      </motion.aside>
    </div>
  );
}
