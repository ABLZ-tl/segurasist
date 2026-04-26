'use client';

import * as React from 'react';
import { cn } from '@segurasist/ui';

interface BatchRow {
  id: string;
  fileName: string;
  rows: number;
  status: 'completed' | 'processing' | 'pending';
  statusLabel: string;
}

interface CertRow {
  id: string;
  insured: string;
  pkg: string;
  issuedAt: string;
}

const MOCK_BATCHES: BatchRow[] = [
  { id: 'b-101', fileName: 'asegurados-marzo.csv', rows: 1240, status: 'completed', statusLabel: 'Completado' },
  { id: 'b-102', fileName: 'altas-2026-q2.csv', rows: 432, status: 'processing', statusLabel: 'Procesando' },
  { id: 'b-103', fileName: 'bajas-marzo.csv', rows: 38, status: 'pending', statusLabel: 'Por confirmar' },
];

const MOCK_CERTS: CertRow[] = [
  { id: 'c-7001', insured: 'Carmen López', pkg: 'Premium', issuedAt: '2026-04-23' },
  { id: 'c-7002', insured: 'Roberto Salas', pkg: 'Básico', issuedAt: '2026-04-22' },
  { id: 'c-7003', insured: 'María Hernández', pkg: 'Platinum', issuedAt: '2026-04-21' },
];

function StatusChip({ status, label }: { status: BatchRow['status']; label: string }): JSX.Element {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium',
        status === 'completed' && 'bg-success/10 text-success',
        status === 'processing' && 'bg-accent/10 text-accent',
        status === 'pending' && 'bg-warning/10 text-warning',
      )}
    >
      <span
        aria-hidden
        className={cn(
          'h-1.5 w-1.5 rounded-full',
          status === 'completed' && 'bg-success',
          status === 'processing' && 'bg-accent animate-pulse',
          status === 'pending' && 'bg-warning',
        )}
      />
      {label}
    </span>
  );
}

function TableShell({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <section className="overflow-hidden rounded-lg border border-border bg-bg">
      <header className="flex items-baseline justify-between border-b border-border px-4 py-3 sm:px-5">
        <div className="space-y-0.5">
          <h2 className="text-base font-semibold tracking-tighter text-fg lg:text-lg">{title}</h2>
          {description && <p className="text-[12px] text-fg-subtle">{description}</p>}
        </div>
        <button
          type="button"
          className="text-[12px] font-medium text-fg-muted transition-colors duration-fast lg:hover:text-accent"
        >
          Ver todo
        </button>
      </header>
      <div className="overflow-x-auto">{children}</div>
    </section>
  );
}

export function DashboardTables(): JSX.Element {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <TableShell title="Lotes recientes" description="Importaciones de los últimos 7 días">
        <table className="w-full min-w-[480px] text-left text-[13px]">
          <thead className="bg-bg-elevated text-fg-subtle">
            <tr>
              <th className="px-5 py-2 text-[11px] font-medium uppercase tracking-wider">Archivo</th>
              <th className="px-5 py-2 text-right text-[11px] font-medium uppercase tracking-wider">Filas</th>
              <th className="px-5 py-2 text-[11px] font-medium uppercase tracking-wider">Estado</th>
            </tr>
          </thead>
          <tbody>
            {MOCK_BATCHES.map((row) => (
              <tr
                key={row.id}
                className="border-t border-border transition-colors duration-fast hover:bg-bg-elevated/60"
              >
                <td className="px-5 py-3 font-mono text-[12.5px] text-fg">{row.fileName}</td>
                <td className="px-5 py-3 text-right font-mono tabular-nums text-fg-muted">
                  {row.rows.toLocaleString('es-MX')}
                </td>
                <td className="px-5 py-3">
                  <StatusChip status={row.status} label={row.statusLabel} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableShell>

      <TableShell title="Últimos certificados" description="Emitidos en los últimos 3 días">
        <table className="w-full min-w-[480px] text-left text-[13px]">
          <thead className="bg-bg-elevated text-fg-subtle">
            <tr>
              <th className="px-5 py-2 text-[11px] font-medium uppercase tracking-wider">Asegurado</th>
              <th className="px-5 py-2 text-[11px] font-medium uppercase tracking-wider">Paquete</th>
              <th className="px-5 py-2 text-right text-[11px] font-medium uppercase tracking-wider">Emitido</th>
            </tr>
          </thead>
          <tbody>
            {MOCK_CERTS.map((row) => (
              <tr
                key={row.id}
                className="border-t border-border transition-colors duration-fast hover:bg-bg-elevated/60"
              >
                <td className="px-5 py-3 text-fg">{row.insured}</td>
                <td className="px-5 py-3 text-fg-muted">{row.pkg}</td>
                <td className="px-5 py-3 text-right font-mono tabular-nums text-fg-muted">
                  {row.issuedAt}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableShell>
    </div>
  );
}
