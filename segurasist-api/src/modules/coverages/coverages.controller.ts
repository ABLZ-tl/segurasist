import { Roles } from '@common/decorators/roles.decorator';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { RolesGuard } from '@common/guards/roles.guard';
import { Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { CoveragesService } from './coverages.service';

@Controller({ path: 'coverages', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
export class CoveragesController {
  constructor(private readonly coverages: CoveragesService) {}

  @Get()
  @Roles('admin_segurasist', 'admin_mac', 'operator', 'supervisor')
  list() {
    return this.coverages.list();
  }

  @Post()
  @Roles('admin_segurasist')
  create() {
    return this.coverages.create();
  }

  @Patch(':id')
  @Roles('admin_segurasist')
  update(@Param('id', new ParseUUIDPipe()) _id: string) {
    return this.coverages.update();
  }

  @Delete(':id')
  @Roles('admin_segurasist')
  remove(@Param('id', new ParseUUIDPipe()) _id: string) {
    return this.coverages.remove();
  }
}
