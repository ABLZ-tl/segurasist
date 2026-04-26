import { Roles } from '@common/decorators/roles.decorator';
import { Tenant, TenantCtx } from '@common/decorators/tenant.decorator';
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
  UseGuards,
} from '@nestjs/common';
import {
  CreatePackageSchema,
  ListPackagesQuerySchema,
  UpdatePackageSchema,
  type CreatePackageDto,
  type ListPackagesQuery,
  type UpdatePackageDto,
} from './dto/package.dto';
import { PackagesService } from './packages.service';

@Controller({ path: 'packages', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
export class PackagesController {
  constructor(private readonly packages: PackagesService) {}

  @Get()
  @Roles('admin_segurasist', 'admin_mac', 'operator', 'supervisor')
  list(
    @Query(new ZodValidationPipe(ListPackagesQuerySchema)) q: ListPackagesQuery,
    @Tenant() tenant: TenantCtx,
  ) {
    return this.packages.list(q, tenant);
  }

  @Get(':id')
  @Roles('admin_segurasist', 'admin_mac', 'operator', 'supervisor')
  findOne(@Param('id', new ParseUUIDPipe()) id: string, @Tenant() tenant: TenantCtx) {
    return this.packages.findOne(id, tenant);
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
