import { CurrentUser, type AuthUser } from '@common/decorators/current-user.decorator';
import { Roles } from '@common/decorators/roles.decorator';
import { assertPlatformAdmin } from '@common/guards/assert-platform-admin';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { RolesGuard } from '@common/guards/roles.guard';
import { ZodValidationPipe } from '@common/pipes/zod-validation.pipe';
import {
  Body,
  Controller,
  Delete,
  Get,
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
  CreateUserSchema,
  ListUsersQuerySchema,
  UpdateUserSchema,
  type CreateUserDto,
  type ListUsersQuery,
  type UpdateUserDto,
} from './dto/user.dto';
import { UsersService, type UserCallerCtx } from './users.service';

type ReqWithCtx = FastifyRequest & {
  user?: AuthUser & { platformAdmin?: boolean };
  tenant?: { id: string };
  bypassRls?: boolean;
};

@Controller({ path: 'users', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin_mac', 'admin_segurasist')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  list(
    @Query(new ZodValidationPipe(ListUsersQuerySchema)) q: ListUsersQuery,
    @Req() req: ReqWithCtx,
    @CurrentUser() user: AuthUser & { platformAdmin?: boolean },
  ) {
    return this.users.list(q, this.toCtx(req, user));
  }

  @Post()
  create(
    @Body(new ZodValidationPipe(CreateUserSchema)) dto: CreateUserDto,
    @Req() req: ReqWithCtx,
    @CurrentUser() user: AuthUser & { platformAdmin?: boolean },
  ) {
    return this.users.create(dto, this.toCtx(req, user));
  }

  @Patch(':id')
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(UpdateUserSchema)) dto: UpdateUserDto,
    @Req() req: ReqWithCtx,
    @CurrentUser() user: AuthUser & { platformAdmin?: boolean },
  ) {
    return this.users.update(id, dto, this.toCtx(req, user));
  }

  @Delete(':id')
  disable(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: ReqWithCtx,
    @CurrentUser() user: AuthUser & { platformAdmin?: boolean },
  ) {
    return this.users.softDelete(id, this.toCtx(req, user));
  }

  /**
   * Resuelve el ctx caller. Hasta que el otro agente exponga
   * `req.user.platformAdmin`, caemos al rol explícito + `req.bypassRls` que el
   * `JwtAuthGuard` ya setea para superadmin.
   *
   * H-14 — si el ctx termina con `platformAdmin=true` (y por ende el service
   * usará `PrismaBypassRlsService`), validamos el role del actor en runtime
   * con `assertPlatformAdmin`. Defense-in-depth: aunque el RolesGuard del
   * decorator ya filtra, esto blindar contra:
   *   1. Tests que mockean `req.bypassRls=true` con role `admin_mac`.
   *   2. Regresión futura del decorator `@Roles(...)`.
   *   3. Bug en JwtAuthGuard que setee bypassRls sin validar role.
   */
  private toCtx(req: ReqWithCtx, user: AuthUser & { platformAdmin?: boolean }): UserCallerCtx {
    const platformAdmin =
      user.platformAdmin === true || (user.role === 'admin_segurasist' && req.bypassRls === true);
    if (platformAdmin) {
      assertPlatformAdmin(user);
    }
    return {
      platformAdmin,
      tenantId: req.tenant?.id,
      callerCognitoSub: user.cognitoSub,
    };
  }
}
