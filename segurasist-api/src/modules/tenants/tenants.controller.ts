import { Roles } from '@common/decorators/roles.decorator';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { RolesGuard } from '@common/guards/roles.guard';
import { Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { TenantsService } from './tenants.service';

@Controller({ path: 'tenants', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin_segurasist')
export class TenantsController {
  constructor(private readonly tenants: TenantsService) {}

  @Get()
  list() {
    return this.tenants.list();
  }

  /**
   * S3-08 — Lista de tenants activos para popular el dropdown del Tenant
   * Switcher en `apps/admin`. Restringida a `admin_segurasist` (mismo RBAC
   * que el resto del controller). Devuelve `[{id, name, slug}]`.
   */
  @Get('active')
  listActive() {
    return this.tenants.listActive();
  }

  @Post()
  create() {
    return this.tenants.create();
  }

  @Patch(':id')
  update(@Param('id', new ParseUUIDPipe()) _id: string) {
    return this.tenants.update();
  }

  @Delete(':id')
  remove(@Param('id', new ParseUUIDPipe()) _id: string) {
    return this.tenants.remove();
  }
}
