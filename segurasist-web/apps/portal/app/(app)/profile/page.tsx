'use client';

/**
 * Portal asegurado — Mi perfil.
 *
 * Read-only por diseño: el insured no edita sus datos directamente desde el
 * portal (los gestiona MAC vía batch o admin). Cualquier cambio se solicita
 * via call center — botón al final de la página apunta a `tel:`.
 *
 * Datos surfaced: nombre, paquete, vigencia, status, contacto soporte. CURP/
 * RFC/email/phone NO están en `useInsuredSelf` actualmente — extender el
 * endpoint si la consulta de cumplimiento lo exige (NOM-024 sugiere visible
 * a sí mismo). Por ahora se muestra solo lo que la app ya conoce.
 */

import * as React from 'react';
import { motion } from 'framer-motion';
import {
  AlertCircle,
  Calendar,
  Package,
  Phone,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import { AlertBanner, Button, EmptyState, Skeleton } from '@segurasist/ui';
import { useInsuredSelf } from '@segurasist/api-client/hooks/insureds';
import type { InsuredSelf } from '@segurasist/api-client/hooks/insureds';
import { ProblemDetailsError } from '@segurasist/api-client';
import { formatLongDate } from '@/lib/hooks/use-formatted-date';

export default function ProfilePage(): JSX.Element {
  const { data, isLoading, isError, error, refetch } = useInsuredSelf();

  if (isLoading) return <ProfileSkeleton />;

  if (isError) {
    const status =
      error instanceof ProblemDetailsError ? error.status : undefined;
    return (
      <div className="mx-auto max-w-md space-y-4 px-4 pb-8 pt-4 md:max-w-2xl">
        <h1 className="text-2xl font-semibold tracking-tight">Mi perfil</h1>
        <EmptyState
          icon={<XCircle className="h-12 w-12 text-danger" aria-hidden />}
          title="No pudimos cargar tu perfil"
          description={
            status === 401
              ? 'Tu sesión expiró. Vuelve a iniciar sesión.'
              : 'Inténtalo de nuevo en un momento.'
          }
          action={<Button onClick={() => void refetch()}>Reintentar</Button>}
        />
      </div>
    );
  }

  if (!data) return <ProfileSkeleton />;

  return <ProfileContent data={data} />;
}

function ProfileContent({ data }: { data: InsuredSelf }): JSX.Element {
  const validFrom = formatLongDate(data.validFrom);
  const validTo = formatLongDate(data.validTo);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
      className="mx-auto max-w-md space-y-6 px-4 pb-8 pt-4 md:max-w-2xl"
    >
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Mi perfil</h1>
        <p className="text-sm text-fg-muted">
          Datos de tu membresía con Hospitales MAC.
        </p>
      </header>

      <section
        aria-label="Información del titular"
        className="rounded-md border border-border bg-bg-elevated p-4 space-y-4"
      >
        <Field
          icon={<ShieldCheck className="h-4 w-4 text-fg-muted" aria-hidden />}
          label="Titular"
          value={data.fullName}
        />
        <Field
          icon={<Package className="h-4 w-4 text-fg-muted" aria-hidden />}
          label="Paquete"
          value={data.packageName}
        />
        <Field
          icon={<Calendar className="h-4 w-4 text-fg-muted" aria-hidden />}
          label="Vigencia"
          value={`${validFrom} — ${validTo}`}
        />
        <Field
          icon={
            data.status === 'vigente' ? (
              <ShieldCheck className="h-4 w-4 text-success" aria-hidden />
            ) : data.status === 'proxima_a_vencer' ? (
              <AlertCircle className="h-4 w-4 text-warning" aria-hidden />
            ) : (
              <XCircle className="h-4 w-4 text-danger" aria-hidden />
            )
          }
          label="Estado"
          value={
            data.status === 'vigente'
              ? 'Vigente'
              : data.status === 'proxima_a_vencer'
                ? `Próxima a vencer (${data.daysUntilExpiry} días)`
                : 'Vencida'
          }
        />
      </section>

      <AlertBanner tone="info" title="¿Datos incorrectos?">
        Tu CURP, RFC, email y teléfono los mantiene Hospitales MAC. Para
        actualizarlos, llama al call center.
      </AlertBanner>

      <Button asChild className="w-full" size="lg">
        <a
          href={`tel:${data.supportPhone.replace(/\s+/g, '')}`}
          aria-label={`Llamar al call center MAC ${data.supportPhone}`}
        >
          <Phone aria-hidden className="mr-2 h-4 w-4" />
          Llamar a MAC
        </a>
      </Button>
    </motion.div>
  );
}

function Field({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}): JSX.Element {
  return (
    <div className="flex items-start gap-3">
      <span className="mt-0.5 flex h-7 w-7 flex-none items-center justify-center rounded-md bg-bg">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-medium uppercase tracking-wider text-fg-subtle">
          {label}
        </p>
        <p className="text-sm text-fg break-words">{value}</p>
      </div>
    </div>
  );
}

function ProfileSkeleton(): JSX.Element {
  return (
    <div
      className="mx-auto max-w-md space-y-6 px-4 pb-8 pt-4 md:max-w-2xl"
      data-testid="profile-skeleton"
    >
      <Skeleton className="h-8 w-32" />
      <Skeleton className="h-4 w-3/4" />
      <Skeleton className="h-48 w-full" />
      <Skeleton className="h-12 w-full" />
    </div>
  );
}
