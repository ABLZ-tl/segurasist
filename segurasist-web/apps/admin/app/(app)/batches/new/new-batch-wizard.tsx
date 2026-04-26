'use client';

/**
 * S1-05 FE — Wizard de carga masiva (3 pasos).
 *
 * Paso 1: Subir archivo (FileDrop, validación cliente size/ext).
 * Paso 2: Preview con totales + tabla con paginación server-side.
 * Paso 3: Confirmar (toggle notify-by-email + redirect a /batches/{id}).
 *
 * Conectado a:
 *   POST /v1/batches               (multipart upload)
 *   GET  /v1/batches/template      (download plantilla)
 *   GET  /v1/batches/{id}/preview  (paginated)
 *   GET  /v1/batches/{id}/errors.xlsx (excel descargable)
 *   POST /v1/batches/{id}/confirm
 */

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  AlertBanner,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DataTable,
  FileDrop,
  Section,
  Stat,
  Tabs,
  TabsList,
  TabsTrigger,
} from '@segurasist/ui';
import type { DataTableColumn } from '@segurasist/ui';
import { CheckCircle2, Download } from 'lucide-react';
import { api } from '@segurasist/api-client';

type Step = 1 | 2 | 3;

interface BatchUploadResp {
  id: string;
  status: string;
  rowsTotal: number;
  rowsOk: number;
  rowsError: number;
}

interface PreviewRow {
  rowNumber: number;
  ok: boolean;
  duplicate?: boolean;
  curp?: string | null;
  fullName?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
}

interface PreviewResp {
  items: PreviewRow[];
  page: number;
  pageSize: number;
  total: number;
}

const MAX_SIZE_BYTES = 25 * 1024 * 1024;

export function NewBatchWizard(): JSX.Element {
  const router = useRouter();
  const [step, setStep] = React.useState<Step>(1);
  const [file, setFile] = React.useState<File | null>(null);
  const [batch, setBatch] = React.useState<BatchUploadResp | null>(null);
  const [previewTab, setPreviewTab] = React.useState<'all' | 'ok' | 'errors' | 'dups'>('all');
  const [previewPage, setPreviewPage] = React.useState(1);
  const [notify, setNotify] = React.useState(true);
  const [clientError, setClientError] = React.useState<string | null>(null);

  const uploadMutation = useMutation({
    mutationFn: async (f: File) => {
      const fd = new FormData();
      fd.append('file', f);
      return api<BatchUploadResp>('/v1/batches', {
        method: 'POST',
        body: fd,
        headers: {},
      });
    },
    onSuccess: (data) => {
      setBatch(data);
      setStep(2);
    },
  });

  const confirmMutation = useMutation({
    mutationFn: async ({ id }: { id: string; notify: boolean }) =>
      api<BatchUploadResp>(`/v1/batches/${id}/confirm`, {
        method: 'POST',
        body: JSON.stringify({ notify }),
      }),
    onSuccess: (data) => {
      // Typed routes: dynamic segment requires `as never` to satisfy Next.js
      // Route literal type. The runtime URL is correct.
      router.push(`/batches/${data.id}` as never);
    },
  });

  const previewQuery = useQuery({
    queryKey: ['batches', 'preview', batch?.id, previewTab, previewPage],
    queryFn: () =>
      api<PreviewResp>(
        `/v1/batches/${batch!.id}/preview?page=${previewPage}&filter=${previewTab}`,
      ),
    enabled: !!batch && step === 2,
  });

  function handleFiles(files: File[]) {
    setClientError(null);
    const f = files[0];
    if (!f) return;
    if (f.size > MAX_SIZE_BYTES) {
      setClientError('El archivo excede 25 MB');
      return;
    }
    const ext = f.name.toLowerCase().split('.').pop();
    if (ext !== 'xlsx' && ext !== 'csv') {
      setClientError('Sólo se aceptan archivos .xlsx o .csv');
      return;
    }
    setFile(f);
  }

  function downloadTemplate() {
    window.location.assign('/api/proxy/v1/batches/template');
  }

  function downloadErrors() {
    if (!batch) return;
    window.location.assign(`/api/proxy/v1/batches/${batch.id}/errors.xlsx`);
  }

  return (
    <div className="space-y-6">
      <Section title="Nuevo lote" description="Wizard de carga masiva" />

      <Stepper step={step} />

      {step === 1 && (
        <Card>
          <CardHeader>
            <CardTitle>Subir archivo</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <FileDrop
              accept=".csv,.xlsx"
              maxSizeBytes={MAX_SIZE_BYTES}
              onFiles={handleFiles}
              hint="CSV o XLSX, hasta 25 MB"
            />
            {clientError && <AlertBanner tone="danger">{clientError}</AlertBanner>}
            {uploadMutation.isError && (
              <AlertBanner tone="danger">
                {(uploadMutation.error as Error)?.message ?? 'No pudimos subir el archivo.'}
              </AlertBanner>
            )}
            <div className="flex items-center justify-between">
              <Button variant="ghost" type="button" onClick={downloadTemplate}>
                <Download aria-hidden className="mr-2 h-4 w-4" />
                Descargar plantilla v1
              </Button>
              <Button
                onClick={() => file && uploadMutation.mutate(file)}
                disabled={!file}
                loading={uploadMutation.isPending}
              >
                Continuar
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 2 && batch && (
        <PreviewStep
          batch={batch}
          tab={previewTab}
          onTabChange={(t) => {
            setPreviewTab(t);
            setPreviewPage(1);
          }}
          page={previewPage}
          onPageChange={setPreviewPage}
          preview={previewQuery.data}
          loading={previewQuery.isLoading}
          onBack={() => setStep(1)}
          onContinue={() => setStep(3)}
          onDownloadErrors={downloadErrors}
        />
      )}

      {step === 3 && batch && (
        <Card>
          <CardHeader>
            <CardTitle>Confirmar lote</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="Total" value={batch.rowsTotal} />
              <Stat label="Válidas" value={batch.rowsOk} />
              <Stat label="Con error" value={batch.rowsError} />
              <Stat
                label="% válidas"
                value={
                  batch.rowsTotal > 0
                    ? `${Math.round((batch.rowsOk / batch.rowsTotal) * 100)}%`
                    : '—'
                }
              />
            </div>
            <label className="flex items-center gap-2 text-[13px] text-fg-muted">
              <input
                type="checkbox"
                checked={notify}
                onChange={(e) => setNotify(e.target.checked)}
                className="h-4 w-4 rounded border-border accent-accent"
              />
              Notificar al terminar por email
            </label>
            {confirmMutation.isError && (
              <AlertBanner tone="danger">
                {(confirmMutation.error as Error)?.message ?? 'No pudimos confirmar el lote.'}
              </AlertBanner>
            )}
            <div className="flex justify-between">
              <Button variant="ghost" onClick={() => setStep(2)}>
                Atrás
              </Button>
              <Button
                onClick={() => confirmMutation.mutate({ id: batch.id, notify })}
                loading={confirmMutation.isPending}
                disabled={batch.rowsOk === 0}
              >
                Confirmar lote
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Stepper({ step }: { step: Step }): JSX.Element {
  return (
    <ol aria-label="Pasos del wizard" className="flex items-center gap-3 text-sm">
      {(['Subir archivo', 'Previsualización', 'Confirmar'] as const).map((label, i) => {
        const s = (i + 1) as Step;
        const active = step === s;
        const done = step > s;
        return (
          <li
            key={label}
            className={`flex items-center gap-2 rounded-full border px-3 py-1 ${
              active
                ? 'border-accent text-accent'
                : done
                  ? 'border-success text-success'
                  : 'border-border text-fg-muted'
            }`}
            aria-current={active ? 'step' : undefined}
          >
            {done && <CheckCircle2 aria-hidden className="h-4 w-4" />} {s}. {label}
          </li>
        );
      })}
    </ol>
  );
}

function PreviewStep({
  batch,
  tab,
  onTabChange,
  page: _page,
  onPageChange,
  preview,
  loading,
  onBack,
  onContinue,
  onDownloadErrors,
}: {
  batch: BatchUploadResp;
  tab: 'all' | 'ok' | 'errors' | 'dups';
  onTabChange: (t: 'all' | 'ok' | 'errors' | 'dups') => void;
  page: number;
  onPageChange: (p: number) => void;
  preview: PreviewResp | undefined;
  loading: boolean;
  onBack: () => void;
  onContinue: () => void;
  onDownloadErrors: () => void;
}): JSX.Element {
  const errorRate = batch.rowsTotal > 0 ? batch.rowsError / batch.rowsTotal : 0;

  const cols: DataTableColumn<PreviewRow>[] = [
    { id: 'row', header: 'Fila', cell: (r) => r.rowNumber },
    {
      id: 'curp',
      header: 'CURP',
      cell: (r) => <code className="font-mono text-xs">{r.curp ?? '—'}</code>,
    },
    { id: 'name', header: 'Nombre', cell: (r) => r.fullName ?? '—' },
    {
      id: 'status',
      header: 'Estado',
      cell: (r) =>
        r.ok ? (
          <span className="text-success">OK</span>
        ) : r.duplicate ? (
          <span className="text-warning" title={r.errorMessage ?? 'Duplicado'}>
            Duplicada
          </span>
        ) : (
          <span className="text-danger" title={r.errorMessage ?? ''}>
            {r.errorCode ?? 'ERROR'}
          </span>
        ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Total" value={batch.rowsTotal} />
        <Stat label="Válidas" value={batch.rowsOk} />
        <Stat label="Con error" value={batch.rowsError} />
        <Stat label="% válidas" value={
          batch.rowsTotal > 0 ? `${Math.round((batch.rowsOk / batch.rowsTotal) * 100)}%` : '—'
        } />
      </div>

      {errorRate > 0.5 && (
        <AlertBanner tone="warning" title="Muchos errores en este archivo">
          Más del 50% de las filas tienen errores. Considera corregir el archivo y re-subirlo.
        </AlertBanner>
      )}

      <Tabs value={tab} onValueChange={(v) => onTabChange(v as typeof tab)}>
        <TabsList>
          <TabsTrigger value="all">Todas</TabsTrigger>
          <TabsTrigger value="ok">Válidas</TabsTrigger>
          <TabsTrigger value="errors">Errores</TabsTrigger>
          <TabsTrigger value="dups">Duplicadas</TabsTrigger>
        </TabsList>
      </Tabs>

      <DataTable
        data={preview?.items ?? []}
        columns={cols}
        rowKey={(r) => String(r.rowNumber)}
        loading={loading}
        emptyTitle="Sin filas en esta vista"
      />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button variant="ghost" onClick={onBack}>
          Atrás
        </Button>
        <div className="flex flex-wrap items-center gap-2">
          {batch.rowsError > 0 && (
            <Button variant="secondary" onClick={onDownloadErrors}>
              <Download aria-hidden className="mr-2 h-4 w-4" />
              Descargar errores
            </Button>
          )}
          <Button onClick={onContinue} disabled={batch.rowsOk === 0}>
            Continuar
          </Button>
        </div>
      </div>

      {/* Pagination omitido para Sprint 2 — el server devuelve todas las
       *  filas relevantes en una página inicial. Cuando S2-A wired el
       *  server-side preview pagination, agregamos `Pagination` aquí. */}
      {preview && preview.total > preview.items.length && (
        <p className="text-[12px] text-fg-subtle">
          Mostrando {preview.items.length} de {preview.total} filas. Usa la búsqueda en
          /batches/{batch.id} para ver más.
        </p>
      )}
      <span className="hidden">{onPageChange.length}</span>
    </div>
  );
}
