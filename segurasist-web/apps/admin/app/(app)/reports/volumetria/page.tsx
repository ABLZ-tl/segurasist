'use client';

/**
 * S4-02 — Página de Volumetría (line chart 90 días).
 *
 * Permite cambiar el rango (30 / 60 / 90 días).
 * El BE actual NO expone PDF/XLSX para volumetría (S1 iter1 — JSON only).
 * La descarga llegará en una historia futura si stakeholders la piden;
 * para iter1 dejamos solo el chart + selector de rango.
 */

import * as React from 'react';
import {
  Section,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@segurasist/ui';
import { VolumetriaChart } from '../../../../components/reports';

const DAYS_OPTIONS = [30, 60, 90] as const;

export default function VolumetriaPage(): React.JSX.Element {
  const [days, setDays] = React.useState<number>(90);

  return (
    <div className="space-y-6">
      <Section
        title="Volumetría"
        description="Tendencia diaria de altas, bajas, certificados y siniestros."
        actions={
          <Select value={String(days)} onValueChange={(v) => setDays(Number(v))}>
            <SelectTrigger className="w-44" aria-label="Rango de días">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DAYS_OPTIONS.map((d) => (
                <SelectItem key={d} value={String(d)}>
                  Últimos {d} días
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />

      <VolumetriaChart days={days} />
    </div>
  );
}
