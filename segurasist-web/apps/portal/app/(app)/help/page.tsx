import { Card, CardContent, CardHeader, CardTitle, Button } from '@segurasist/ui';
import { Phone, Mail, MessageCircle } from 'lucide-react';

const MAC_PHONE = '+525555555555';
const MAC_EMAIL = 'soporte@hospitalesmac.com.mx';

export default function HelpPage() {
  return (
    <div className="mx-auto flex max-w-md flex-col gap-4 p-4">
      <h1 className="text-2xl font-semibold">Ayuda</h1>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Phone className="h-5 w-5 text-primary" aria-hidden />
            Llamar al call center MAC
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Button asChild className="min-h-[44px] w-full">
            <a href={`tel:${MAC_PHONE}`}>{MAC_PHONE}</a>
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5 text-primary" aria-hidden />
            Escribir por correo
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Button asChild variant="secondary" className="min-h-[44px] w-full">
            <a href={`mailto:${MAC_EMAIL}`}>{MAC_EMAIL}</a>
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MessageCircle className="h-5 w-5 text-primary" aria-hidden />
            Chatbot
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-fg-muted">
            Toca el icono de chat en la esquina inferior derecha para preguntas
            frecuentes sobre tu cobertura, vigencia o paquete.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
