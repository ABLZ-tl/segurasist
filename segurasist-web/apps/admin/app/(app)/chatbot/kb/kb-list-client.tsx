'use client';

/**
 * Sprint 5 — S5-3 finisher.
 *
 * <KbListClient /> — orquestador del editor admin de KB.
 *
 * Layout:
 *   - Header con título + descripción + acciones (CSV import toggle + Nueva).
 *   - Search bar (debounced 250ms — react-query refetch barato).
 *   - Tabla con columnas: title, intent, priority, enabled toggle, updatedAt
 *     relativo, actions (editar/eliminar). Cada fila entra con
 *     `<GsapStagger staggerDelay={0.05}>` al cargar.
 *   - Empty state: Lordicon "lab-flask" idle 96px + copy.
 *   - Test-match panel inline cuando hay entry seleccionada en edición.
 *
 * Mutaciones:
 *   - Toggle enabled inline → optimistic via `useUpdateKbEntry`.
 *   - Delete con confirm dialog.
 *   - Create / Edit en `<KbEntryForm />` (drawer derecho).
 *
 * Cache key (`['admin-kb', 'list', params]`) la define el hook; aquí sólo
 * la consumimos. Las mutaciones invalidan `adminKbKeys.all`.
 *
 * RBAC: `role` viene del Server Component (admin_segurasist | admin_mac).
 * Usado para hint visual ("Tenant: este tenant" vs "Cualquier tenant" para
 * superadmin) — la auth real la enforce el BE.
 */

import * as React from 'react';
import { formatDistanceToNow } from 'date-fns';
import { es } from 'date-fns/locale';
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  GsapFade,
  GsapStagger,
  Section,
  Skeleton,
  toast,
} from '@segurasist/ui';
import {
  useAdminKbList,
  useDeleteKbEntry,
  useUpdateKbEntry,
  type KbEntryAdmin,
} from '@segurasist/api-client/hooks/admin-chatbot-kb';
import { KbIcon } from './_lordicons';
import { KbEntryForm } from './kb-entry-form';
import { KbTestMatch } from './kb-test-match';
import { KbCsvImport } from './kb-csv-import';

export interface KbListClientProps {
  role: 'admin_segurasist' | 'admin_mac' | string;
}

const PAGE_SIZE = 50;

export function KbListClient({ role }: KbListClientProps): JSX.Element {
  const [searchInput, setSearchInput] = React.useState('');
  const [debouncedSearch, setDebouncedSearch] = React.useState('');
  const [editingEntry, setEditingEntry] = React.useState<KbEntryAdmin | null>(null);
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const [showImport, setShowImport] = React.useState(false);
  const [deleteCandidate, setDeleteCandidate] = React.useState<KbEntryAdmin | null>(null);

  // Debounce simple — el hook tiene staleTime 60s, así que no abusamos.
  React.useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchInput.trim()), 250);
    return () => clearTimeout(t);
  }, [searchInput]);

  const params = React.useMemo(
    () => ({
      ...(debouncedSearch ? { q: debouncedSearch } : {}),
      limit: PAGE_SIZE,
      offset: 0,
    }),
    [debouncedSearch],
  );

  const { data, isLoading, isError, error } = useAdminKbList(params);

  const deleteMut = useDeleteKbEntry();

  const items = data?.items ?? [];
  const total = data?.total ?? 0;

  const onEdit = (entry: KbEntryAdmin): void => {
    setEditingEntry(entry);
    setDrawerOpen(true);
  };

  const onCreate = (): void => {
    setEditingEntry(null);
    setDrawerOpen(true);
  };

  const onConfirmDelete = (): void => {
    if (!deleteCandidate) return;
    const id = deleteCandidate.id;
    deleteMut.mutate(id, {
      onSuccess: () => {
        toast.success('Entrada eliminada', {
          icon: <KbIcon kind="saveSuccess" trigger="in" size={20} />,
        });
        setDeleteCandidate(null);
        if (editingEntry?.id === id) {
          setEditingEntry(null);
          setDrawerOpen(false);
        }
      },
      onError: (e) =>
        toast.error('No se pudo eliminar', {
          description: e instanceof Error ? e.message : undefined,
        }),
    });
  };

  return (
    <div className="space-y-5">
      <Section
        title={
          <span className="inline-flex items-center gap-2">
            <KbIcon kind="testMatch" trigger="loop" size={22} />
            Base de conocimiento del chatbot
          </span>
        }
        description={
          role === 'admin_segurasist'
            ? 'Gestiona entradas de KB para todos los tenants.'
            : 'Gestiona las entradas de KB de tu tenant.'
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="ghost"
              data-testid="kb-toggle-import"
              onClick={() => setShowImport((v) => !v)}
            >
              <span className="mr-2 inline-flex">
                <KbIcon kind="csvImport" trigger="hover" size={18} />
              </span>
              {showImport ? 'Ocultar import' : 'Importar CSV'}
            </Button>
            <Button data-testid="kb-create-btn" onClick={onCreate}>
              Nueva entrada
            </Button>
          </div>
        }
      />

      {showImport && (
        <GsapFade>
          <KbCsvImport onClose={() => setShowImport(false)} />
        </GsapFade>
      )}

      {/* Search */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[16rem]">
          <Input
            data-testid="kb-search"
            placeholder="Buscar por título o intent..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            aria-label="Buscar entradas"
            className="pr-9"
          />
          <span aria-hidden className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2">
            <KbIcon kind="search" trigger="hover" size={18} />
          </span>
        </div>
        <span className="text-xs text-fg-muted" data-testid="kb-total">
          {total} {total === 1 ? 'entrada' : 'entradas'}
        </span>
      </div>

      {isLoading && (
        <div data-testid="kb-list-skeleton" className="space-y-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      )}

      {isError && (
        <div
          role="alert"
          data-testid="kb-list-error"
          className="rounded-md border border-danger/40 bg-danger/5 p-4 text-sm text-danger"
        >
          {error instanceof Error
            ? error.message
            : 'No pudimos cargar la base de conocimiento. Reintenta en unos segundos.'}
        </div>
      )}

      {!isLoading && !isError && items.length === 0 && (
        <div
          data-testid="kb-empty-state"
          className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-surface px-6 py-16 text-center"
        >
          <KbIcon kind="emptyState" trigger="loop" size={96} />
          <h3 className="mt-3 text-base font-semibold text-fg">
            Aún no hay entradas en la KB
          </h3>
          <p className="mt-1 max-w-md text-sm text-fg-muted">
            Crea la primera para entrenar el chatbot.
          </p>
          <div className="mt-4">
            <Button onClick={onCreate} data-testid="kb-empty-create">
              Crear primera entrada
            </Button>
          </div>
        </div>
      )}

      {!isLoading && !isError && items.length > 0 && (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-left text-sm" data-testid="kb-table">
            <thead className="bg-surface text-fg-muted">
              <tr>
                <th scope="col" className="px-4 py-3 text-xs font-semibold uppercase tracking-wide">
                  Título
                </th>
                <th scope="col" className="px-4 py-3 text-xs font-semibold uppercase tracking-wide">
                  Intent
                </th>
                <th scope="col" className="px-4 py-3 text-xs font-semibold uppercase tracking-wide">
                  Prioridad
                </th>
                <th scope="col" className="px-4 py-3 text-xs font-semibold uppercase tracking-wide">
                  Habilitada
                </th>
                <th scope="col" className="px-4 py-3 text-xs font-semibold uppercase tracking-wide">
                  Actualizada
                </th>
                <th scope="col" className="px-4 py-3 text-xs font-semibold uppercase tracking-wide">
                  <span className="sr-only">Acciones</span>
                </th>
              </tr>
            </thead>
            <GsapStagger as="tbody" staggerDelay={0.05}>
              {items.map((row) => (
                <KbRow
                  key={row.id}
                  row={row}
                  onEdit={onEdit}
                  onDelete={(r) => setDeleteCandidate(r)}
                />
              ))}
            </GsapStagger>
          </table>
        </div>
      )}

      {/* Test match inline cuando hay entry editada y persistida */}
      {editingEntry && drawerOpen && editingEntry.id && (
        <KbTestMatch entryId={editingEntry.id} />
      )}

      <KbEntryForm
        open={drawerOpen}
        onOpenChange={(o) => {
          setDrawerOpen(o);
          if (!o) setEditingEntry(null);
        }}
        entry={editingEntry}
      />

      <Dialog
        open={!!deleteCandidate}
        onOpenChange={(o) => {
          if (!o) setDeleteCandidate(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Eliminar entrada</DialogTitle>
            <DialogDescription>
              {deleteCandidate
                ? `¿Eliminar “${deleteCandidate.title}”? Esta acción es soft-delete: la entrada queda invisible para el matcher pero se puede recuperar desde BD.`
                : ''}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setDeleteCandidate(null)}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              variant="destructive"
              data-testid="kb-delete-confirm"
              loading={deleteMut.isPending}
              onClick={onConfirmDelete}
            >
              Eliminar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

interface KbRowProps {
  row: KbEntryAdmin;
  onEdit: (row: KbEntryAdmin) => void;
  onDelete: (row: KbEntryAdmin) => void;
}

function KbRow({ row, onEdit, onDelete }: KbRowProps): JSX.Element {
  const updateMut = useUpdateKbEntry(row.id);

  const updatedRel = (() => {
    try {
      return formatDistanceToNow(new Date(row.updatedAt), {
        addSuffix: true,
        locale: es,
      });
    } catch {
      return '—';
    }
  })();

  const onToggleEnabled = (): void => {
    updateMut.mutate(
      { enabled: !row.enabled },
      {
        onError: (e) =>
          toast.error('No se pudo actualizar', {
            description: e instanceof Error ? e.message : undefined,
          }),
      },
    );
  };

  return (
    <tr
      data-testid="kb-row"
      data-kb-id={row.id}
      className="border-t border-border transition-all duration-200 hover:scale-[1.005] hover:shadow-sm"
    >
      <td className="px-4 py-3 align-middle">
        <div className="font-medium text-fg">{row.title}</div>
        <div className="text-xs text-fg-muted line-clamp-1">{row.body}</div>
      </td>
      <td className="px-4 py-3 align-middle">
        <code className="rounded bg-surface px-1.5 py-0.5 text-xs">{row.intent}</code>
      </td>
      <td className="px-4 py-3 align-middle">
        <Badge variant={row.priority >= 50 ? 'default' : 'secondary'}>
          {row.priority}
        </Badge>
      </td>
      <td className="px-4 py-3 align-middle">
        <button
          type="button"
          role="switch"
          aria-checked={row.enabled}
          aria-label={
            row.enabled ? 'Desactivar entrada' : 'Activar entrada'
          }
          data-testid="kb-row-toggle"
          data-state={row.enabled ? 'on' : 'off'}
          disabled={updateMut.isPending}
          onClick={onToggleEnabled}
          className={[
            'inline-flex h-6 w-11 items-center rounded-full border transition-all duration-200',
            row.enabled
              ? 'border-success/40 bg-success/15 ring-2 ring-success/30'
              : 'border-border bg-surface ring-2 ring-transparent',
          ].join(' ')}
        >
          <span
            className={[
              'inline-block h-4 w-4 rounded-full bg-bg shadow transition-transform duration-200',
              row.enabled ? 'translate-x-6' : 'translate-x-1',
            ].join(' ')}
          />
        </button>
      </td>
      <td className="px-4 py-3 align-middle text-xs text-fg-muted">{updatedRel}</td>
      <td className="px-4 py-3 align-middle">
        <div className="flex items-center justify-end gap-1">
          <button
            type="button"
            data-testid="kb-row-edit"
            aria-label={`Editar ${row.title}`}
            onClick={() => onEdit(row)}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-transparent text-fg-muted transition-all hover:border-border hover:bg-surface hover:text-fg"
          >
            <KbIcon kind="rowEdit" trigger="hover" size={18} />
          </button>
          <button
            type="button"
            data-testid="kb-row-delete"
            aria-label={`Eliminar ${row.title}`}
            onClick={() => onDelete(row)}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-transparent text-fg-muted transition-all hover:border-danger/40 hover:bg-danger/5 hover:text-danger"
          >
            <KbIcon kind="rowDelete" trigger="hover" size={18} />
          </button>
        </div>
      </td>
    </tr>
  );
}
