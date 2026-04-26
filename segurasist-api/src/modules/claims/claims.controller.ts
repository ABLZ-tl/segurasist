import { Roles } from '@common/decorators/roles.decorator';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { RolesGuard } from '@common/guards/roles.guard';
import { Controller, Get, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { ClaimsService } from './claims.service';

@Controller({ path: 'claims', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
export class ClaimsController {
  constructor(private readonly claims: ClaimsService) {}

  @Get()
  @Roles('admin_segurasist', 'admin_mac', 'operator', 'supervisor', 'insured')
  list() {
    return this.claims.list();
  }

  @Post()
  @Roles('admin_segurasist', 'admin_mac', 'operator', 'insured')
  create() {
    return this.claims.create();
  }

  @Patch(':id')
  @Roles('admin_segurasist', 'admin_mac', 'operator')
  update(@Param('id', new ParseUUIDPipe()) _id: string) {
    return this.claims.update();
  }
}
