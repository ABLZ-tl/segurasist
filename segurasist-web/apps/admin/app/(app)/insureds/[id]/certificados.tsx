'use client';

/**
 * S3-06 — Tab "Certificados" de la vista 360.
 *
 * Lista versionada (DataTable). Cada fila: version, issued at, valid to,
 * status, hash truncado, acciones (Descargar / Ver QR). El handler de
 * "Reemitir certificado" arriba abre un modal de motivos en Sprint 4 —
 * por ahora muestra un placeholder.
 *
 * Las acciones "Descargar" y "Ver QR" llaman a los endpoints existentes
 * en `CertificatesService` (presigned URL para download). Mantenemos el
 * lookup mínimo: el QR payload viene incluido en el payload 360.
 */

import * as React from 'react';
import { Download, QrCode, RotateCcw } from 'lucide-react';
import { Badge, Button, DataTable, EmptyState, Section } from '@segurasist/ui';
import type { DataTableColumn } from '@segurasist/ui';
import type { Insured360 } from '../../../../lib/hooks/use-insured-360';

interface Props {
  certificates: Insured360['certificates'];
  onReissue?: () => void;
  onDownload?: (id: string) => void;
  onShowQr?: (qrPayload: string | null) => void;
}

function shortHash(h: string): string {
  if (h.length <= 12) return h;
  return `${h.slice(0, 6)}…${h.slice(-4)}`;
}

function statusVariant(s: string): 'success' | 'warning' | 'danger' | 'default' {
  switch (s) {
    case 'issued':
      return 'success';
    case 'reissued':
      return 'warning';
    case 'revoked':
      return 'danger';
    default:
      return 'default';
  }
}

export function InsuredCertificadosTab({
  certificates,
  onReissue,
  onDownload,
  onShowQr,
}: Props): React.ReactElement {
  const columns: DataTableColumn<Insured360['certificates'][number]>[] = [
    { id: 'version', header: 'Versión', cell: (r) => `v${r.version}` },
    {
      id: 'issuedAt',
      header: 'Emitido',
      cell: (r) => new Date(r.issuedAt).toLocaleDateString('es-MX'),
    },
    { id: 'validTo', header: 'Vigente hasta', cell: (r) => r.validTo },
    {
      id: 'status',
      header: 'Estatus',
      cell: (r) => <Badge variant={statusVariant(r.status)}>{r.status}</Badge>,
    },
    {
      id: 'hash',
      header: 'Hash',
      cell: (r) => <code className="text-xs">{shortHash(r.hash)}</code>,
    },
    {
      id: 'actions',
      header: 'Acciones',
      cell: (r) => (
        <div className="flex gap-1">
          <Button size="sm" variant="ghost" onClick={() => onDownload?.(r.id)} aria-label="Descargar">
            <Download aria-hidden className="h-4 w-4" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onShowQr?.(r.qrPayload)}
            aria-label="Ver QR"
            disabled={!r.qrPayload}
          >
            <QrCode aria-hidden className="h-4 w-4" />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <Section
      actions={
        <Button size="sm" onClick={onReissue} data-testid="cert-reissue-btn">
          <RotateCcw aria-hidden className="mr-1 h-4 w-4" />
          Reemitir certificado
        </Button>
      }
    >
      {certificates.length === 0 ? (
        <EmptyState
          title="Sin certificados emitidos"
          description="Aún no se ha generado el primer certificado para este asegurado."
        />
      ) : (
        <DataTable data={certificates} columns={columns} rowKey={(r) => r.id} />
      )}
    </Section>
  );
}
