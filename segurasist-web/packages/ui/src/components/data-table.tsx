'use client';

import * as React from 'react';
import { cn } from '../lib/cn';
import { Skeleton } from './skeleton';
import { EmptyState } from './empty-state';

export interface DataTableColumn<T> {
  id: string;
  header: React.ReactNode;
  cell: (row: T) => React.ReactNode;
  className?: string;
  /** ARIA scope override; defaults to "col" */
  scope?: 'col' | 'row';
}

export interface DataTableProps<T> {
  data: T[];
  columns: DataTableColumn<T>[];
  loading?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  caption?: string;
  rowKey: (row: T, index: number) => string;
  onRowClick?: (row: T) => void;
  className?: string;
}

export function DataTable<T>({
  data,
  columns,
  loading,
  emptyTitle = 'Sin resultados',
  emptyDescription,
  caption,
  rowKey,
  onRowClick,
  className,
}: DataTableProps<T>) {
  if (loading) {
    return (
      <div className="space-y-2" aria-busy aria-live="polite">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }
  if (!data.length) {
    return <EmptyState title={emptyTitle} {...(emptyDescription ? { description: emptyDescription } : {})} />;
  }

  return (
    <div className={cn('w-full overflow-x-auto rounded-md border border-border', className)}>
      <table className="w-full text-left text-sm">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead className="bg-surface text-fg-muted">
          <tr>
            {columns.map((col) => (
              <th
                key={col.id}
                scope={col.scope ?? 'col'}
                className={cn('px-4 py-3 text-xs font-semibold uppercase tracking-wide', col.className)}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row, index) => (
            <tr
              key={rowKey(row, index)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={cn(
                'border-t border-border transition-colors',
                onRowClick && 'cursor-pointer hover:bg-surface',
              )}
            >
              {columns.map((col) => (
                <td key={col.id} className={cn('px-4 py-3 align-middle', col.className)}>
                  {col.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
