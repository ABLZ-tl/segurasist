'use client';

import * as React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { Route } from 'next';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  Button,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  cn,
} from '@segurasist/ui';
import { ArrowRight, CheckCircle2, Mail, Phone } from 'lucide-react';

/**
 * Mexican CURP regex — RENAPO format:
 *   4 letters · 6 digits (YYMMDD) · H/M · 5 letters · 1 alphanum · 1 digit
 * The full validation (homoclave checksum) lives on the backend; this regex
 * exists purely so we can give immediate visual feedback while typing.
 */
const CURP_RE = /^[A-Z]{4}\d{6}[HM][A-Z]{5}[A-Z0-9]\d$/;

const schema = z.object({
  curp: z
    .string()
    .min(1, 'Ingresa tu CURP.')
    .length(18, 'La CURP tiene 18 caracteres.')
    .regex(CURP_RE, 'La CURP no tiene un formato válido.'),
  channel: z.enum(['email', 'sms']),
});

type FormValues = z.infer<typeof schema>;

interface ProblemDetails {
  title?: string;
  detail?: string;
  status?: number;
  channel?: 'email' | 'sms';
  masked?: string;
  session?: string;
}

export function LoginForm(): JSX.Element {
  const router = useRouter();
  const searchParams = useSearchParams();
  const errorParam = searchParams.get('error');

  const [submitting, setSubmitting] = React.useState(false);
  const [formError, setFormError] = React.useState<string | null>(
    errorParam === 'admin_must_use_admin_portal'
      ? 'Tu cuenta es de administrador. Ingresa al portal de administración.'
      : null,
  );

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors, touchedFields },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    mode: 'onChange',
    defaultValues: { curp: '', channel: 'email' },
  });

  const curp = watch('curp');
  const channel = watch('channel');
  const curpRegister = register('curp');

  const curpIsValid = CURP_RE.test(curp);
  const curpTouched = Boolean(touchedFields.curp) && curp.length > 0;
  const showCurpError = curpTouched && !curpIsValid;

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    setSubmitting(true);
    try {
      const res = await fetch('/api/auth/portal-otp-request', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ curp: values.curp, channel: values.channel }),
      });

      // Anti-enumeration: regardless of upstream outcome (200 / 404 / locked /
      // throttled) we treat 2xx as "code dispatched" and route forward. Other
      // statuses surface a generic message — the upstream is also expected to
      // 200 on unknown CURPs to prevent enumeration.
      if (res.ok) {
        let problem: ProblemDetails | null = null;
        try {
          problem = (await res.json()) as ProblemDetails;
        } catch {
          problem = null;
        }
        const params = new URLSearchParams({ channel: values.channel });
        if (problem?.session) params.set('session', problem.session);
        if (problem?.masked) params.set('masked', problem.masked);
        router.push(`/otp?${params.toString()}` as Route);
        return;
      }

      let problem: ProblemDetails | null = null;
      try {
        problem = (await res.json()) as ProblemDetails;
      } catch {
        problem = null;
      }
      if (res.status === 429) {
        setFormError('Demasiados intentos. Intenta de nuevo en unos minutos.');
      } else {
        setFormError(
          problem?.detail ?? problem?.title ?? 'No pudimos enviar el código. Intenta de nuevo.',
        );
      }
    } catch {
      setFormError('No se pudo conectar al servidor. Verifica tu conexión.');
    } finally {
      setSubmitting(false);
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-5" data-testid="portal-login-form">
      {formError && (
        <p
          role="alert"
          className="rounded-md border border-danger/40 bg-danger/5 px-3 py-2 text-sm text-danger"
        >
          {formError}
        </p>
      )}

      <div className="space-y-2">
        <label htmlFor="curp" className="text-[13px] font-medium text-fg">
          CURP
        </label>
        <div className="relative">
          <Input
            id="curp"
            inputMode="text"
            autoComplete="off"
            spellCheck={false}
            placeholder="Ej. PEPM800101HDFRRR03"
            maxLength={18}
            required
            invalid={showCurpError}
            aria-describedby={showCurpError ? 'curp-error' : 'curp-help'}
            name={curpRegister.name}
            ref={curpRegister.ref}
            onBlur={curpRegister.onBlur}
            value={curp}
            // CURP is uppercase by spec — we override RHF's uncontrolled
            // onChange so the visible value always matches the validated
            // value. `setValue` keeps RHF state + dirty/touched in sync.
            onChange={(e) => {
              const upper = e.target.value.toUpperCase();
              setValue('curp', upper, {
                shouldValidate: true,
                shouldTouch: true,
                shouldDirty: true,
              });
            }}
            className={cn(
              'pr-10 font-mono uppercase tracking-wider',
              curpIsValid && 'border-success focus-visible:ring-success',
              showCurpError && 'border-danger focus-visible:ring-danger',
            )}
          />
          {curpIsValid && (
            <CheckCircle2
              aria-hidden
              className="pointer-events-none absolute right-3 top-1/2 h-5 w-5 -translate-y-1/2 text-success"
            />
          )}
        </div>
        {showCurpError ? (
          <p id="curp-error" role="alert" className="text-xs text-danger">
            {errors.curp?.message ?? 'La CURP no tiene un formato válido.'}
          </p>
        ) : (
          <p id="curp-help" className="text-xs text-fg-muted">
            18 caracteres. La encuentras en tu acta de nacimiento o INE.
          </p>
        )}
      </div>

      <div className="space-y-2">
        <label htmlFor="channel" className="text-[13px] font-medium text-fg">
          ¿Cómo prefieres recibir el código?
        </label>
        <Select
          value={channel}
          onValueChange={(v) => setValue('channel', v as 'email' | 'sms')}
        >
          <SelectTrigger id="channel" aria-label="Canal de envío">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="email">
              <span className="inline-flex items-center gap-2">
                <Mail aria-hidden className="h-4 w-4" /> Correo electrónico
              </span>
            </SelectItem>
            <SelectItem
              value="sms"
              disabled
              className="cursor-not-allowed opacity-50"
              aria-label="SMS — próximamente disponible"
            >
              <span className="inline-flex items-center gap-2">
                <Phone aria-hidden className="h-4 w-4" /> SMS (próximamente)
              </span>
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Button
        type="submit"
        className="group w-full active:scale-[0.97]"
        loading={submitting}
        loadingText="Enviando..."
        disabled={submitting || !curpIsValid}
      >
        <span>Enviar código</span>
        <ArrowRight className="h-4 w-4 transition-transform duration-150 group-hover:translate-x-0.5" />
      </Button>

      <p className="text-center text-xs text-fg-muted">
        ¿Olvidaste tu CURP?{' '}
        <a href="tel:+525555555555" className="font-medium text-accent hover:underline">
          Llama al call center MAC
        </a>
      </p>
    </form>
  );
}
