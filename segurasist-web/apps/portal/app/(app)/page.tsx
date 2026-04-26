import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@segurasist/ui';
import { Download, Phone, ShieldCheck } from 'lucide-react';

export default function PortalHomePage() {
  // Mock data — replaced by `useSession()` + tenant-scoped fetch.
  const insured = {
    name: 'Carmen López',
    pkg: 'Premium',
    validTo: '31 de marzo de 2027',
    status: 'active' as const,
  };

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <p className="text-sm text-fg-muted">Hola,</p>
        <h1 className="text-2xl font-semibold">{insured.name}</h1>
      </header>

      <Card className="border-success">
        <CardContent className="flex flex-col items-center gap-3 p-6 text-center">
          <Badge
            variant={insured.status === 'active' ? 'success' : 'danger'}
            className="text-sm uppercase tracking-wide"
            style={{ fontSize: '1.125rem', padding: '0.5rem 1rem' }}
          >
            {insured.status === 'active' ? 'VIGENTE' : 'VENCIDA'}
          </Badge>
          <p className="text-base">
            Hasta el <span className="font-semibold">{insured.validTo}</span>
          </p>
          <p className="text-sm text-fg-muted">
            Paquete <span className="font-medium text-fg">{insured.pkg}</span>
          </p>
        </CardContent>
      </Card>

      <div className="grid gap-3">
        <Button size="lg" className="w-full">
          <Download aria-hidden className="mr-2 h-5 w-5" />
          Descargar mi certificado
        </Button>
        <Button size="lg" variant="secondary" className="w-full">
          <ShieldCheck aria-hidden className="mr-2 h-5 w-5" />
          Ver coberturas
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>¿Necesitas ayuda?</CardTitle>
          <CardDescription>Llama al call center MAC. Disponible 24/7.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline" className="w-full">
            <a href="tel:+528000000000">
              <Phone aria-hidden className="mr-2 h-5 w-5" />
              Llamar a MAC
            </a>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
