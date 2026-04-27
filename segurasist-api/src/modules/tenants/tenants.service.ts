import { PrismaBypassRlsService } from '@common/prisma/prisma-bypass-rls.service';
import { Injectable, NotImplementedException } from '@nestjs/common';

@Injectable()
export class TenantsService {
  constructor(private readonly prismaBypass: PrismaBypassRlsService) {}

  /**
   * Lista todos los tenants. Path superadmin: usa `PrismaBypassRlsService`
   * (rol DB BYPASSRLS) — la tabla `tenants` no tiene políticas RLS por
   * tenant_id (es el catálogo), pero igual usamos el rol BYPASSRLS para que
   * los siguientes joins/lookups cross-tenant que esta query habilite no
   * requieran setear `app.current_tenant`.
   */
  list() {
    return this.prismaBypass.client.tenant.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * S3-08 — Lista de tenants activos para popular el dropdown del switcher
   * en `apps/admin`. Sólo devuelve `id`, `name`, `slug` (no exponemos status
   * fields ni metadata pesada — la UI sólo necesita opciones del select).
   *
   * `status === 'active'` es el filtro: excluye tenants suspendidos /
   * archivados (que no deberían ser impersonables vía override aunque el
   * superadmin los conozca por slug).
   */
  listActive() {
    return this.prismaBypass.client.tenant.findMany({
      where: { deletedAt: null, status: 'active' },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, slug: true },
    });
  }

  create(): never {
    throw new NotImplementedException('TenantsService.create');
  }
  update(): never {
    throw new NotImplementedException('TenantsService.update');
  }
  remove(): never {
    throw new NotImplementedException('TenantsService.remove');
  }
}
