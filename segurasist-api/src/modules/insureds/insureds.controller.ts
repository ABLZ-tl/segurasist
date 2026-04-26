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
  UsePipes,
} from '@nestjs/common';
import {
  CreateInsuredSchema,
  ListInsuredsQuerySchema,
  UpdateInsuredSchema,
  type CreateInsuredDto,
  type ListInsuredsQuery,
  type UpdateInsuredDto,
} from './dto/insured.dto';
import { InsuredsService } from './insureds.service';

@Controller({ path: 'insureds', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
export class InsuredsController {
  constructor(private readonly insureds: InsuredsService) {}

  @Get()
  @Roles('admin_mac', 'operator', 'admin_segurasist', 'supervisor')
  list(
    @Query(new ZodValidationPipe(ListInsuredsQuerySchema)) q: ListInsuredsQuery,
    @Tenant() tenant: TenantCtx,
  ) {
    return this.insureds.list(q, tenant);
  }

  @Get(':id')
  @Roles('admin_mac', 'operator', 'admin_segurasist', 'supervisor')
  findOne(@Param('id', new ParseUUIDPipe()) id: string, @Tenant() tenant: TenantCtx) {
    return this.insureds.findOne(id, tenant);
  }

  @Post()
  @Roles('admin_mac', 'operator', 'admin_segurasist')
  @UsePipes(new ZodValidationPipe(CreateInsuredSchema))
  create(@Body() dto: CreateInsuredDto, @Tenant() tenant: TenantCtx) {
    return this.insureds.create(dto, tenant);
  }

  @Patch(':id')
  @Roles('admin_mac', 'operator', 'admin_segurasist')
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(UpdateInsuredSchema)) dto: UpdateInsuredDto,
    @Tenant() tenant: TenantCtx,
  ) {
    return this.insureds.update(id, dto, tenant);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles('admin_mac', 'admin_segurasist')
  remove(@Param('id', new ParseUUIDPipe()) id: string, @Tenant() tenant: TenantCtx): Promise<void> {
    return this.insureds.softDelete(id, tenant);
  }
}
