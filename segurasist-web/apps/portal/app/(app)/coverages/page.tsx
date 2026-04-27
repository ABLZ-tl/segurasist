'use client';

/**
 * Portal asegurado — Mis coberturas.
 *
 * Lista las coberturas del paquete del titular con consumo (count o amount).
 * Mobile-first 1 col, md 2 cols. Color de la barra según consumo:
 * <50% verde, 50-80% amber, >80% rojo (alerta visual sin requerir leer).
 *
 * `lastUsedAt` se renderiza como "hace X días" para que el usuario tenga
 * referencia rápida sin tener que parsear ISO.
 */

import * as React from 'react';
import { motion } from 'framer-motion';
import {
  HelpCircle,
  Pill,
  ShieldCheck,
  Smile,
  Stethoscope,
  type LucideIcon,
} from 'lucide-react';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  ProgressBar,
  Skeleton,
} from '@segurasist/ui';
import { useCoveragesSelf } from '@segurasist/api-client/hooks/insureds';
import type { CoverageSelf } from '@segurasist/api-client/hooks/insureds';
import { formatRelativeDate } from '@/lib/hooks/use-formatted-date';

const fmtMxn = new Intl.NumberFormat('es-MX', {
  style: 'currency',
  currency: 'MXN',
  maximumFractionDigits: 0,
});

export default function CoveragesPage() {
  const { data, isLoading, isError, refetch } = useCoveragesSelf();

  return (
    <div className="mx-auto max-w-md space-y-4 px-4 pb-8 pt-4 md:max-w-3xl">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold">Tus coberturas</h1>
        <p className="text-sm text-fg-muted">
          Consulta lo que incluye tu paquete y cuánto te queda este año.
        </p>
      </header>

      {isLoading ? (
        <CoveragesSkeleton />
      ) : isError ? (
        <CoveragesError onRetry={() => refetch()} />
      ) : !data || data.length === 0 ? (
        <EmptyState
          icon={<ShieldCheck className="h-10 w-10" />}
          title="Sin coberturas configuradas"
          description="Tu paquete no incluye coberturas configuradas. Contacta a MAC para revisar tu plan."
          data-testid="coverages-empty"
        />
      ) : (
        <motion.ul
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
          className="grid gap-3 md:grid-cols-2"
          data-testid="coverages-list"
        >
          {data.map((c) => (
            <li key={c.id}>
              <CoverageCard coverage={c} />
            </li>
          ))}
        </motion.ul>
      )}
    </div>
  );
}

function CoverageCard({ coverage }: { coverage: CoverageSelf }) {
  const Icon = pickIcon(coverage.name);
  const ratio = coverage.limit > 0 ? coverage.used / coverage.limit : 0;
  const tone: 'success' | 'warning' | 'danger' =
    ratio >= 0.8 ? 'danger' : ratio >= 0.5 ? 'warning' : 'success';

  const remaining = Math.max(0, coverage.limit - coverage.used);
  const isCount = coverage.type === 'count';

  return (
    <Card data-testid={`coverage-card-${coverage.id}`}>
      <CardHeader className="flex-row items-center justify-between space-y-0 p-4 pb-2">
        <CardTitle className="text-base font-semibold">{coverage.name}</CardTitle>
        <Icon aria-hidden className="h-5 w-5 text-accent" />
      </CardHeader>
      <CardContent className="space-y-3 p-4 pt-0">
        <p className="text-sm text-fg">
          {isCount ? (
            <>
              Te quedan{' '}
              <span className="font-semibold">{remaining}</span> de{' '}
              {coverage.limit}
            </>
          ) : (
            <>
              Disponible{' '}
              <span className="font-semibold">{fmtMxn.format(remaining)}</span>{' '}
              de {fmtMxn.format(coverage.limit)}
            </>
          )}
        </p>
        <ProgressBar
          value={coverage.used}
          max={coverage.limit || 1}
          tone={tone}
          label={`${coverage.name}: consumo ${Math.round(ratio * 100)}%`}
          data-testid={`progress-${coverage.id}`}
          data-tone={tone}
        />
        {coverage.lastUsedAt && (
          <p className="text-xs text-fg-muted">
            Última vez usado: {formatRelativeDate(coverage.lastUsedAt)}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

const ICON_HINTS: Array<[RegExp, LucideIcon]> = [
  [/medic|consulta|doctor|hospital/i, Stethoscope],
  [/farmac|medic|pharmac/i, Pill],
  [/dental|dent|odont/i, Smile],
];

function pickIcon(name: string): LucideIcon {
  for (const [re, icon] of ICON_HINTS) if (re.test(name)) return icon;
  return HelpCircle;
}

function CoveragesSkeleton() {
  return (
    <div className="grid gap-3 md:grid-cols-2" data-testid="coverages-skeleton">
      {Array.from({ length: 4 }).map((_, i) => (
        <Skeleton key={i} className="h-32 w-full" />
      ))}
    </div>
  );
}

function CoveragesError({ onRetry }: { onRetry: () => void }) {
  return (
    <EmptyState
      title="No pudimos cargar tus coberturas"
      description="Revisa tu conexión e inténtalo de nuevo."
      action={
        <button
          type="button"
          onClick={onRetry}
          className="rounded-md border border-border bg-bg px-4 py-2 text-sm font-medium hover:bg-bg-elevated"
        >
          Reintentar
        </button>
      }
      data-testid="coverages-error"
    />
  );
}
