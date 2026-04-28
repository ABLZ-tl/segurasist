/**
 * S4-02 — Volumetría con gráficos (trend 90 días).
 *
 * Devuelve un array `points` con el desglose diario de:
 *   - altas (insureds.createdAt)
 *   - bajas (insureds.status=cancelled, updatedAt)
 *   - certificates emitidos
 *   - claims reportados
 *
 * El render de los gráficos vive en el FE (S4-02 frontend, owner S2).
 * Este endpoint sólo entrega datos JSON para que la página los grafique
 * con shadcn-charts/recharts.
 *
 * Performance: render <3s (criterio DoD). El service hace 4 GROUP BY
 * separados y rellena los buckets vacíos antes de devolver.
 */
import { ApiProperty } from '@nestjs/swagger';
import { z } from 'zod';

export const VolumetriaQuerySchema = z.object({
  /** Rango (días). Min 7, max 365. Default 90. */
  days: z.coerce.number().int().min(7).max(365).default(90),
  tenantId: z.string().uuid().optional(),
});

export type VolumetriaQuery = z.infer<typeof VolumetriaQuerySchema>;

export class VolumetriaPointDto {
  @ApiProperty({ example: '2026-04-27' })
  date!: string;

  @ApiProperty({ example: 12 })
  altas!: number;

  @ApiProperty({ example: 3 })
  bajas!: number;

  @ApiProperty({ example: 11 })
  certificados!: number;

  @ApiProperty({ example: 2 })
  claims!: number;
}

export class VolumetriaResponseDto {
  @ApiProperty({ example: 90 })
  days!: number;

  @ApiProperty({ example: '2026-01-27' })
  from!: string;

  @ApiProperty({ example: '2026-04-27' })
  to!: string;

  @ApiProperty({ type: [VolumetriaPointDto] })
  points!: VolumetriaPointDto[];

  @ApiProperty({ example: '2026-04-27T12:00:00.000Z' })
  generatedAt!: string;
}

export interface VolumetriaData {
  days: number;
  from: string;
  to: string;
  points: Array<{ date: string; altas: number; bajas: number; certificados: number; claims: number }>;
  generatedAt: string;
}
