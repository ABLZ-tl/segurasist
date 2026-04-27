'use client';

/**
 * S3-06 — Tab "Coberturas" de la vista 360.
 *
 * Cards con `ProgressBar`. Diseño análogo al portal pero con detalle
 * adicional: lastUsedAt + breakdown de tipo (count/amount). El cálculo
 * de tone (warning/danger) replica el portal para consistencia visual.
 */

import * as React from 'react';
import { Card, CardContent, CardHeader, CardTitle, EmptyState, ProgressBar } from '@segurasist/ui';
import type { Insured360 } from '../../../../lib/hooks/use-insured-360';

interface Props {
  coverages: Insured360['coverages'];
}

function fmt(value: number, type: 'count' | 'amount'): string {
  if (type === 'amount') {
    return value.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
  }
  return value.toLocaleString('es-MX');
}

export function InsuredCoberturasTab({ coverages }: Props): React.ReactElement {
  if (coverages.length === 0) {
    return (
      <EmptyState
        title="Sin coberturas configuradas"
        description="El paquete del asegurado no tiene coberturas activas."
      />
    );
  }
  return (
    <div className="grid gap-4 sm:grid-cols-2" data-testid="coverages-grid">
      {coverages.map((c) => {
        const ratio = c.limit > 0 ? c.used / c.limit : 0;
        const tone = ratio >= 0.85 ? 'danger' : ratio >= 0.6 ? 'warning' : 'success';
        return (
          <Card key={c.id}>
            <CardHeader>
              <CardTitle>{c.name}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <ProgressBar
                value={c.used}
                max={c.limit > 0 ? c.limit : 1}
                tone={tone}
                label={`${c.name}: consumo`}
              />
              <p className="text-sm text-fg-muted">
                {fmt(c.used, c.type)} de {fmt(c.limit, c.type)} ({c.unit})
              </p>
              <p className="text-xs text-fg-muted">
                Último uso:{' '}
                {c.lastUsedAt ? new Date(c.lastUsedAt).toLocaleString('es-MX') : 'Nunca'}
              </p>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
