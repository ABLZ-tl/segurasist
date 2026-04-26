'use client';

import * as React from 'react';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input } from '@segurasist/ui';
import { useRouter } from 'next/navigation';

const RESEND_SECONDS = 30;

export default function PortalOtpPage() {
  const router = useRouter();
  const [code, setCode] = React.useState('');
  const [secondsLeft, setSecondsLeft] = React.useState(RESEND_SECONDS);
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    const t = window.setInterval(() => {
      setSecondsLeft((s) => (s > 0 ? s - 1 : 0));
    }, 1000);
    return () => window.clearInterval(t);
  }, []);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (code.length !== 6) return;
    setLoading(true);
    // TODO wire to useVerifyOtp().
    setTimeout(() => {
      setLoading(false);
      router.push('/');
    }, 400);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle>Ingresa tu código</CardTitle>
          <CardDescription>Te lo enviamos hace unos segundos.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4">
            <div>
              <label htmlFor="otp" className="sr-only">
                Código de 6 dígitos
              </label>
              <Input
                id="otp"
                autoFocus
                inputMode="numeric"
                pattern="\d{6}"
                maxLength={6}
                autoComplete="one-time-code"
                placeholder="000000"
                className="text-center text-2xl tracking-[0.5em]"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              />
            </div>

            <Button type="submit" className="w-full" loading={loading} disabled={code.length !== 6}>
              Verificar
            </Button>

            <button
              type="button"
              disabled={secondsLeft > 0}
              onClick={() => setSecondsLeft(RESEND_SECONDS)}
              className="block w-full text-center text-sm text-accent disabled:cursor-not-allowed disabled:text-fg-muted"
            >
              {secondsLeft > 0 ? `Reenviar en ${secondsLeft}s` : 'Reenviar código'}
            </button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
