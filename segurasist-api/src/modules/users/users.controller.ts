import { Roles } from '@common/decorators/roles.decorator';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { RolesGuard } from '@common/guards/roles.guard';
import { Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { UsersService } from './users.service';

@Controller({ path: 'users', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin_mac', 'admin_segurasist')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  list() {
    return this.users.list();
  }

  @Post()
  create() {
    return this.users.create();
  }

  @Patch(':id')
  update(@Param('id', new ParseUUIDPipe()) _id: string) {
    return this.users.update();
  }

  @Delete(':id')
  disable(@Param('id', new ParseUUIDPipe()) _id: string) {
    return this.users.disable();
  }
}
