'use client';

/**
 * S4-01 — Botones de descarga PDF + XLSX.
 *
 * Cada botón dispara `useDownloadReport()` con el formato correspondiente.
 * Mientras la mutation está `isPending`, el botón se deshabilita y muestra
 * un spinner. Si una de las dos descargas falla, se muestra una alerta
 * inline; la otra mutation queda independiente.
 *
 * A11y:
 *  - Cada botón tiene `aria-label` específico ("Descargar PDF" / "XLSX").
 *  - `aria-busy` mientras descarga.
 *  - Mensajes de error con `role="alert"`.
 */

import * as React from 'react';
import { Button } from '@segurasist/ui';
import { Download, FileSpreadsheet, FileText, Loader2 } from 'lucide-react';
import {
  useDownloadReport,
  type ReportType,
} from '@segurasist/api-client/hooks/reports';

export interface ReportDownloadButtonsProps {
  type: ReportType;
  /** Filtros activos. Si `disabled` es true, los botones no se pueden activar. */
  filters?: Record<string, string | number | boolean | undefined>;
  /** Filename base sin extensión (default: `<type>-<YYYY-MM-DD>`). */
  filenameBase?: string;
  disabled?: boolean;
}

export function ReportDownloadButtons({
  type,
  filters,
  filenameBase,
  disabled,
}: ReportDownloadButtonsProps): React.JSX.Element {
  const pdfMut = useDownloadReport();
  const xlsxMut = useDownloadReport();

  const onClick = (format: 'pdf' | 'xlsx', mut: typeof pdfMut) => () => {
    mut.mutate({
      type,
      format,
      filters,
      filename: filenameBase ? `${filenameBase}.${format}` : undefined,
    });
  };

  return (
    <div className="space-y-2" data-testid="report-download-buttons">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="secondary"
          aria-label="Descargar reporte en PDF"
          aria-busy={pdfMut.isPending || undefined}
          disabled={disabled || pdfMut.isPending}
          onClick={onClick('pdf', pdfMut)}
        >
          {pdfMut.isPending ? (
            <Loader2 aria-hidden className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <FileText aria-hidden className="mr-2 h-4 w-4" />
          )}
          Descargar PDF
        </Button>
        <Button
          type="button"
          variant="secondary"
          aria-label="Descargar reporte en XLSX"
          aria-busy={xlsxMut.isPending || undefined}
          disabled={disabled || xlsxMut.isPending}
          onClick={onClick('xlsx', xlsxMut)}
        >
          {xlsxMut.isPending ? (
            <Loader2 aria-hidden className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <FileSpreadsheet aria-hidden className="mr-2 h-4 w-4" />
          )}
          Descargar XLSX
        </Button>
        {!disabled && !pdfMut.isPending && !xlsxMut.isPending ? (
          <span className="text-[12px] text-fg-subtle">
            <Download aria-hidden className="mr-1 inline h-3 w-3" />
            La descarga inicia automáticamente.
          </span>
        ) : null}
      </div>
      {(pdfMut.isError || xlsxMut.isError) && (
        <p
          role="alert"
          className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-[12px] text-danger"
          data-testid="report-download-error"
        >
          No pudimos generar la descarga. Verifica el rango de fechas y vuelve a intentar.
        </p>
      )}
    </div>
  );
}
