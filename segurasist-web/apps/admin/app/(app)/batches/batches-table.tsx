'use client';

import { Badge, DataTable } from '@segurasist/ui';
import type { DataTableColumn } from '@segurasist/ui';

export interface BatchRow {
  id: string;
  fileName: string;
  rows: number;
  status: 'validating' | 'preview_ready' | 'processing' | 'completed' | 'failed';
  createdAt: string;
}

const STATUS_LABEL: Record<BatchRow['status'], { label: string; tone: 'success' | 'warning' | 'danger' | 'secondary' | 'default' }> = {
  validating: { label: 'Validando', tone: 'secondary' },
  preview_ready: { label: 'Listo para confirmar', tone: 'warning' },
  processing: { label: 'Procesando', tone: 'default' },
  completed: { label: 'Completado', tone: 'success' },
  failed: { label: 'Fallido', tone: 'danger' },
};

const columns: DataTableColumn<BatchRow>[] = [
  { id: 'file', header: 'Archivo', cell: (r) => r.fileName },
  { id: 'rows', header: 'Filas', cell: (r) => r.rows.toLocaleString('es-MX') },
  {
    id: 'status',
    header: 'Estado',
    cell: (r) => <Badge variant={STATUS_LABEL[r.status].tone}>{STATUS_LABEL[r.status].label}</Badge>,
  },
  { id: 'createdAt', header: 'Creado', cell: (r) => r.createdAt },
];

export function BatchesTable({ data }: { data: BatchRow[] }) {
  return <DataTable data={data} columns={columns} rowKey={(r) => r.id} />;
}
