// CloudWatch EMF (Embedded Metric Format) helpers.
// Emite métricas custom escribiendo JSON a stdout; CloudWatch agent las parsea.

export type MetricUnit = 'Count' | 'Milliseconds' | 'Seconds' | 'Bytes' | 'Percent';

export interface EmfDimensionSet {
  [k: string]: string;
}

export interface EmfMetric {
  name: string;
  unit: MetricUnit;
  value: number;
}

export interface EmfPayload {
  namespace: string;
  dimensions: EmfDimensionSet;
  metrics: EmfMetric[];
  timestampMs?: number;
}

export function emitEmf(p: EmfPayload): void {
  const ts = p.timestampMs ?? Date.now();
  const dimensionKeys = Object.keys(p.dimensions);
  const root: Record<string, unknown> = {
    _aws: {
      Timestamp: ts,
      CloudWatchMetrics: [
        {
          Namespace: p.namespace,
          Dimensions: [dimensionKeys],
          Metrics: p.metrics.map((m) => ({ Name: m.name, Unit: m.unit })),
        },
      ],
    },
    ...p.dimensions,
  };
  for (const m of p.metrics) {
    root[m.name] = m.value;
  }
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(root));
}

export const Metric = {
  count: (name: string, value = 1): EmfMetric => ({ name, unit: 'Count', value }),
  ms: (name: string, value: number): EmfMetric => ({ name, unit: 'Milliseconds', value }),
};
