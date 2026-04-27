'use client';

/**
 * Portal asegurado — Mi certificado.
 *
 * Renderiza preview del PDF en `<iframe sandbox>` (sin `allow-scripts` para
 * defensa en profundidad — solo necesitamos same-origin para el embed). El
 * botón principal abre el PDF en una pestaña nueva (`window.open` con
 * `noopener`), el secundario arma `mailto:` con la URL pre-firmada.
 *
 * Nota seguridad: la URL pre-firmada expira en `expiresAt`. El hook tiene
 * `staleTime: 60s` para que un click después de inactividad re-fetche.
 */

import * as React from 'react';
import { motion } from 'framer-motion';
import { Download, FileText, Mail, XCircle } from 'lucide-react';
import {
  Button,
  Card,
  CardContent,
  EmptyState,
  Skeleton,
} from '@segurasist/ui';
import { useCertificateMine } from '@segurasist/api-client/hooks/certificates';
import type { CertificateMine } from '@segurasist/api-client/hooks/certificates';
import { ProblemDetailsError } from '@segurasist/api-client';
import { formatLongDate } from '@/lib/hooks/use-formatted-date';

export default function CertificatePage() {
  const { data, isLoading, isError, error, refetch } = useCertificateMine();

  if (isLoading) return <CertificateSkeleton />;

  if (isError) {
    const status =
      error instanceof ProblemDetailsError ? error.status : undefined;
    if (status === 404) return <CertificateEmptyState />;
    return <CertificateErrorState onRetry={() => refetch()} />;
  }

  if (!data) return <CertificateEmptyState />;

  return <CertificateContent data={data} />;
}

function CertificateContent({ data }: { data: CertificateMine }) {
  const issuedStr = formatLongDate(data.issuedAt);
  const validToStr = formatLongDate(data.validTo);

  const handleDownload = () => {
    if (typeof window !== 'undefined') {
      window.open(data.url, '_blank', 'noopener,noreferrer');
    }
  };

  const mailto = `mailto:?subject=${encodeURIComponent(
    'Mi certificado MAC',
  )}&body=${encodeURIComponent(
    `Comparto mi certificado MAC. Puedes descargarlo aquí:\n\n${data.url}`,
  )}`;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: 'easeOut' }}
      className="mx-auto max-w-md space-y-4 px-4 pb-8 pt-4 md:max-w-2xl"
      data-testid="certificate-content"
    >
      <header className="space-y-1">
        <h1 className="text-2xl font-bold">Tu certificado</h1>
        <p className="text-sm text-fg-muted">
          Emitido el {issuedStr}, vigente hasta{' '}
          <span className="font-medium text-fg">{validToStr}</span>.
        </p>
      </header>

      <Card>
        <CardContent className="p-0">
          <div className="relative aspect-[3/4] w-full overflow-hidden rounded-md bg-surface">
            <iframe
              title="Vista previa de tu certificado"
              src={data.url}
              sandbox="allow-same-origin"
              className="absolute inset-0 h-full w-full"
              data-testid="certificate-preview"
            />
            {/* Texto fallback debajo del iframe — solo visible si el iframe
                no carga (z-0). La accesibilidad la maneja el `title` del iframe. */}
            <p className="absolute inset-x-0 bottom-2 z-0 px-4 text-center text-xs text-fg-muted">
              Si la vista previa no carga, descarga el PDF.
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-3">
        <Button
          size="lg"
          className="h-14 w-full text-base"
          onClick={handleDownload}
          data-testid="certificate-download"
          data-url={data.url}
        >
          <Download aria-hidden className="mr-2 h-5 w-5" />
          Descargar PDF
        </Button>
        <Button
          asChild
          variant="secondary"
          size="lg"
          className="h-14 w-full text-base"
        >
          <a href={mailto} data-testid="certificate-share">
            <Mail aria-hidden className="mr-2 h-5 w-5" />
            Compartir por correo
          </a>
        </Button>
      </div>
    </motion.div>
  );
}

function CertificateSkeleton() {
  return (
    <div
      className="mx-auto max-w-md space-y-4 px-4 pb-8 pt-4 md:max-w-2xl"
      data-testid="certificate-skeleton"
    >
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-4 w-3/4" />
      <Skeleton className="aspect-[3/4] w-full" />
      <Skeleton className="h-14 w-full" />
      <Skeleton className="h-14 w-full" />
    </div>
  );
}

function CertificateEmptyState() {
  return (
    <div
      className="mx-auto max-w-md px-4 pb-8 pt-12"
      data-testid="certificate-empty"
    >
      <EmptyState
        icon={<FileText className="h-14 w-14" />}
        title="Aún no tienes un certificado"
        description="Tu certificado será emitido al alta de tu póliza. Si esperas uno, contacta a MAC."
      />
    </div>
  );
}

function CertificateErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div
      className="mx-auto flex max-w-md flex-col items-center gap-4 px-4 pb-8 pt-12 text-center"
      data-testid="certificate-error"
    >
      <XCircle aria-hidden className="h-12 w-12 text-danger" />
      <h2 className="text-lg font-semibold">No pudimos cargar tu certificado</h2>
      <p className="text-sm text-fg-muted">
        Revisa tu conexión e inténtalo otra vez.
      </p>
      <Button onClick={onRetry}>Reintentar</Button>
    </div>
  );
}
