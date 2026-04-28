import type { AuthUser } from '@common/decorators/current-user.decorator';
import { Roles } from '@common/decorators/roles.decorator';
import { Tenant, TenantCtx } from '@common/decorators/tenant.decorator';
import { assertPlatformAdmin } from '@common/guards/assert-platform-admin';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { RolesGuard } from '@common/guards/roles.guard';
import { ZodValidationPipe } from '@common/pipes/zod-validation.pipe';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import {
  CreatePackageSchema,
  ListPackagesQuerySchema,
  UpdatePackageSchema,
  type CreatePackageDto,
  type ListPackagesQuery,
  type UpdatePackageDto,
} from './dto/package.dto';
import { PackagesService, type PackagesScope } from './packages.service';

@Controller({ path: 'packages', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
export class PackagesController {
  constructor(private readonly packages: PackagesService) {}

  private buildScope(
    req: FastifyRequest & { user?: AuthUser; tenant?: TenantCtx },
    queryTenantId: string | undefined,
  ): PackagesScope {
    const platformAdmin = req.user?.platformAdmin === true;
    if (platformAdmin) {
      // H-14 — runtime defense-in-depth para PrismaBypassRlsService.
      assertPlatformAdmin(req.user);
    }
    return {
      platformAdmin,
      tenantId: platformAdmin ? queryTenantId : req.tenant?.id,
      actorId: req.user?.id,
    };
  }

  @Get()
  @Roles('admin_segurasist', 'admin_mac', 'operator', 'supervisor')
  list(
    @Query(new ZodValidationPipe(ListPackagesQuerySchema)) q: ListPackagesQuery,
    @Req() req: FastifyRequest & { user?: AuthUser; tenant?: TenantCtx },
  ) {
    return this.packages.list(q, this.buildScope(req, q.tenantId));
  }

  @Get(':id')
  @Roles('admin_segurasist', 'admin_mac', 'operator', 'supervisor')
  findOne(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query() q: { tenantId?: string },
    @Req() req: FastifyRequest & { user?: AuthUser; tenant?: TenantCtx },
  ) {
    return this.packages.findOne(id, this.buildScope(req, q.tenantId));
  }

  @Post()
  @Roles('admin_segurasist')
  create(
    @Body(new ZodValidationPipe(CreatePackageSchema)) dto: CreatePackageDto,
    @Tenant() tenant: TenantCtx,
  ) {
    return this.packages.create(dto, tenant);
  }

  @Patch(':id')
  @Roles('admin_segurasist')
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(UpdatePackageSchema)) dto: UpdatePackageDto,
    @Tenant() tenant: TenantCtx,
  ) {
    return this.packages.update(id, dto, tenant);
  }

  // DELETE físico jamás. Esta acción hace soft-archive; mantenemos el verbo
  // DELETE para semántica REST estándar pero el efecto es status=archived.
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @Roles('admin_segurasist')
  archive(@Param('id', new ParseUUIDPipe()) id: string, @Tenant() tenant: TenantCtx) {
    return this.packages.archive(id, tenant);
  }
}
