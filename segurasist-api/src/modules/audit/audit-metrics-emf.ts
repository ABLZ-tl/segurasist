/**
 * F6 iter 2 — CloudWatch EMF (Embedded Metric Format) emitter para custom
 * metrics del subsistema audit. F8 creó alarmas en namespace
 * `SegurAsist/Audit` que esperaban INSUFFICIENT_DATA hasta que cableemos
 * estas emisiones (ver F8-report.md NEW-FINDING #2).
 *
 * EMF format: un log JSON estructurado en stdout que CloudWatch Logs convierte
 * automáticamente en una metric custom (sin SDK, sin PutMetricData costs).
 * Spec: https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch_Embedded_Metric_Format_Specification.html
 *
 * Métricas emitidas:
 *   - `AuditWriterHealth` (Count, 1=ok / 0=degraded) — cada write a audit_log.
 *   - `MirrorLagSeconds` (Seconds, gauge) — diff entre `audit_logs.created_at`
 *     más reciente y último mirror S3 timestamp. Lo emite el verifier al
 *     correr `runOnce` (futuro) o el chain verifier en cross-source.
 *   - `AuditChainValid` (Count, 1=valid / 0=tampered) — resultado del
 *     verifier en `runVerification`.
 *
 * Dimensión: `Environment` (dev/staging/prod) — alarmas filtran por env.
 *
 * Por qué `console.log` y NO `Logger.log`: pino formatea el output con
 * envoltorio `{level,time,msg,...}` que CloudWatch NO interpreta como EMF
 * (parser oficial busca `_aws.CloudWatchMetrics` en el root del JSON). Una
 * línea cruda JSON en stdout es lo que el extractor reconoce.
 *
 * Por qué fire-and-forget en vez de `await`: emitir una metric NUNCA debe
 * bloquear el path crítico (audit write) — si stdout está saturado, el
 * worst-case es que la metric se pierda; el evento ya está en pino.
 */

/** Namespace canónico para todas las métricas de audit (matchea alarmas F8). */
const NAMESPACE = 'SegurAsist/Audit';

/** Nombre de métrica → unidad CloudWatch. */
const METRIC_UNITS = {
  AuditWriterHealth: 'Count',
  MirrorLagSeconds: 'Seconds',
  AuditChainValid: 'Count',
} as const;

export type AuditMetricName = keyof typeof METRIC_UNITS;

/**
 * Emite una metric en formato EMF a stdout. CloudWatch Logs (con su
 * `EmbeddedMetricFilter` configurado en el Log Group) extrae el JSON y
 * crea/actualiza la metric custom.
 *
 * En tests (NODE_ENV=test) NO emite — evita spam en jest stdout.
 */
export function emitAuditMetric(name: AuditMetricName, value: number): void {
  // Gate por env: en jest no queremos pollution del stdout.
  if (process.env.NODE_ENV === 'test') return;
  // Gate adicional: si EMF está deshabilitado (e.g. env local sin CW), skip.
  if (process.env.AUDIT_EMF_DISABLED === '1') return;

  const env = process.env.NODE_ENV ?? 'unknown';
  const payload = {
    _aws: {
      Timestamp: Date.now(),
      CloudWatchMetrics: [
        {
          Namespace: NAMESPACE,
          Dimensions: [['Environment']],
          Metrics: [{ Name: name, Unit: METRIC_UNITS[name] }],
        },
      ],
    },
    Environment: env,
    [name]: value,
  };

  // `console.log` directo: única forma de que el JSON llegue al stdout sin
  // wrapper pino. Try-catch defensivo: si console.log fallara (filesystem
  // saturado en Lambda runtime, e.g.), no propagamos al caller.
  try {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(payload));
  } catch {
    // ignorar — métrica perdida pero el evento de audit ya quedó en pino.
  }
}
