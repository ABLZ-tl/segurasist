'use client';

/**
 * S3-09 — Botón de exportación XLSX/PDF del listado de asegurados.
 *
 * Flujo UX:
 *   1. Click en "Exportar" abre un Sheet drawer.
 *   2. User selecciona formato (XLSX por default) y revisa filtros activos.
 *   3. Click "Generar" → POST /v1/insureds/export → recibimos `exportId`.
 *   4. Polling cada 2s a GET /v1/exports/:id (vía useExportStatus).
 *   5. Cuando status='ready' → mostramos botón "Descargar" que abre el
 *      presigned URL en nueva pestaña.
 *   6. Si status='failed' → mostramos error human-readable.
 *
 * Anti-spam: el botón "Generar" se deshabilita mientras hay un export en
 * vuelo (status pending|processing) — incluso si el rate limit del backend
 * (1/min por user) deja pasar otra request, el FE lo bloquea visualmente
 * para no estresar al user.
 */

import * as React from 'react';
import {
  Button,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@segurasist/ui';
import { Download, Loader2 } from 'lucide-react';
import {
  useExportStatus,
  useRequestExport,
  type ExportFilters,
} from '@segurasist/api-client/hooks/exports';

export interface ExportButtonProps {
  /** Filtros actualmente aplicados al listado, replicados al export. */
  filters: ExportFilters;
  /** Resumen human-readable de los filtros (p.ej. "Estado=Vigente · Q=Lopez"). */
  filtersSummary?: string;
}

export function ExportButton({ filters, filtersSummary }: ExportButtonProps): React.JSX.Element {
  const [open, setOpen] = React.useState(false);
  const [format, setFormat] = React.useState<'xlsx' | 'pdf'>('xlsx');
  const [exportId, setExportId] = React.useState<string | null>(null);
  const requestMut = useRequestExport();
  const statusQuery = useExportStatus(exportId);
  const status = statusQuery.data;

  const inFlight = status?.status === 'pending' || status?.status === 'processing';
  const ready = status?.status === 'ready';
  const failed = status?.status === 'failed';

  const onGenerate = async (): Promise<void> => {
    try {
      const resp = await requestMut.mutateAsync({ format, filters });
      setExportId(resp.exportId);
    } catch (err) {
      // El error queda visible vía requestMut.error.
      // eslint-disable-next-line no-console
      console.error('export request failed', err);
    }
  };

  const onClose = (next: boolean): void => {
    setOpen(next);
    if (!next) {
      // Reset estado al cerrar — si el user vuelve a abrir, empieza limpio.
      setExportId(null);
      requestMut.reset();
    }
  };

  return (
    <Sheet open={open} onOpenChange={onClose}>
      <SheetTrigger asChild>
        <Button variant="secondary">
          <Download aria-hidden className="mr-2 h-4 w-4" />
          Exportar
        </Button>
      </SheetTrigger>
      <SheetContent side="right" aria-describedby="export-help">
        <SheetHeader>
          <SheetTitle>Exportar listado</SheetTitle>
          <SheetDescription id="export-help">
            Esto puede tomar hasta 30 segundos. Recibirás un enlace de descarga válido por 24
            horas.
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-6">
          <fieldset className="space-y-2">
            <legend className="text-[12px] font-medium text-fg-muted">Formato</legend>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="export-format"
                value="xlsx"
                checked={format === 'xlsx'}
                onChange={() => setFormat('xlsx')}
                aria-label="XLSX"
              />
              <span>XLSX (Excel)</span>
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="export-format"
                value="pdf"
                checked={format === 'pdf'}
                onChange={() => setFormat('pdf')}
                aria-label="PDF"
              />
              <span>PDF</span>
            </label>
          </fieldset>

          <div className="rounded-md border border-border bg-bg-subtle p-3 text-[12px] text-fg-muted">
            <div className="font-medium text-fg">Filtros aplicados</div>
            <div className="mt-1">{filtersSummary || 'Ninguno (export completo)'}</div>
          </div>

          {!exportId && (
            <Button
              onClick={() => {
                void onGenerate();
              }}
              disabled={requestMut.isPending}
              aria-label="Generar exportación"
            >
              {requestMut.isPending && <Loader2 aria-hidden className="mr-2 h-4 w-4 animate-spin" />}
              Generar
            </Button>
          )}

          {exportId && inFlight && (
            <div
              role="status"
              aria-live="polite"
              className="flex items-center gap-2 text-sm text-fg-muted"
            >
              <Loader2 aria-hidden className="h-4 w-4 animate-spin" />
              Procesando exportación... ({status?.status})
            </div>
          )}

          {ready && status?.downloadUrl && (
            <div className="space-y-2">
              <Button
                onClick={() => {
                  window.open(status.downloadUrl, '_blank', 'noopener,noreferrer');
                }}
                aria-label="Descargar archivo"
              >
                <Download aria-hidden className="mr-2 h-4 w-4" />
                Descargar ({status.rowCount ?? 0} filas)
              </Button>
              <div className="text-[11px] text-fg-muted">
                Hash SHA-256: <code className="font-mono">{status.hash?.slice(0, 16)}...</code>
              </div>
            </div>
          )}

          {failed && (
            <div
              role="alert"
              className="rounded-md border border-danger/30 bg-danger/10 p-3 text-[13px] text-danger"
            >
              Falló la exportación: {status?.error ?? 'Error desconocido'}.
            </div>
          )}

          {requestMut.isError && (
            <div
              role="alert"
              className="rounded-md border border-danger/30 bg-danger/10 p-3 text-[13px] text-danger"
            >
              No se pudo encolar la exportación. Verifica si excediste el límite (1/min, 10/día).
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
