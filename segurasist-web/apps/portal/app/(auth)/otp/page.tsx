'use client';

import * as React from 'react';
import { useSearchParams } from 'next/navigation';
import { motion } from 'framer-motion';
import { OtpForm } from '../../../components/auth/otp-form';

export const dynamic = 'force-dynamic';

export default function PortalOtpPage(): JSX.Element {
  return (
    <React.Suspense
      fallback={
        <div
          aria-hidden
          className="min-h-screen bg-gradient-to-b from-bg to-accent/5"
        />
      }
    >
      <OtpScreen />
    </React.Suspense>
  );
}

function OtpScreen(): JSX.Element {
  const searchParams = useSearchParams();
  const channel = (searchParams.get('channel') ?? 'email') as 'email' | 'sms';
  const masked = searchParams.get('masked');

  const subtitle =
    channel === 'sms'
      ? `Revisa tu SMS${masked ? ` (${masked})` : ''}.`
      : `Revisa tu correo${masked ? ` (${masked})` : ''}.`;

  return (
    <div
      className="relative flex min-h-screen flex-col items-center justify-center bg-gradient-to-b from-bg via-bg to-accent/5 px-4 py-10 dark:via-bg dark:to-accent/10"
      style={{
        paddingTop: 'max(env(safe-area-inset-top), 2.5rem)',
        paddingBottom: 'max(env(safe-area-inset-bottom), 2.5rem)',
      }}
    >
      <motion.main
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
        className="w-full max-w-md"
      >
        <header className="mb-8 flex flex-col items-center gap-3 text-center">
          <div className="grid h-12 w-12 place-items-center rounded-xl bg-fg text-bg shadow-sm">
            <svg
              viewBox="0 0 24 24"
              className="h-6 w-6"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              aria-hidden
            >
              <path d="M5 12l4 4L19 6" />
            </svg>
          </div>
          <span className="text-[11px] font-medium uppercase tracking-wider text-fg-subtle">
            Hospitales MAC
          </span>
        </header>

        <div className="space-y-2 pb-6 text-center">
          <h1 className="text-3xl font-bold tracking-tight text-fg">Código enviado</h1>
          <p className="text-[15px] text-fg-muted">{subtitle}</p>
        </div>

        <div className="rounded-2xl border border-border bg-bg-elevated/60 p-5 shadow-sm backdrop-blur-sm sm:p-6">
          <OtpForm />
        </div>
      </motion.main>
    </div>
  );
}
