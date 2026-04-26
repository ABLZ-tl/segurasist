/**
 * S2-02 — CoveragesService.
 *
 * Provee:
 *  - `list(packageId)` — coverages activas de un package.
 *  - `upsertForPackage(packageId, coverages[])` — reemplaza atómicamente el
 *    set de coverages del package (delete soft + insert nuevas dentro de la
 *    misma transacción). Idempotente: misma entrada ⇒ mismo estado final.
 *  - `upsertForPackageWithTx(...)` — variante que reutiliza un `tx` ya
 *    abierto por `PrismaService.withTenant(...)` desde el caller (evita
 *    transacciones anidadas). Esta es la que usa PackagesService.create/update.
 *
 * Reglas:
 *  - `type=count` ⇒ `limitCount` requerido (lo valida Zod en el DTO; aquí
 *    asumimos input ya validado).
 *  - `type=amount` ⇒ `limitAmount` requerido.
 *  - El enum DB se mapea via `toDbType` (count→consultation, amount→pharmacy).
 *  - El user-facing kind/unit/description se guarda en `description` como
 *    JSON envelope (ver coverage-storage.ts).
 */
import { TenantCtx } from '@common/decorators/tenant.decorator';
import { PrismaService } from '@common/prisma/prisma.service';
import { Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma, PrismaClient } from '@prisma/client';
import { CoverageInputDto } from '../packages/dto/package.dto';
import { decodeDescription, encodeDescription, toDbType } from './dto/coverage-storage';

type TxClient = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

export interface CoverageView {
  id: string;
  packageId: string;
  name: string;
  type: 'count' | 'amount';
  limitCount: number | null;
  limitAmount: number | null;
  unit: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

@Injectable()
export class CoveragesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(packageId: string, _tenant: TenantCtx): Promise<CoverageView[]> {
    const rows = await this.prisma.client.coverage.findMany({
      where: { packageId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(toView);
  }

  async upsertForPackage(
    packageId: string,
    coverages: CoverageInputDto[],
    tenant: TenantCtx,
  ): Promise<CoverageView[]> {
    // Verifica que el package exista (evita upsertear contra packages
    // inexistentes — el FK lo atraparía pero aquí devolvemos 404 limpio).
    const pkg = await this.prisma.client.package.findFirst({
      where: { id: packageId, deletedAt: null },
    });
    if (!pkg) throw new NotFoundException('Package not found');

    return this.prisma.withTenant((tx) => this.upsertForPackageWithTx(tx, tenant.id, packageId, coverages));
  }

  /**
   * Variante invocable desde una transacción ya abierta por un caller
   * superior (e.g. PackagesService.create dentro de su `withTenant`). NO
   * abre una nueva tx — confía en que el caller ya fijó `app.current_tenant`.
   */
  async upsertForPackageWithTx(
    tx: TxClient,
    tenantId: string,
    packageId: string,
    coverages: CoverageInputDto[],
  ): Promise<CoverageView[]> {
    // Soft-delete del set actual.
    await tx.coverage.updateMany({
      where: { packageId, deletedAt: null },
      data: { deletedAt: new Date() },
    });

    if (coverages.length === 0) return [];

    // Insert nuevo set en bloque.
    const created = await Promise.all(
      coverages.map((c) =>
        tx.coverage.create({
          data: {
            tenantId,
            packageId,
            name: c.name,
            type: toDbType(c.type),
            limitCount: c.type === 'count' ? (c.limitCount ?? null) : null,
            limitAmount: c.type === 'amount' ? (c.limitAmount ?? null) : null,
            description: encodeDescription({
              kind: c.type,
              unit: c.unit,
              description: c.description ?? null,
            }),
          },
        }),
      ),
    );
    return created.map(toView);
  }
}

function toView(row: Prisma.CoverageGetPayload<true>): CoverageView {
  const env = decodeDescription(row.description, row.type);
  return {
    id: row.id,
    packageId: row.packageId,
    name: row.name,
    type: env.kind,
    limitCount: row.limitCount,
    limitAmount: row.limitAmount === null ? null : Number(row.limitAmount),
    unit: env.unit,
    description: env.description,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
