'use client';

import * as React from 'react';
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
} from '@segurasist/ui';
import type { DataTableColumn } from '@segurasist/ui';
import { CheckCircle2, Download } from 'lucide-react';

type Step = 1 | 2 | 3;

interface PreviewRow {
  row: number;
  curp: string;
  name: string;
  ok: boolean;
  error?: string;
}

const MOCK_PREVIEW: PreviewRow[] = [
  { row: 1, curp: 'CARM920101MDFRPN08', name: 'Carmen López', ok: true },
  { row: 2, curp: 'BADCURP', name: 'Sin nombre', ok: false, error: 'CURP inválido' },
  { row: 3, curp: 'ROSL850712HDFRRN05', name: 'Roberto Salas', ok: true },
];

const previewCols: DataTableColumn<PreviewRow>[] = [
  { id: 'row', header: 'Fila', cell: (r) => r.row },
  { id: 'curp', header: 'CURP', cell: (r) => <code className="font-mono text-xs">{r.curp}</code> },
  { id: 'name', header: 'Nombre', cell: (r) => r.name },
  {
    id: 'status',
    header: 'Estado',
    cell: (r) => (r.ok ? <span className="text-success">OK</span> : <span className="text-danger">{r.error}</span>),
  },
];

export function NewBatchWizard(): JSX.Element {
  const [step, setStep] = React.useState<Step>(1);
  const [file, setFile] = React.useState<File | null>(null);

  return (
    <div className="space-y-6">
      <Section title="Nuevo lote" description="Wizard de carga masiva" />

      <ol aria-label="Pasos del wizard" className="flex items-center gap-3 text-sm">
        {(['Subir archivo', 'Previsualización', 'Confirmar'] as const).map((label, i) => {
          const s = (i + 1) as Step;
          const active = step === s;
          const done = step > s;
          return (
            <li
              key={label}
              className={`flex items-center gap-2 rounded-full border px-3 py-1 ${
                active ? 'border-accent text-accent' : done ? 'border-success text-success' : 'border-border text-fg-muted'
              }`}
              aria-current={active ? 'step' : undefined}
            >
              {done && <CheckCircle2 aria-hidden className="h-4 w-4" />} {s}. {label}
            </li>
          );
        })}
      </ol>

      {step === 1 && (
        <Card>
          <CardHeader>
            <CardTitle>Subir archivo</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <FileDrop
              accept=".csv,.xlsx"
              maxSizeBytes={25 * 1024 * 1024}
              onFiles={(files) => setFile(files[0] ?? null)}
              hint="CSV o XLSX, hasta 25 MB"
            />
            <div className="flex items-center justify-between">
              <Button variant="ghost">
                <Download aria-hidden className="mr-2 h-4 w-4" />
                Descargar plantilla
              </Button>
              <Button onClick={() => setStep(2)} disabled={!file}>
                Continuar
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 2 && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Stat label="Total" value={MOCK_PREVIEW.length} />
            <Stat label="Válidas" value={MOCK_PREVIEW.filter((r) => r.ok).length} />
            <Stat label="Con error" value={MOCK_PREVIEW.filter((r) => !r.ok).length} />
            <Stat label="Duplicadas" value={0} />
          </div>
          <DataTable data={MOCK_PREVIEW} columns={previewCols} rowKey={(r) => String(r.row)} />
          <div className="flex justify-between">
            <Button variant="ghost" onClick={() => setStep(1)}>
              Atrás
            </Button>
            <Button onClick={() => setStep(3)}>Confirmar lote</Button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-4">
          <AlertBanner tone="success" title="Lote enviado">
            Te avisaremos por correo cuando termine el procesamiento.
          </AlertBanner>
          <Button variant="ghost" onClick={() => setStep(1)}>
            Subir otro archivo
          </Button>
        </div>
      )}
    </div>
  );
}
