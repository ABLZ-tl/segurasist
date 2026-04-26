import { Roles } from '@common/decorators/roles.decorator';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { RolesGuard } from '@common/guards/roles.guard';
import { Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { PackagesService } from './packages.service';

@Controller({ path: 'packages', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
export class PackagesController {
  constructor(private readonly packages: PackagesService) {}

  @Get()
  @Roles('admin_segurasist', 'admin_mac', 'operator', 'supervisor')
  list() {
    return this.packages.list();
  }

  @Get(':id')
  @Roles('admin_segurasist', 'admin_mac', 'operator', 'supervisor')
  findOne(@Param('id', new ParseUUIDPipe()) _id: string) {
    return this.packages.findOne();
  }

  @Post()
  @Roles('admin_segurasist')
  create() {
    return this.packages.create();
  }

  @Patch(':id')
  @Roles('admin_segurasist')
  update(@Param('id', new ParseUUIDPipe()) _id: string) {
    return this.packages.update();
  }

  @Delete(':id')
  @Roles('admin_segurasist')
  remove(@Param('id', new ParseUUIDPipe()) _id: string) {
    return this.packages.remove();
  }
}
