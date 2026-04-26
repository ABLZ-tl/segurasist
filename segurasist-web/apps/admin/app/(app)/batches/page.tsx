import Link from 'next/link';
import { Button, Section } from '@segurasist/ui';
import { BatchesTable, type BatchRow } from './batches-table';
import { AccessDenied } from '../../_components/access-denied';
import { fetchMe } from '../../../lib/auth-server';
import { canAccess } from '../../../lib/rbac';

export const dynamic = 'force-dynamic';

const MOCK: BatchRow[] = [
  { id: 'b-101', fileName: 'asegurados-marzo.csv', rows: 1240, status: 'completed', createdAt: '2026-04-20 09:14' },
  { id: 'b-102', fileName: 'altas-q2.csv', rows: 432, status: 'processing', createdAt: '2026-04-22 11:02' },
  { id: 'b-103', fileName: 'bajas-marzo.csv', rows: 38, status: 'preview_ready', createdAt: '2026-04-23 17:33' },
  { id: 'b-104', fileName: 'corregido.csv', rows: 12, status: 'failed', createdAt: '2026-04-24 08:50' },
];

export default async function BatchesPage() {
  const me = await fetchMe();
  if (!me.role || !canAccess('/batches', me.role)) {
    return <AccessDenied />;
  }
  return (
    <div className="space-y-4">
      <Section
        title="Lotes de carga"
        description="Sube archivos CSV/XLSX y revisa su estado."
        actions={
          <Button asChild>
            <Link href="/batches/new">Nuevo lote</Link>
          </Button>
        }
      />
      <BatchesTable data={MOCK} />
    </div>
  );
}
