/**
 * S4-03 — Utilización por cobertura.
 *
 * Top-N consumidores agregados por paquete + breakdown por tipo de cobertura.
 * El reporte responde a la pregunta: "¿qué paquetes/coberturas se consumen
 * más y por qué monto?".
 *
 * `topN` controla el corte (default 10, max 100). El service:
 *   1. Agrega `coverage_usage` por (packageId, coverageType) sumando amount + count.
 *   2. ORDER BY amount DESC LIMIT topN.
 *   3. Devuelve también el total agregado por paquete (sin LIMIT) para el
 *      gráfico stack del FE.
 */
import { ApiProperty } from '@nestjs/swagger';
import { z } from 'zod';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const UtilizacionQuerySchema = z
  .object({
    from: z.string().regex(ISO_DATE, 'from debe ser YYYY-MM-DD'),
    to: z.string().regex(ISO_DATE, 'to debe ser YYYY-MM-DD'),
    topN: z.coerce.number().int().min(1).max(100).default(10),
    tenantId: z.string().uuid().optional(),
    /**
     * S1 iter 2 — filtro opcional por paquete. Cuando viene, el service
     * restringe el groupBy a coverages cuyo `packageId` coincide. La UI
     * (S2) usa esto para drilldown desde el bar chart "byPackage".
     * Validamos UUID para evitar SQL injection vía Prisma raw filters.
     */
    packageId: z.string().uuid().optional(),
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

export type UtilizacionQuery = z.infer<typeof UtilizacionQuerySchema>;

export class UtilizacionRowDto {
  @ApiProperty({ example: '22222222-2222-2222-2222-222222222222' })
  packageId!: string;

  @ApiProperty({ example: 'Plan Premium' })
  packageName!: string;

  @ApiProperty({ example: '33333333-3333-3333-3333-333333333333' })
  coverageId!: string;

  @ApiProperty({ example: 'Hospitalización' })
  coverageName!: string;

  @ApiProperty({ example: 'count_based', enum: ['count_based', 'amount_based'] })
  coverageType!: string;

  @ApiProperty({ example: 42 })
  usageCount!: number;

  @ApiProperty({ example: 1234.56 })
  usageAmount!: number;
}

export class UtilizacionPackageAggregateDto {
  @ApiProperty()
  packageId!: string;

  @ApiProperty()
  packageName!: string;

  @ApiProperty()
  totalUsageCount!: number;

  @ApiProperty()
  totalUsageAmount!: number;
}

export class UtilizacionResponseDto {
  @ApiProperty({ example: '2026-04-01' })
  from!: string;

  @ApiProperty({ example: '2026-04-30' })
  to!: string;

  @ApiProperty({ example: 10 })
  topN!: number;

  @ApiProperty({ type: [UtilizacionRowDto], description: 'Top-N rows ordenados por usageAmount DESC' })
  rows!: UtilizacionRowDto[];

  @ApiProperty({ type: [UtilizacionPackageAggregateDto], description: 'Aggregate por paquete (sin LIMIT)' })
  byPackage!: UtilizacionPackageAggregateDto[];

  @ApiProperty()
  generatedAt!: string;
}

export interface UtilizacionRow {
  packageId: string;
  packageName: string;
  coverageId: string;
  coverageName: string;
  coverageType: string;
  usageCount: number;
  usageAmount: number;
}

export interface UtilizacionData {
  from: string;
  to: string;
  topN: number;
  rows: UtilizacionRow[];
  byPackage: Array<{ packageId: string; packageName: string; totalUsageCount: number; totalUsageAmount: number }>;
  generatedAt: string;
}
