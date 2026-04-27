import { CurrentUser, type AuthUser } from '@common/decorators/current-user.decorator';
import { Roles } from '@common/decorators/roles.decorator';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { RolesGuard } from '@common/guards/roles.guard';
import { ZodValidationPipe } from '@common/pipes/zod-validation.pipe';
import { Throttle } from '@common/throttler/throttler.decorators';
import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { ClaimsService } from './claims.service';
import { CreateClaimSelfSchema, type CreateClaimSelfDto } from './dto/claim.dto';

@Controller({ path: 'claims', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
export class ClaimsController {
  constructor(private readonly claims: ClaimsService) {}

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
   */
  @Post()
  @Roles('insured')
  @Throttle({ ttl: 3_600_000, limit: 3 })
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(CreateClaimSelfSchema)) dto: CreateClaimSelfDto,
  ) {
    return this.claims.createForSelf(user, dto);
  }

  @Patch(':id')
  @Roles('admin_segurasist', 'admin_mac', 'operator')
  update(@Param('id', new ParseUUIDPipe()) _id: string) {
    return this.claims.update();
  }
}
