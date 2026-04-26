import { Card, CardContent, CardHeader, CardTitle, ProgressBar } from '@segurasist/ui';

export default function InsuredCoveragesPage() {
  const coverages = [
    { id: 'cov-1', name: 'Hospitalización', used: 1, limit: 4 },
    { id: 'cov-2', name: 'Consultas', used: 7, limit: 12 },
    { id: 'cov-3', name: 'Estudios', used: 3, limit: 6 },
  ];
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {coverages.map((c) => {
        const tone = c.used / c.limit >= 0.85 ? 'danger' : c.used / c.limit >= 0.6 ? 'warning' : 'success';
        return (
          <Card key={c.id}>
            <CardHeader>
              <CardTitle>{c.name}</CardTitle>
            </CardHeader>
            <CardContent>
              <ProgressBar value={c.used} max={c.limit} tone={tone} label={`${c.name}: consumo`} />
              <p className="mt-2 text-sm text-fg-muted">
                Te quedan {c.limit - c.used} de {c.limit}
              </p>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
