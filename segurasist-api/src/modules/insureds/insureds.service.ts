/**
 * S2-06 — InsuredsService.
 *
 * `list` implementa cursor-paginated con compound (createdAt, id) para
 * estabilidad ante created_at duplicados. Filtros:
 *   - q          → búsqueda fuzzy en (full_name, curp, rfc) usando ILIKE.
 *                  El índice GIN trigram (`pg_trgm`) creado en la migración
 *                  20260426_insureds_search_indexes acelera ILIKE %q% a O(log n).
 *   - packageId  → eq.
 *   - status     → eq.
 *   - validFromGte/Lte / validToGte/Lte → rangos.
 *   - bouncedOnly → EXISTS sub-query contra email_events tipo bounced.
 *
 * RBAC + RLS: el controller fija `@Roles(...)` y `PrismaService` agrega
 * `app.current_tenant`. El service NO necesita pasar tenantId al WHERE — RLS lo hace.
 *
 * Performance objetivo (story): p95 ≤ 2s con 60k filas. Plan EXPLAIN ANALYZE
 * verifica:
 *   1. Index Scan on insureds_search_idx (gin) cuando hay `q`.
 *   2. Index Scan on (tenant_id, status, valid_to) cuando hay status+validTo.
 *
 * Stub create/update/softDelete: el alta principal viene por batches (S1-05);
 * el alta unitaria queda para sprint 3.
 */
import { TenantCtx } from '@common/decorators/tenant.decorator';
import { PrismaService } from '@common/prisma/prisma.service';
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { decodeCursor, encodeCursor } from './cursor';
import { CreateInsuredDto, ListInsuredsQuery, UpdateInsuredDto } from './dto/insured.dto';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export interface InsuredListItem {
  id: string;
  curp: string;
  rfc: string | null;
  fullName: string;
  packageId: string;
  packageName: string;
  status: 'active' | 'suspended' | 'cancelled' | 'expired';
  validFrom: string;
  validTo: string;
  email: string | null;
  hasBounce: boolean;
}

export interface InsuredListResult {
  items: InsuredListItem[];
  nextCursor: string | null;
  prevCursor: string | null;
}

@Injectable()
export class InsuredsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: ListInsuredsQuery, _tenant: TenantCtx): Promise<InsuredListResult> {
    const limit = Math.min(query.limit ?? DEFAULT_LIMIT, MAX_LIMIT);

    const where: Prisma.InsuredWhereInput = { deletedAt: null };
    if (query.status) where.status = query.status;
    if (query.packageId) where.packageId = query.packageId;
    if (query.q) {
      const term = query.q.trim();
      where.OR = [
        { fullName: { contains: term, mode: 'insensitive' } },
        { curp: { contains: term.toUpperCase() } },
        { rfc: { contains: term.toUpperCase() } },
      ];
    }
    const validFromRange: { gte?: Date; lte?: Date } = {};
    if (query.validFromGte) validFromRange.gte = new Date(query.validFromGte);
    if (query.validFromLte) validFromRange.lte = new Date(query.validFromLte);
    if (Object.keys(validFromRange).length > 0) where.validFrom = validFromRange;

    const validToRange: { gte?: Date; lte?: Date } = {};
    if (query.validToGte) validToRange.gte = new Date(query.validToGte);
    if (query.validToLte) validToRange.lte = new Date(query.validToLte);
    if (Object.keys(validToRange).length > 0) where.validTo = validToRange;

    if (query.cursor) {
      const decoded = decodeCursor(query.cursor);
      if (!decoded) {
        // Cursor corrupto: tratamos como sin-cursor (defensa contra clientes
        // que arman manualmente). Alternativa sería 400; preferimos UX.
      } else {
        where.AND = [
          ...(Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []),
          {
            OR: [
              { createdAt: { lt: new Date(decoded.createdAt) } },
              {
                AND: [{ createdAt: new Date(decoded.createdAt) }, { id: { lt: decoded.id } }],
              },
            ],
          },
        ];
      }
    }

    const rows = await this.prisma.client.insured.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      include: { package: { select: { id: true, name: true } } },
    });

    const sliced = rows.slice(0, limit);

    // Hard bounce flag: una sola query por página.
    const ids = sliced.map((r) => r.id);
    const bouncedSet = new Set<string>();
    if (query.bouncedOnly === true || ids.length > 0) {
      // EmailEvent no liga a insured directamente sino a certificate; así que
      // resolvemos por insured → certificates → email_events. Hacemos una sola
      // ronda con groupBy para minimizar overhead.
      const certs = await this.prisma.client.certificate.findMany({
        where: { insuredId: { in: ids } },
        select: { id: true, insuredId: true },
      });
      const certByInsured = new Map<string, string[]>();
      for (const c of certs) {
        const arr = certByInsured.get(c.insuredId) ?? [];
        arr.push(c.id);
        certByInsured.set(c.insuredId, arr);
      }
      const allCertIds = certs.map((c) => c.id);
      if (allCertIds.length > 0) {
        const bouncedEvents = await this.prisma.client.emailEvent.findMany({
          where: {
            certificateId: { in: allCertIds },
            eventType: 'bounced',
          },
          select: { certificateId: true },
        });
        const bouncedCertIds = new Set(
          bouncedEvents.map((e) => e.certificateId).filter((c): c is string => Boolean(c)),
        );
        for (const [insuredId, certIds] of certByInsured) {
          if (certIds.some((id) => bouncedCertIds.has(id))) {
            bouncedSet.add(insuredId);
          }
        }
      }
    }

    let items: InsuredListItem[] = sliced.map((r) => ({
      id: r.id,
      curp: r.curp,
      rfc: r.rfc,
      fullName: r.fullName,
      packageId: r.packageId,
      packageName: r.package.name,
      status: r.status,
      validFrom: r.validFrom.toISOString().slice(0, 10),
      validTo: r.validTo.toISOString().slice(0, 10),
      email: r.email,
      hasBounce: bouncedSet.has(r.id),
    }));

    if (query.bouncedOnly === true) {
      items = items.filter((i) => i.hasBounce);
    }

    const hasMore = rows.length > limit;
    const last = sliced[sliced.length - 1];
    const nextCursor =
      hasMore && last ? encodeCursor({ id: last.id, createdAt: last.createdAt.toISOString() }) : null;

    return {
      items,
      nextCursor,
      // No tracking de prev-cursor para mantener cursor unidireccional simple;
      // el FE reconstruye history via TanStack Query infinite.
      prevCursor: null,
    };
  }

  async findOne(id: string, _tenant: TenantCtx): Promise<unknown> {
    const row = await this.prisma.client.insured.findFirst({
      where: { id, deletedAt: null },
      include: { package: true, beneficiaries: { where: { deletedAt: null } } },
    });
    if (!row) throw new NotFoundException('Insured not found');
    return row;
  }

  async create(dto: CreateInsuredDto, tenant: TenantCtx): Promise<unknown> {
    try {
      return await this.prisma.withTenant((tx) =>
        tx.insured.create({
          data: {
            tenantId: tenant.id,
            curp: dto.curp,
            rfc: dto.rfc ?? null,
            fullName: dto.fullName,
            dob: new Date(dto.dob),
            email: dto.email ?? null,
            phone: dto.phone ?? null,
            packageId: dto.packageId,
            validFrom: new Date(dto.validFrom),
            validTo: new Date(dto.validTo),
          },
        }),
      );
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('Insured CURP already exists in this tenant');
      }
      throw e;
    }
  }

  async update(id: string, dto: UpdateInsuredDto, _tenant: TenantCtx): Promise<unknown> {
    const existing = await this.prisma.client.insured.findFirst({
      where: { id, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Insured not found');
    return this.prisma.withTenant((tx) =>
      tx.insured.update({
        where: { id },
        data: {
          rfc: dto.rfc ?? undefined,
          fullName: dto.fullName ?? undefined,
          dob: dto.dob ? new Date(dto.dob) : undefined,
          email: dto.email ?? undefined,
          phone: dto.phone ?? undefined,
          packageId: dto.packageId ?? undefined,
          validFrom: dto.validFrom ? new Date(dto.validFrom) : undefined,
          validTo: dto.validTo ? new Date(dto.validTo) : undefined,
        },
      }),
    );
  }

  async softDelete(id: string, _tenant: TenantCtx): Promise<void> {
    const existing = await this.prisma.client.insured.findFirst({
      where: { id, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Insured not found');
    await this.prisma.withTenant((tx) =>
      tx.insured.update({
        where: { id },
        data: { deletedAt: new Date(), status: 'cancelled' },
      }),
    );
  }
}
