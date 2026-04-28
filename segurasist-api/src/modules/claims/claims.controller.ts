import { CurrentUser, type AuthUser } from '@common/decorators/current-user.decorator';
import { Roles } from '@common/decorators/roles.decorator';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { RolesGuard } from '@common/guards/roles.guard';
import { ZodValidationPipe } from '@common/pipes/zod-validation.pipe';
import { Throttle } from '@common/throttler/throttler.decorators';
import { AuditContextFactory } from '@modules/audit/audit-context.factory';
import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { ClaimsService } from './claims.service';
import { CreateClaimSelfSchema, type CreateClaimSelfDto } from './dto/claim.dto';

@Controller({ path: 'claims', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
export class ClaimsController {
  constructor(
    private readonly claims: ClaimsService,
    private readonly auditCtx: AuditContextFactory,
  ) {}

  @Get()
  @Roles('admin_segurasist', 'admin_mac', 'operator', 'supervisor', 'insured')
  list() {
    return this.claims.list();
  }

  /**
   * Portal asegurado — crear un claim "reported".
   *
   * Rate limit: 3 reportes/hora por user-IP. Anti spam manual sin
   * castigar al user que se equivoca un par de veces.
   *
   * RBAC: SOLO `insured`. Los flows admin (alta cross-insured) usan otros
   * paths (no implementados en MVP, ver `claims.service.create()` stub).
   *
   * H-24 — pasamos el `auditCtx` derivado del request al service para que
   * el evento de audit lleve `ip`, `userAgent` y `traceId`. Antes el service
   * persistía el row sin estos campos → audit row inválido para forensics
   * (el chain hash NO se rompía por ello pero el row queda inutilizable
   * para queries "claims reportados desde IP X" o correlación con CloudWatch).
   */
  @Post()
  @Roles('insured')
  @Throttle({ ttl: 3_600_000, limit: 3 })
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(CreateClaimSelfSchema)) dto: CreateClaimSelfDto,
  ) {
    return this.claims.createForSelf(user, dto, this.auditCtx.fromRequest());
  }

  @Patch(':id')
  @Roles('admin_segurasist', 'admin_mac', 'operator')
  update(@Param('id', new ParseUUIDPipe()) _id: string) {
    return this.claims.update();
  }
}
