/**
 * S2-02 — PackagesService: CRUD + archive.
 *
 * Reglas:
 *  - Tenant aislado por RLS (PrismaService request-scoped, fija
 *    `app.current_tenant`).
 *  - `create`/`update` aceptan `coverages[]` embebidas; el upsert atómico
 *    delega en `CoveragesService.upsertForPackage` (transacción shared).
 *  - `archive` NO permite si hay insureds activos referenciando el package
 *    (defensa: dejaríamos memberships huérfanas). Devuelve 409 con
 *    `INSURED_DUPLICATED` (reutilizamos código existente — el frontend lo
 *    interpreta como "tiene dependientes activos").
 *  - DELETE físico nunca: el endpoint Delete del controller hace archive.
 *  - Eventos `package.{created,updated,archived}`: por ahora se loguean por
 *    pino con marker `event:` y se persisten en `audit_log` vía
 *    `AuditInterceptor` (HTTP method-driven). Cuando EventBridge esté wired
 *    (Sprint 5), un `EventPublisher` dedicado tomará estos shapes.
 */
import { TenantCtx } from '@common/decorators/tenant.decorator';
import { PrismaService } from '@common/prisma/prisma.service';
import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  PACKAGE_ARCHIVED_KIND,
  PACKAGE_CREATED_KIND,
  PACKAGE_UPDATED_KIND,
  type PackageEvent,
} from '../../events/package-events';
import { CoveragesService } from '../coverages/coverages.service';
import { decodeDescription } from '../coverages/dto/coverage-storage';
import { CreatePackageDto, ListPackagesQuery, UpdatePackageDto } from './dto/package.dto';

const DEFAULT_LIMIT = 50;

export interface PackageListItem {
  id: string;
  name: string;
  description: string | null;
  status: 'active' | 'archived';
  coveragesCount: number;
  insuredsActive: number;
  createdAt: string;
  updatedAt: string;
}

export interface PackageDetail extends PackageListItem {
  coverages: Array<{
    id: string;
    name: string;
    type: 'count' | 'amount';
    limitCount: number | null;
    limitAmount: number | null;
    unit: string;
    description: string | null;
  }>;
}

export interface PackageListResult {
  items: PackageListItem[];
  nextCursor: string | null;
}

@Injectable()
export class PackagesService {
  private readonly log = new Logger(PackagesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly coverages: CoveragesService,
  ) {}

  async list(query: ListPackagesQuery, _tenant: TenantCtx): Promise<PackageListResult> {
    const limit = query.limit ?? DEFAULT_LIMIT;
    const where: Prisma.PackageWhereInput = { deletedAt: null };
    if (query.status) {
      where.status = query.status;
    } else if (typeof query.active === 'boolean') {
      where.status = query.active ? 'active' : 'archived';
    }
    if (query.q) {
      where.name = { contains: query.q, mode: 'insensitive' };
    }
    if (query.cursor) {
      where.id = { lt: query.cursor };
    }

    const rows = await this.prisma.client.package.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      include: {
        coverages: { where: { deletedAt: null } },
        _count: {
          select: {
            insureds: { where: { status: 'active', deletedAt: null } },
          },
        },
      },
    });

    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit).map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      status: p.status,
      coveragesCount: p.coverages.length,
      insuredsActive: p._count.insureds,
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
    }));
    const nextCursor = hasMore ? (items[items.length - 1]?.id ?? null) : null;
    return { items, nextCursor };
  }

  async findOne(id: string, _tenant: TenantCtx): Promise<PackageDetail> {
    const row = await this.prisma.client.package.findFirst({
      where: { id, deletedAt: null },
      include: {
        coverages: { where: { deletedAt: null }, orderBy: { createdAt: 'asc' } },
        _count: {
          select: {
            insureds: { where: { status: 'active', deletedAt: null } },
          },
        },
      },
    });
    if (!row) throw new NotFoundException('Package not found');
    return mapDetail(row);
  }

  async create(dto: CreatePackageDto, tenant: TenantCtx): Promise<PackageDetail> {
    try {
      const created = await this.prisma.withTenant(async (tx) => {
        const pkg = await tx.package.create({
          data: {
            tenantId: tenant.id,
            name: dto.name,
            description: dto.description ?? null,
            status: dto.status ?? 'active',
          },
        });
        if (dto.coverages.length > 0) {
          await this.coverages.upsertForPackageWithTx(tx, tenant.id, pkg.id, dto.coverages);
        }
        return pkg;
      });
      this.emit({
        kind: PACKAGE_CREATED_KIND,
        tenantId: tenant.id,
        packageId: created.id,
        name: created.name,
        status: created.status,
        coveragesCount: dto.coverages.length,
        occurredAt: new Date().toISOString(),
      });
      return this.findOne(created.id, tenant);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('Package name already exists in this tenant');
      }
      throw e;
    }
  }

  async update(id: string, dto: UpdatePackageDto, tenant: TenantCtx): Promise<PackageDetail> {
    const existing = await this.prisma.client.package.findFirst({
      where: { id, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Package not found');

    try {
      const data: Prisma.PackageUpdateInput = {};
      if (dto.name !== undefined) data.name = dto.name;
      if (dto.description !== undefined) data.description = dto.description ?? null;
      if (dto.status !== undefined) data.status = dto.status;

      await this.prisma.withTenant(async (tx) => {
        if (Object.keys(data).length > 0) {
          await tx.package.update({ where: { id }, data });
        }
        if (Array.isArray(dto.coverages)) {
          await this.coverages.upsertForPackageWithTx(tx, tenant.id, id, dto.coverages);
        }
      });

      this.emit({
        kind: PACKAGE_UPDATED_KIND,
        tenantId: tenant.id,
        packageId: id,
        diff: {
          name: dto.name,
          description: dto.description,
          status: dto.status,
          coveragesReplaced: Array.isArray(dto.coverages),
        },
        occurredAt: new Date().toISOString(),
      });
      return this.findOne(id, tenant);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('Package name already exists in this tenant');
      }
      throw e;
    }
  }

  async archive(id: string, tenant: TenantCtx): Promise<PackageDetail> {
    const existing = await this.prisma.client.package.findFirst({
      where: { id, deletedAt: null },
      include: {
        _count: {
          select: {
            insureds: { where: { status: 'active', deletedAt: null } },
          },
        },
      },
    });
    if (!existing) throw new NotFoundException('Package not found');
    if (existing._count.insureds > 0) {
      throw new ConflictException(
        `No se puede archivar: ${existing._count.insureds} asegurado(s) activo(s) referencian este paquete`,
      );
    }

    let coveragesArchived = 0;
    await this.prisma.withTenant(async (tx) => {
      const result = await tx.coverage.updateMany({
        where: { packageId: id, deletedAt: null },
        data: { deletedAt: new Date() },
      });
      coveragesArchived = result.count;
      await tx.package.update({
        where: { id },
        data: { status: 'archived' },
      });
    });

    this.emit({
      kind: PACKAGE_ARCHIVED_KIND,
      tenantId: tenant.id,
      packageId: id,
      coveragesArchived,
      occurredAt: new Date().toISOString(),
    });

    return this.findOne(id, tenant);
  }

  /**
   * Publica un evento de dominio. Por ahora simplemente loguea con marker
   * `event:` para que pino lo capture (CloudWatch → S3). En Sprint 5 se
   * cambia por un `EventPublisher` que escribe a EventBridge. El shape ya
   * es el final.
   */
  private emit(event: PackageEvent): void {
    this.log.log({ event: event.kind, payload: event }, `event:${event.kind}`);
  }
}

type PrismaPackageWithRelations = Prisma.PackageGetPayload<{
  include: {
    coverages: true;
    _count: { select: { insureds: true } };
  };
}>;

function mapDetail(row: PrismaPackageWithRelations): PackageDetail {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    status: row.status,
    coveragesCount: row.coverages.length,
    insuredsActive: row._count.insureds,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    coverages: row.coverages.map((c) => {
      const env = decodeDescription(c.description, c.type);
      return {
        id: c.id,
        name: c.name,
        type: env.kind,
        limitCount: c.limitCount,
        limitAmount: c.limitAmount === null ? null : Number(c.limitAmount),
        unit: env.unit,
        description: env.description,
      };
    }),
  };
}
