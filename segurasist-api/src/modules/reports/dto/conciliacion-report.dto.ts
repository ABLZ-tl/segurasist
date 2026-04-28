/**
 * S4-01 — Conciliación mensual DTOs.
 *
 * Reporte exhaustivo por tenant + ventana [from, to]:
 *   - insureds activos al inicio del período (snapshot)
 *   - insureds activos al cierre del período (snapshot)
 *   - altas (creados dentro del período)
 *   - bajas (status=cancelled cuya updatedAt cae en el período)
 *   - certificates emitidos dentro del período
 *   - claims (count + monto estimado/aprobado) dentro del período
 *   - utilización de cobertura (sum amount + count usages)
 *
 * Las cifras DEBEN cuadrar con la BD: cualquier discrepancia entre la
 * respuesta JSON y un `SELECT` directo es bug grave (criterio DoD S4-01).
 *
 * El cliente puede pedir el reporte en 3 formatos via `?format=`:
 *   - `json` (default): serie completa para FE charts / drilldown.
 *   - `pdf`: render PDF puppeteer con tabla resumen + breakdown.
 *   - `xlsx`: workbook exceljs con 4 sheets (Resumen, Detalle, Coberturas, Claims).
 */
import { ApiProperty } from '@nestjs/swagger';
import { z } from 'zod';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const ConciliacionQuerySchema = z
  .object({
    from: z.string().regex(ISO_DATE, 'from debe ser YYYY-MM-DD'),
    to: z.string().regex(ISO_DATE, 'to debe ser YYYY-MM-DD'),
    format: z.enum(['json', 'pdf', 'xlsx']).default('json'),
    /** Solo respetado para platform admin; ignorado para roles tenant-scoped. */
    tenantId: z.string().uuid().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.from > data.to) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'from debe ser <= to',
        path: ['from'],
      });
    }
  });

export type ConciliacionQuery = z.infer<typeof ConciliacionQuerySchema>;

export class ConciliacionResponseDto {
  @ApiProperty({ example: '2026-04-01' })
  from!: string;

  @ApiProperty({ example: '2026-04-30' })
  to!: string;

  @ApiProperty({ example: '11111111-1111-1111-1111-111111111111', nullable: true })
  tenantId!: string | null;

  @ApiProperty({ description: 'Insureds activos al inicio del período' })
  activosInicio!: number;

  @ApiProperty({ description: 'Insureds activos al cierre del período' })
  activosCierre!: number;

  @ApiProperty({ description: 'Altas (creados con createdAt en [from,to])' })
  altas!: number;

  @ApiProperty({ description: 'Bajas (status=cancelled con updatedAt en [from,to])' })
  bajas!: number;

  @ApiProperty({ description: 'Certificados emitidos en el período' })
  certificadosEmitidos!: number;

  @ApiProperty({ description: 'Claims con reportedAt en [from,to]' })
  claimsCount!: number;

  @ApiProperty({ description: 'Suma amountEstimated de claims en período' })
  claimsAmountEstimated!: number;

  @ApiProperty({ description: 'Suma amountApproved de claims en período' })
  claimsAmountApproved!: number;

  @ApiProperty({ description: 'Total usos de cobertura en el período' })
  coverageUsageCount!: number;

  @ApiProperty({ description: 'Suma amount de coverage usage en período' })
  coverageUsageAmount!: number;

  @ApiProperty({ description: 'ISO timestamp del cómputo' })
  generatedAt!: string;
}

export interface ConciliacionData {
  from: string;
  to: string;
  tenantId: string | null;
  activosInicio: number;
  activosCierre: number;
  altas: number;
  bajas: number;
  certificadosEmitidos: number;
  claimsCount: number;
  claimsAmountEstimated: number;
  claimsAmountApproved: number;
  coverageUsageCount: number;
  coverageUsageAmount: number;
  generatedAt: string;
}
