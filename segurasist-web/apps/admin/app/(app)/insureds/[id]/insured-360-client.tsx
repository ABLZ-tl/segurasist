'use client';

/**
 * S3-06 — Cliente principal de la vista 360°.
 *
 * - Single fetch via `useInsured360(id)` (TanStack Query, staleTime 30s).
 * - URL state para tabs vía `?tab=datos|coberturas|eventos|certificados|auditoria`.
 *   Default `datos` cuando no hay query param. Usamos `router.replace` para
 *   no spam-ear el history al cambiar de tab.
 * - Estados:
 *     loading → Skeleton para header + tab content (no rompe layout).
 *     error 404 → invoca `notFound()` (anti-enumeration: el backend siempre
 *                 devuelve 404 si el insured no existe o pertenece a otro
 *                 tenant; el FE traduce eso a la página 404 de Next).
 *     error otro → AlertBanner con detail.
 *     ok → Tabs + tab content sincronizado con URL.
 */

import * as React from 'react';
import { notFound, useRouter, useSearchParams } from 'next/navigation';
import { FileSignature } from 'lucide-react';
import {
  AlertBanner,
  Badge,
  Breadcrumbs,
  Button,
  Section,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@segurasist/ui';
import { ProblemDetailsError } from '@segurasist/api-client';
import { useInsured360 } from '../../../../lib/hooks/use-insured-360';
import { InsuredAuditoriaTab } from './auditoria';
import { InsuredCertificadosTab } from './certificados';
import { InsuredCoberturasTab } from './coberturas';
import { InsuredDatosTab } from './datos';
import { InsuredEventosTab } from './eventos';

const TABS = ['datos', 'coberturas', 'eventos', 'certificados', 'auditoria'] as const;
type TabKey = (typeof TABS)[number];

function isTab(value: string | null): value is TabKey {
  return value !== null && (TABS as readonly string[]).includes(value);
}

interface Props {
  insuredId: string;
}

function StatusBadge({ status }: { status: string }): React.ReactElement {
  const variant: 'success' | 'warning' | 'danger' | 'default' =
    status === 'active'
      ? 'success'
      : status === 'suspended'
        ? 'warning'
        : status === 'expired' || status === 'cancelled'
          ? 'danger'
          : 'default';
  const label =
    status === 'active'
      ? 'Vigente'
      : status === 'suspended'
        ? 'Suspendido'
        : status === 'expired'
          ? 'Vencido'
          : status === 'cancelled'
            ? 'Cancelado'
            : status;
  return <Badge variant={variant}>{label}</Badge>;
}

export function Insured360Client({ insuredId }: Props): React.ReactElement {
  const router = useRouter();
  const sp = useSearchParams();
  const tabParam = sp.get('tab');
  const activeTab: TabKey = isTab(tabParam) ? tabParam : 'datos';

  const handleTabChange = React.useCallback(
    (next: string) => {
      if (!isTab(next)) return;
      const params = new URLSearchParams(sp.toString());
      params.set('tab', next);
      router.replace(`/insureds/${insuredId}?${params.toString()}`);
    },
    [insuredId, router, sp],
  );

  const { data, isLoading, isError, error } = useInsured360(insuredId);

  // 404 anti-enumeration: el backend devuelve 404 cuando el insured no
  // existe o no pertenece al tenant del JWT. FE no diferencia.
  if (isError && error instanceof ProblemDetailsError && error.status === 404) {
    notFound();
  }

  if (isLoading || !data) {
    return (
      <div className="space-y-4" data-testid="insured-360-skeleton">
        <Skeleton className="h-8 w-1/2" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (isError) {
    return (
      <AlertBanner tone="danger" title="No pudimos cargar la vista 360.">
        {error instanceof Error ? error.message : 'Error desconocido.'}
      </AlertBanner>
    );
  }

  const insured = data.insured;

  return (
    <div className="space-y-4">
      <Breadcrumbs
        items={[
          { label: 'Inicio', href: '/dashboard' },
          { label: 'Asegurados', href: '/insureds' },
          { label: insured.fullName },
        ]}
      />
      <Section
        title={
          <span className="flex items-center gap-3">
            {insured.fullName} <StatusBadge status={insured.status} />
          </span>
        }
        description={`CURP: ${insured.curp}`}
        actions={
          <Button data-testid="reissue-cert-btn">
            <FileSignature aria-hidden className="mr-2 h-4 w-4" />
            Reemitir certificado
          </Button>
        }
      />

      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <TabsList>
          <TabsTrigger value="datos">Datos</TabsTrigger>
          <TabsTrigger value="coberturas">Coberturas</TabsTrigger>
          <TabsTrigger value="eventos">Eventos</TabsTrigger>
          <TabsTrigger value="certificados">Certificados</TabsTrigger>
          <TabsTrigger value="auditoria">Auditoría</TabsTrigger>
        </TabsList>
        <TabsContent value="datos">
          <InsuredDatosTab insured={insured} />
        </TabsContent>
        <TabsContent value="coberturas">
          <InsuredCoberturasTab coverages={data.coverages} />
        </TabsContent>
        <TabsContent value="eventos">
          <InsuredEventosTab events={data.events} />
        </TabsContent>
        <TabsContent value="certificados">
          <InsuredCertificadosTab certificates={data.certificates} />
        </TabsContent>
        <TabsContent value="auditoria">
          <InsuredAuditoriaTab audit={data.audit} insuredId={insuredId} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
