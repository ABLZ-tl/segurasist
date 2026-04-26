'use client';

import * as React from 'react';
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@segurasist/ui';
import { useRouter } from 'next/navigation';

export default function PortalLoginPage() {
  const router = useRouter();
  const [curp, setCurp] = React.useState('');
  const [channel, setChannel] = React.useState<'email' | 'sms'>('email');
  const [loading, setLoading] = React.useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    // TODO wire to useRequestOtp() when API is up.
    setTimeout(() => {
      setLoading(false);
      router.push(`/otp?channel=${channel}`);
    }, 400);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle>Mi Membresía MAC</CardTitle>
          <CardDescription>Te enviaremos un código de un solo uso.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-1">
              <label htmlFor="curp" className="text-sm font-medium">
                CURP
              </label>
              <Input
                id="curp"
                inputMode="text"
                autoComplete="off"
                placeholder="Ej. CARM920101MDFRPN08"
                maxLength={18}
                required
                value={curp}
                onChange={(e) => setCurp(e.target.value.toUpperCase())}
              />
              <p className="text-xs text-fg-muted">
                18 caracteres. Lo encuentras en tu acta o INE.
              </p>
            </div>

            <div className="space-y-1">
              <label htmlFor="channel" className="text-sm font-medium">
                ¿Cómo prefieres recibir el código?
              </label>
              <Select value={channel} onValueChange={(v) => setChannel(v as 'email' | 'sms')}>
                <SelectTrigger id="channel" aria-label="Canal de envío">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="email">Correo electrónico</SelectItem>
                  <SelectItem value="sms">SMS</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <Button type="submit" className="w-full" loading={loading} loadingText="Enviando...">
              Enviar código
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
