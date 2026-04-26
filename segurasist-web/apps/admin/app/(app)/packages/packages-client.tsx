'use client';

import * as React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
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
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@segurasist/ui';
import type { DataTableColumn } from '@segurasist/ui';
import { Plus } from 'lucide-react';
import { api } from '@segurasist/api-client';
import { qs } from '@segurasist/api-client';
import { PackageEditor } from '../../../components/packages/package-editor';

interface PackageListItem {
  id: string;
  name: string;
  description: string | null;
  status: 'active' | 'archived';
  coveragesCount: number;
  insuredsActive: number;
  createdAt: string;
  updatedAt: string;
}

interface PackagesListResponse {
  items: PackageListItem[];
  nextCursor: string | null;
}

const usePackagesList = (params: { q?: string; status?: string; cursor?: string }) =>
  useQuery({
    queryKey: ['packages', 'list', params],
    queryFn: () => api<PackagesListResponse>(`/v1/packages?${qs(params)}`),
    staleTime: 30_000,
  });

export function PackagesClient({ role }: { role: string }): JSX.Element {
  const qc = useQueryClient();
  const [search, setSearch] = React.useState('');
  const [debouncedSearch, setDebouncedSearch] = React.useState('');
  const [status, setStatus] = React.useState<string>('all');
  const [cursorStack, setCursorStack] = React.useState<string[]>([]);
  const [editorOpen, setEditorOpen] = React.useState(false);

  const canEdit = role === 'admin_segurasist';

  React.useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  React.useEffect(() => {
    setCursorStack([]);
  }, [debouncedSearch, status]);

  const params = React.useMemo(
    () => ({
      q: debouncedSearch || undefined,
      status: status === 'all' ? undefined : status,
      cursor: cursorStack[cursorStack.length - 1],
    }),
    [debouncedSearch, status, cursorStack],
  );

  const { data, isLoading, isError } = usePackagesList(params);
  const items = data?.items ?? [];
  const hasNext = Boolean(data?.nextCursor);
  const hasPrev = cursorStack.length > 0;

  const columns: DataTableColumn<PackageListItem>[] = [
    {
      id: 'name',
      header: 'Nombre',
      cell: (r) => (
        <span className="font-medium text-fg" data-package-id={r.id}>
          {r.name}
        </span>
      ),
    },
    {
      id: 'coverages',
      header: 'Coberturas',
      cell: (r) => <span className="tabular-nums">{r.coveragesCount}</span>,
    },
    {
      id: 'insureds',
      header: 'Asegurados activos',
      cell: (r) => <span className="tabular-nums">{r.insuredsActive}</span>,
    },
    {
      id: 'status',
      header: 'Estado',
      cell: (r) =>
        r.status === 'active' ? (
          <Badge variant="success">Activo</Badge>
        ) : (
          <Badge variant="secondary">Archivado</Badge>
        ),
    },
  ];

  return (
    <div className="space-y-4">
      <Section
        title="Paquetes"
        description="Configura paquetes y coberturas."
        actions={
          canEdit ? (
            <Sheet open={editorOpen} onOpenChange={setEditorOpen}>
              <SheetTrigger asChild>
                <Button>
                  <Plus aria-hidden className="mr-2 h-4 w-4" />
                  Nuevo paquete
                </Button>
              </SheetTrigger>
              <SheetContent side="right" className="w-full sm:max-w-xl">
                <SheetHeader>
                  <SheetTitle>Nuevo paquete</SheetTitle>
                </SheetHeader>
                <PackageEditor
                  onSaved={() => {
                    setEditorOpen(false);
                    qc.invalidateQueries({ queryKey: ['packages'] });
                  }}
                />
              </SheetContent>
            </Sheet>
          ) : null
        }
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="flex-1 sm:min-w-[16rem]">
          <Input
            placeholder="Buscar paquete..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Buscar paquete"
          />
        </div>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-full sm:w-44" aria-label="Filtrar por estado">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los estados</SelectItem>
            <SelectItem value="active">Activos</SelectItem>
            <SelectItem value="archived">Archivados</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isError ? (
        <div className="rounded-lg border border-danger/30 bg-danger/10 p-4 text-[13px] text-danger">
          No pudimos cargar los paquetes.
        </div>
      ) : (
        <DataTable
          data={items}
          columns={columns}
          rowKey={(r) => r.id}
          caption="Listado de paquetes"
          loading={isLoading}
          emptyTitle="Aún no hay paquetes"
          emptyDescription="Crea tu primer paquete para vincular coberturas."
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
