'use client';

/**
 * Portal asegurado — Home premium.
 *
 * Pinta el hero de vigencia (3 variantes según `status`), CTAs primarios
 * (certificado + coberturas) y card de soporte con teléfono. Mobile-first:
 * `max-w-md` por defecto, `md:max-w-2xl` para tablets+. Animación de
 * entrada via framer-motion (200ms ease-out) — respeta `prefers-reduced-motion`
 * porque framer-motion lo hace automáticamente.
 *
 * Loading: Skeleton shimmer (NUNCA pantalla en blanco). Error: card con
 * retry. Empty: card explicativa.
 */

import * as React from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import {
  AlertCircle,
  CheckCircle,
  FileText,
  Phone,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  CardContent,
  Skeleton,
} from '@segurasist/ui';
import { useInsuredSelf } from '@segurasist/api-client/hooks/insureds';
import type { InsuredSelf } from '@segurasist/api-client/hooks/insureds';
import { formatLongDate } from '@/lib/hooks/use-formatted-date';

const SUPPORT_FALLBACK = '+525555555555';

export default function PortalHomePage() {
  const { data, isLoading, isError, refetch } = useInsuredSelf();

  if (isLoading) return <HomeSkeleton />;
  if (isError) return <HomeErrorState onRetry={() => refetch()} />;
  if (!data) return <HomeEmptyState />;

  return <HomeContent data={data} />;
}

function HomeContent({ data }: { data: InsuredSelf }) {
  const firstName = data.fullName.split(' ')[0] ?? data.fullName;
  const validToStr = formatLongDate(data.validTo);
  const phone = data.supportPhone || SUPPORT_FALLBACK;

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: 'easeOut' }}
      className="mx-auto max-w-md space-y-6 px-4 pb-8 pt-4 md:max-w-2xl"
      data-testid="home-content"
    >
      <header className="space-y-1">
        <p className="text-sm text-fg-muted">Hola,</p>
        <h1 className="text-2xl font-bold text-fg">{firstName}</h1>
      </header>

      <StatusHeroCard
        status={data.status}
        validToStr={validToStr}
        packageName={data.packageName}
      />

      <div className="space-y-3">
        <Button asChild size="lg" className="h-14 w-full text-base">
          <Link href="/certificate">
            <FileText aria-hidden className="mr-2 h-5 w-5" />
            Descargar mi certificado
          </Link>
        </Button>
        <Button
          asChild
          variant="secondary"
          size="lg"
          className="h-14 w-full text-base"
        >
          <Link href="/coverages">
            <ShieldCheck aria-hidden className="mr-2 h-5 w-5" />
            Ver mis coberturas
          </Link>
        </Button>
      </div>

      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="flex items-start gap-3">
            <Phone aria-hidden className="mt-0.5 h-5 w-5 shrink-0 text-accent" />
            <div className="flex-1 space-y-1">
              <h2 className="text-sm font-semibold">¿Necesitas ayuda?</h2>
              <p className="text-xs text-fg-muted">
                Llama al call center MAC. Disponible 24/7.
              </p>
            </div>
          </div>
          <Button asChild variant="outline" className="w-full">
            <a href={`tel:${phone}`} data-testid="support-phone-link">
              Llamar ahora
            </a>
          </Button>
        </CardContent>
      </Card>
    </motion.div>
  );
}

interface StatusHeroCardProps {
  status: InsuredSelf['status'];
  validToStr: string;
  packageName: string;
}

/**
 * Hero card de vigencia — 3 variantes con contraste 7:1 (WCAG AAA grandes
 * textos). Iconos 48px (h-12 w-12). Title 32px (text-3xl-ish via inline
 * style para garantizar el tamaño exacto).
 */
function StatusHeroCard({ status, validToStr, packageName }: StatusHeroCardProps) {
  const variant = STATUS_VARIANTS[status];
  const Icon = variant.icon;
  return (
    <Card
      className={`border-2 ${variant.border} ${variant.bg}`}
      role="region"
      aria-label={`Estado de membresía: ${variant.label}`}
      data-testid={`hero-${status}`}
    >
      <CardContent className="flex flex-col items-center gap-3 p-6 text-center">
        <Icon
          aria-hidden
          className={`h-12 w-12 ${variant.iconColor}`}
        />
        <h2
          className={`font-bold leading-tight ${variant.titleColor}`}
          style={{ fontSize: '2rem' }}
        >
          {variant.label}
        </h2>
        <p className="text-sm text-fg">
          {variant.subPrefix}{' '}
          <span className="font-semibold">{validToStr}</span>
        </p>
        <Badge variant="outline" className="text-xs">
          Plan {packageName}
        </Badge>
      </CardContent>
    </Card>
  );
}

const STATUS_VARIANTS = {
  vigente: {
    label: 'VIGENTE',
    icon: CheckCircle,
    iconColor: 'text-success',
    titleColor: 'text-success',
    border: 'border-success',
    bg: 'bg-success/5',
    subPrefix: 'Hasta el',
  },
  proxima_a_vencer: {
    label: 'PRÓXIMA A VENCER',
    icon: AlertCircle,
    iconColor: 'text-warning',
    titleColor: 'text-warning',
    border: 'border-warning',
    bg: 'bg-warning/5',
    subPrefix: 'Renueva antes del',
  },
  vencida: {
    label: 'VENCIDA',
    icon: XCircle,
    iconColor: 'text-danger',
    titleColor: 'text-danger',
    border: 'border-danger',
    bg: 'bg-danger/5',
    subPrefix: 'Renueva tu membresía. Venció el',
  },
} as const;

function HomeSkeleton() {
  return (
    <div
      className="mx-auto max-w-md space-y-6 px-4 pb-8 pt-4 md:max-w-2xl"
      data-testid="home-skeleton"
    >
      <div className="space-y-2">
        <Skeleton className="h-3 w-16" />
        <Skeleton className="h-7 w-40" />
      </div>
      <Skeleton className="h-44 w-full" />
      <div className="space-y-3">
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-14 w-full" />
      </div>
      <Skeleton className="h-32 w-full" />
    </div>
  );
}

function HomeErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div
      className="mx-auto flex max-w-md flex-col items-center gap-4 px-4 pb-8 pt-12 text-center"
      data-testid="home-error"
    >
      <XCircle aria-hidden className="h-12 w-12 text-danger" />
      <h2 className="text-lg font-semibold">No pudimos cargar tu información</h2>
      <p className="text-sm text-fg-muted">
        Revisa tu conexión e inténtalo otra vez.
      </p>
      <Button onClick={onRetry} variant="primary">
        Reintentar
      </Button>
    </div>
  );
}

function HomeEmptyState() {
  return (
    <div
      className="mx-auto flex max-w-md flex-col items-center gap-4 px-4 pb-8 pt-12 text-center"
      data-testid="home-empty"
    >
      <ShieldCheck aria-hidden className="h-12 w-12 text-fg-muted" />
      <h2 className="text-lg font-semibold">Aún no tienes una póliza activa</h2>
      <p className="text-sm text-fg-muted">
        Cuando MAC dé de alta tu membresía verás aquí tu vigencia y coberturas.
      </p>
    </div>
  );
}
