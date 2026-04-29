'use client';

/**
 * Sprint 5 — S5-3 finisher.
 *
 * <KbCsvImport /> — dropzone CSV para bulk import.
 *
 * El BE (`POST /v1/admin/chatbot/kb/import`) acepta el CSV como string
 * en `body.csv` (no multipart — Sprint 5 iter 1 BE lo eligió así para
 * no añadir Multer al chatbot module). Por eso aquí leemos el archivo
 * con FileReader y enviamos JSON `{ csv, upsert }`.
 *
 * Validación cliente:
 *   - Tipo MIME `text/csv` o extensión `.csv` (algunos navegadores envían
 *     `application/vnd.ms-excel` para CSV — aceptamos ambos).
 *   - Tamaño ≤ 1MB (límite del Zod BE: `csv: z.string().max(1024*1024)`).
 *
 * Resultado:
 *   - Render del summary inserted/updated/skipped + lista de errores
 *     (row + reason). Botón "Cerrar" colapsa.
 */

import * as React from 'react';
import { Button, FileDrop } from '@segurasist/ui';
import {
  useImportKbCsv,
  type ImportKbCsvResult,
} from '@segurasist/api-client/hooks/admin-chatbot-kb';
import { KbIcon } from './_lordicons';

const MAX_BYTES = 1_024 * 1_024;
const ACCEPTED_TYPES = new Set([
  'text/csv',
  'application/vnd.ms-excel',
  'application/csv',
  '',
]);

function isCsv(file: File): boolean {
  if (ACCEPTED_TYPES.has(file.type)) return true;
  return /\.csv$/i.test(file.name);
}

export interface KbCsvImportProps {
  /** Cierra el panel desde fuera (post-success o cancel). */
  onClose?: () => void;
}

export function KbCsvImport({ onClose }: KbCsvImportProps): JSX.Element {
  const [error, setError] = React.useState<string | null>(null);
  const [upsert, setUpsert] = React.useState(true);
  const [result, setResult] = React.useState<ImportKbCsvResult | null>(null);
  const mut = useImportKbCsv();

  const handleFiles = async (files: File[]): Promise<void> => {
    setError(null);
    setResult(null);
    const file = files[0];
    if (!file) return;
    if (!isCsv(file)) {
      setError('Formato no soportado. Sube un archivo .csv.');
      return;
    }
    if (file.size > MAX_BYTES) {
      setError('El archivo supera 1MB. Divide el CSV en lotes más pequeños.');
      return;
    }
    const text = await file.text();
    try {
      const r = await mut.mutateAsync({ csv: text, upsert });
      setResult(r);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : 'No se pudo importar el CSV.',
      );
    }
  };

  return (
    <section
      data-testid="kb-csv-import"
      className="rounded-md border border-border bg-surface p-4"
    >
      <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <KbIcon kind="csvImport" trigger="loop" size={22} />
          <h3 className="text-sm font-semibold text-fg">Importar CSV</h3>
        </div>
        <label className="inline-flex items-center gap-2 text-xs text-fg-muted">
          <input
            type="checkbox"
            data-testid="kb-csv-upsert"
            checked={upsert}
            onChange={(e) => setUpsert(e.target.checked)}
            className="h-3.5 w-3.5 rounded border-border"
          />
          Upsert por intent
        </label>
      </header>

      <p className="mb-2 text-xs text-fg-muted">
        Encabezados: <code>intent,title,body,keywords,priority,enabled</code>.
        Separa keywords con <code>|</code>.
      </p>

      <FileDrop
        accept=".csv,text/csv"
        maxSizeBytes={MAX_BYTES}
        onFiles={(files) => void handleFiles(files)}
        title="Arrastra un .csv o haz click"
        hint="Máximo 1 MB"
        disabled={mut.isPending}
      />

      {error && (
        <p
          role="alert"
          data-testid="kb-csv-error"
          className="mt-2 text-sm font-medium text-danger"
        >
          {error}
        </p>
      )}

      {result && (
        <div
          data-testid="kb-csv-result"
          className="mt-3 rounded-md border border-border bg-bg p-3 text-sm"
        >
          <ul className="grid grid-cols-3 gap-2 text-center">
            <li>
              <span className="block text-xs text-fg-muted">Insertadas</span>
              <span data-testid="kb-csv-inserted" className="font-semibold text-success">
                {result.inserted}
              </span>
            </li>
            <li>
              <span className="block text-xs text-fg-muted">Actualizadas</span>
              <span data-testid="kb-csv-updated" className="font-semibold text-fg">
                {result.updated}
              </span>
            </li>
            <li>
              <span className="block text-xs text-fg-muted">Omitidas</span>
              <span data-testid="kb-csv-skipped" className="font-semibold text-warning">
                {result.skipped}
              </span>
            </li>
          </ul>
          {result.errors.length > 0 && (
            <details className="mt-3 text-xs text-fg-muted">
              <summary className="cursor-pointer font-medium text-fg">
                {result.errors.length} errores
              </summary>
              <ul className="mt-1 space-y-1">
                {result.errors.map((err, idx) => (
                  <li key={`${err.row}-${idx}`}>
                    Fila {err.row}: {err.reason}
                  </li>
                ))}
              </ul>
            </details>
          )}
          {onClose && (
            <div className="mt-3 flex justify-end">
              <Button type="button" variant="ghost" onClick={onClose}>
                Cerrar
              </Button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
