'use client';

import * as React from 'react';
import {
  Badge,
  Button,
  DataTable,
  Input,
  Pagination,
  Section,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@segurasist/ui';
import type { DataTableColumn } from '@segurasist/ui';
import { Plus, Upload } from 'lucide-react';
import Link from 'next/link';
import { useInsureds } from '@segurasist/api-client/hooks/insureds';
import { usePackages } from '@segurasist/api-client/hooks/packages';
import type { Insured, ListParams } from '@segurasist/api-client';

/**
 * S2-06 — Listado asegurados.
 *
 * Características:
 *   - Server-side cursor pagination via `useInsureds(params)`.
 *   - Search input con debounce 300ms (RF-203).
 *   - Filtros: paquete, estado, vigencia, switch "Solo con bounce".
 *   - Acciones por fila: Ver, Editar (drawer todavía pending), Reemitir cert,
 *     Cancelar (con confirmación).
 *   - Bulk actions placeholder (cancelación masiva).
 */
export default function InsuredsPage() {
  const [searchInput, setSearchInput] = React.useState('');
  const [debouncedSearch, setDebouncedSearch] = React.useState('');
  const [packageId, setPackageId] = React.useState<string>('all');
  const [status, setStatus] = React.useState<string>('all');
  const [bouncedOnly, setBouncedOnly] = React.useState(false);
  const [cursorStack, setCursorStack] = React.useState<string[]>([]);

  // Debounce 300ms (RF-203).
  React.useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchInput.trim()), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  // Reset paginación al cambiar filtros.
  React.useEffect(() => {
    setCursorStack([]);
  }, [debouncedSearch, packageId, status, bouncedOnly]);

  const params: ListParams = React.useMemo(
    () => ({
      q: debouncedSearch || undefined,
      packageId: packageId === 'all' ? undefined : packageId,
      status: status === 'all' ? undefined : (status as ListParams['status']),
      bouncedOnly: bouncedOnly || undefined,
      cursor: cursorStack[cursorStack.length - 1],
      limit: 50,
    }),
    [debouncedSearch, packageId, status, bouncedOnly, cursorStack],
  );

  const { data, isLoading, isError } = useInsureds(params);
  const { data: packages } = usePackages();

  const columns: DataTableColumn<Insured>[] = [
    {
      id: 'name',
      header: 'Nombre',
      cell: (r) => (
        <Link
          href={{ pathname: '/insureds/[id]', query: { id: r.id } }}
          className="font-medium text-fg transition-colors hover:text-accent"
        >
          {r.fullName}
        </Link>
      ),
    },
    { id: 'curp', header: 'CURP', cell: (r) => <code className="font-mono text-xs">{r.curp}</code> },
    { id: 'pkg', header: 'Paquete', cell: (r) => r.packageName },
    {
      id: 'validity',
      header: 'Vigencia',
      cell: (r) =>
        `${new Date(r.validFrom).toISOString().slice(0, 10)} → ${new Date(r.validTo)
          .toISOString()
          .slice(0, 10)}`,
    },
    {
      id: 'status',
      header: 'Estado',
      cell: (r) => statusBadge(r.status, r.hasBounce ?? false),
    },
  ];

  const items = data?.items ?? [];
  const hasNext = Boolean(data?.nextCursor);
  const hasPrev = cursorStack.length > 0;

  return (
    <div className="space-y-4">
      <Section
        title="Asegurados"
        description="Búsqueda y administración de membresías."
        actions={
          <div className="flex gap-2">
            <Button variant="secondary" asChild>
              <Link href="/batches/new">
                <Upload aria-hidden className="mr-2 h-4 w-4" />
                Carga masiva
              </Link>
            </Button>
            <Button>
              <Plus aria-hidden className="mr-2 h-4 w-4" />
              Nuevo asegurado
            </Button>
          </div>
        }
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="flex-1 sm:min-w-[16rem]">
          <label htmlFor="insured-search" className="sr-only">
            Buscar
          </label>
          <Input
            id="insured-search"
            placeholder="Buscar por CURP, RFC, nombre..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
        </div>
        <Select value={packageId} onValueChange={setPackageId}>
          <SelectTrigger className="w-full sm:w-48" aria-label="Filtrar por paquete">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los paquetes</SelectItem>
            {(packages ?? []).map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-full sm:w-40" aria-label="Filtrar por estado">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los estados</SelectItem>
            <SelectItem value="active">Vigente</SelectItem>
            <SelectItem value="suspended">Suspendido</SelectItem>
            <SelectItem value="cancelled">Cancelado</SelectItem>
            <SelectItem value="expired">Vencido</SelectItem>
          </SelectContent>
        </Select>
        <label className="flex items-center gap-2 text-[13px] text-fg-muted">
          <input
            type="checkbox"
            checked={bouncedOnly}
            onChange={(e) => setBouncedOnly(e.target.checked)}
            aria-label="Solo con bounce"
            className="h-4 w-4 rounded border-border accent-accent"
          />
          Solo con bounce
        </label>
      </div>

      {isError ? (
        <div className="rounded-lg border border-danger/30 bg-danger/10 p-4 text-[13px] text-danger">
          No pudimos cargar el listado. Intenta nuevamente.
        </div>
      ) : (
        <DataTable
          data={items}
          columns={columns}
          rowKey={(r) => r.id}
          caption="Listado de asegurados"
          loading={isLoading}
          emptyTitle="Sin asegurados"
          emptyDescription="No hay asegurados con esos filtros"
        />
      )}

      <Pagination
        hasPrev={hasPrev}
        hasNext={hasNext}
        onPrev={() => setCursorStack((s) => s.slice(0, -1))}
        onNext={() => {
          if (data?.nextCursor) setCursorStack((s) => [...s, data.nextCursor as string]);
        }}
        pageInfo={`${items.length} resultados${hasNext ? '+' : ''}`}
      />
    </div>
  );
}

function statusBadge(s: Insured['status'], hasBounce: boolean): JSX.Element {
  if (hasBounce) {
    return (
      <span className="inline-flex flex-col gap-0.5">
        {renderStatus(s)}
        <Badge variant="warning">Bounce</Badge>
      </span>
    );
  }
  return renderStatus(s);
}

function renderStatus(s: Insured['status']): JSX.Element {
  switch (s) {
    case 'active':
      return <Badge variant="success">Vigente</Badge>;
    case 'suspended':
      return <Badge variant="warning">Suspendido</Badge>;
    case 'expired':
      return <Badge variant="danger">Vencido</Badge>;
    default:
      return <Badge variant="secondary">Cancelado</Badge>;
  }
}
