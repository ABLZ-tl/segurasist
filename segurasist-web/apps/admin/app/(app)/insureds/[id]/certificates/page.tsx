'use client';

import { Button, DataTable } from '@segurasist/ui';
import type { DataTableColumn } from '@segurasist/ui';
import { Download } from 'lucide-react';

interface CertRow {
  id: string;
  version: number;
  issuedAt: string;
}

const MOCK: CertRow[] = [
  { id: 'cert-1', version: 3, issuedAt: '2026-04-21' },
  { id: 'cert-2', version: 2, issuedAt: '2026-02-12' },
  { id: 'cert-3', version: 1, issuedAt: '2025-11-04' },
];

const columns: DataTableColumn<CertRow>[] = [
  { id: 'version', header: 'Versión', cell: (r) => `v${r.version}` },
  { id: 'issuedAt', header: 'Emitido', cell: (r) => r.issuedAt },
  {
    id: 'actions',
    header: 'Acciones',
    cell: () => (
      <Button size="sm" variant="ghost">
        <Download aria-hidden className="mr-1 h-4 w-4" />
        Descargar
      </Button>
    ),
  },
];

export default function InsuredCertificatesPage() {
  return <DataTable data={MOCK} columns={columns} rowKey={(r) => r.id} />;
}
