import { Button, Card, CardContent } from '@segurasist/ui';
import { Download, Mail } from 'lucide-react';

export default function CertificatePage() {
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Mi certificado</h1>

      <div className="grid gap-3">
        <Button size="lg" className="w-full">
          <Download aria-hidden className="mr-2 h-5 w-5" />
          Descargar PDF
        </Button>
        <Button asChild size="lg" variant="secondary" className="w-full">
          <a href="mailto:?subject=Mi%20certificado%20MAC">
            <Mail aria-hidden className="mr-2 h-5 w-5" />
            Compartir por correo
          </a>
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <iframe
            title="Vista previa del certificado"
            src="/api/proxy/v1/me/certificate?format=pdf"
            className="h-[60vh] w-full rounded-md"
          />
        </CardContent>
      </Card>
    </div>
  );
}
