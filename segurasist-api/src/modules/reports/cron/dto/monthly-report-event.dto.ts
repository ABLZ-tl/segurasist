/**
 * S4-04 — DTO del evento que EventBridge inyecta en la cola
 * `monthly-reports`. El módulo Terraform `eventbridge-rule` (caller del
 * env) define el `input` literal de la regla; mantener este shape
 * sincronizado con `segurasist-infra/modules/eventbridge-rule/main.tf`.
 *
 * Campos:
 *   - `kind`: discriminador del tipo de mensaje (literal `cron.monthly_reports`).
 *     El handler ignora cualquier otro `kind` para no procesar mensajes
 *     accidentalmente (pe.g. mismo tenant pero otro feature usando la cola).
 *   - `cronRuleName` / `cronExpression`: vienen de la rule Terraform y se
 *     loguean para correlación. NO se usan en lógica de negocio.
 *   - `schemaVersion`: bump si cambia el shape (e.g. agregamos `tenantId`
 *     opcional para re-trigger por tenant). Sprint 5 maneja v2.
 *   - `triggeredAt`: ISO timestamp del trigger. Si está ausente (e.g.
 *     re-trigger manual desde un dev script), el handler usa `new Date()`.
 *   - `overridePeriod`: opcional para re-triggers; permite generar un
 *     reporte de un período específico (mes/año). Si está ausente el
 *     handler resuelve el período al "mes anterior al triggeredAt".
 */
import { z } from 'zod';

export const MonthlyReportCronEventSchema = z.object({
  kind: z.literal('cron.monthly_reports'),
  cronRuleName: z.string().min(1).optional(),
  cronExpression: z.string().min(1).optional(),
  schemaVersion: z.number().int().min(1).max(99).default(1),
  triggeredAt: z.string().datetime().optional(),
  overridePeriod: z
    .object({
      year: z.number().int().min(2024).max(2100),
      month: z.number().int().min(1).max(12),
    })
    .optional(),
  /**
   * Re-trigger manual: ops puede inyectar el mensaje con
   * `triggeredBy='manual'` para distinguir de cron real en `monthly_report_runs`.
   * Default: 'eventbridge'.
   */
  triggeredBy: z.enum(['eventbridge', 'manual']).default('eventbridge'),
});

export type MonthlyReportCronEvent = z.infer<typeof MonthlyReportCronEventSchema>;

/**
 * Resuelve el período (year/month) reportado a partir del trigger.
 *
 * Reglas:
 *   - Si `overridePeriod` está presente, gana siempre.
 *   - Si no, el período es el MES ANTERIOR al `triggeredAt` (UTC). Esto
 *     respeta la semántica del producto: "el día 1 de mayo recibo el
 *     reporte de cierre de abril".
 *
 * Edge: enero (mes 1) → diciembre (mes 12) del año anterior.
 */
export function resolveReportedPeriod(
  triggeredAt: Date,
  override?: MonthlyReportCronEvent['overridePeriod'],
): { year: number; month: number } {
  if (override) return { year: override.year, month: override.month };
  const utcYear = triggeredAt.getUTCFullYear();
  const utcMonth = triggeredAt.getUTCMonth() + 1; // 1..12
  if (utcMonth === 1) {
    return { year: utcYear - 1, month: 12 };
  }
  return { year: utcYear, month: utcMonth - 1 };
}
