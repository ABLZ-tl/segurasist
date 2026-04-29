import { CurrentUser, type AuthUser } from '@common/decorators/current-user.decorator';
import { Roles } from '@common/decorators/roles.decorator';
import { Tenant, TenantCtx } from '@common/decorators/tenant.decorator';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { RolesGuard } from '@common/guards/roles.guard';
import { Throttle } from '@common/throttler/throttler.decorators';
import { Controller, Get, UseGuards } from '@nestjs/common';
import { BrandingService } from './branding.service';
import type { BrandingResponseDto } from './dto/branding.dto';

/**
 * Sprint 5 — MT-1. Endpoint de lectura del branding para el portal del
 * asegurado y para los admins consultando el branding "vivo" del tenant.
 *
 * RLS: el `tenantId` viene EXCLUSIVAMENTE de `req.tenant` (poblado por el
 * `JwtAuthGuard` desde `custom:tenant_id`). NO aceptamos query/path para
 * que un insured no pueda leer el branding de otro tenant. Para superadmin
 * (cross-tenant), usar `GET /v1/admin/tenants/:id/branding`.
 *
 * Throttle 60/60s — endpoint frecuentemente llamado en page reload del
 * portal (header con logo dinámico). Cache cliente 5min via SWR + cache
 * server 5min in-memory ⇒ p95 de DB queries ≈ 1/5min/tenant.
 */
@Controller({ path: 'tenants/me', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
// Sólo roles con `req.tenant` poblado por el JwtAuthGuard. El superadmin
// `admin_segurasist` no tiene tenant fijo y debe usar el endpoint admin
// `GET /v1/admin/tenants/:id/branding` con el id explícito.
@Roles('insured', 'admin_mac', 'operator', 'supervisor')
export class BrandingController {
  constructor(private readonly branding: BrandingService) {}

  @Get('branding')
  @Throttle({ ttl: 60_000, limit: 60 })
  async getMyBranding(
    @Tenant() tenant: TenantCtx,
    @CurrentUser() user: AuthUser,
  ): Promise<BrandingResponseDto> {
    // Defensa en profundidad: el superadmin (`platformAdmin=true`) llega
    // típicamente sin `req.tenant` (cross-tenant). Si así fuera, el
    // decorador `@Tenant()` ya lanzó. Igual el flow legítimo del
    // superadmin es vía el endpoint admin con :id explícito; este endpoint
    // queda para admins de tenant + insureds + operadores (que SÍ tienen
    // tenant en su JWT). El `_user` no se usa por ahora pero se inyecta
    // para futuro (logging actor en Sprint 6 si se requiere por compliance).
    void user;
    return this.branding.getBrandingForTenant(tenant.id);
  }
}
