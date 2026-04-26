import { Card, CardContent, CardHeader, CardTitle, ProgressBar } from '@segurasist/ui';

interface Coverage {
  id: string;
  name: string;
  used: number;
  limit: number;
  unit: 'count' | 'mxn';
}

const MOCK: Coverage[] = [
  { id: 'cov-1', name: 'Hospitalización', used: 1, limit: 4, unit: 'count' },
  { id: 'cov-2', name: 'Consultas', used: 7, limit: 12, unit: 'count' },
  { id: 'cov-3', name: 'Estudios', used: 3, limit: 6, unit: 'count' },
  { id: 'cov-4', name: 'Medicamentos', used: 2400, limit: 8000, unit: 'mxn' },
];

const fmtMxn = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' });

export default function CoveragesPage() {
  return (
    <div className="space-y-3">
      <h1 className="text-xl font-semibold">Mis coberturas</h1>
      {MOCK.map((c) => {
        const ratio = c.used / c.limit;
        const tone = ratio >= 0.85 ? 'danger' : ratio >= 0.6 ? 'warning' : 'success';
        const remaining = c.limit - c.used;
        return (
          <Card key={c.id}>
            <CardHeader>
              <CardTitle className="text-base">{c.name}</CardTitle>
            </CardHeader>
            <CardContent>
              <ProgressBar value={c.used} max={c.limit} tone={tone} label={`${c.name}: consumo`} />
              <p className="mt-2 text-sm text-fg-muted">
                {c.unit === 'count'
                  ? `Te quedan ${remaining} de ${c.limit}`
                  : `Disponible: ${fmtMxn.format(remaining)} de ${fmtMxn.format(c.limit)}`}
              </p>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
