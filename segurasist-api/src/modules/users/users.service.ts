/**
 * UsersService — CRUD admin de la tabla `users` (Sprint 2 cierre de stubs).
 *
 * Notas:
 *  - admin_mac queda scoped a su tenant vía RLS automática (PrismaService
 *    request-scoped fija `app.current_tenant`).
 *  - admin_segurasist (platformAdmin) lee/escribe cross-tenant via
 *    `PrismaBypassRlsService` (rol DB BYPASSRLS). El controller hace el
 *    routing por flag `req.user.platformAdmin`. Mientras el flag no exista
 *    aún (otro agente lo expone en M2 fix), el fallback `role === 'admin_segurasist'`
 *    lo cubre — pero el JwtAuthGuard ya marca `req.bypassRls=true` y NO setea
 *    tenant para superadmin, por lo que el PrismaService normal devolvería
 *    listas vacías. De ahí que el service use el cliente bypass cuando
 *    `platformAdmin` está activo.
 *  - NO sincroniza con Cognito: la creación inserta `cognitoSub: pending-<uuid>`
 *    como placeholder. La sincronización real (SAML/SCIM) queda como TODO
 *    Sprint 5.
 *  - Soft delete preservando audit trail: `status = 'disabled'`, no DELETE
 *    físico. Self-delete bloqueado.
 */
import { randomUUID } from 'node:crypto';
import { PrismaBypassRlsService } from '@common/prisma/prisma-bypass-rls.service';
import { PrismaService } from '@common/prisma/prisma.service';
import {
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, PrismaClient, UserRole, UserStatus } from '@prisma/client';
import { decodeCursor, encodeCursor } from './cursor';
import { CreateUserDto, ListUsersQuery, UpdateUserDto } from './dto/user.dto';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

export interface UserSummary {
  id: string;
  email: string;
  fullName: string;
  role: string;
  status: string;
  mfaEnrolled: boolean;
  lastLoginAt: Date | null;
  tenantId: string | null;
  createdAt: Date;
}

export interface UserListResult {
  items: UserSummary[];
  nextCursor: string | null;
}

export interface UserCallerCtx {
  /** Si true, el caller bypassa RLS (admin_segurasist). */
  platformAdmin: boolean;
  /** Tenant del caller (definido para todos los roles excepto superadmin). */
  tenantId?: string;
  /** Cognito sub del caller — el `req.user.id` es el sub, no el `users.id` UUID. */
  callerCognitoSub: string;
}

type AnyPrismaClient = PrismaClient | PrismaService['client'];

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly prismaBypass: PrismaBypassRlsService,
  ) {}

  async list(query: ListUsersQuery, ctx: UserCallerCtx): Promise<UserListResult> {
    const limit = Math.min(query.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
    const where: Prisma.UserWhereInput = { deletedAt: null };

    if (query.role) where.role = query.role as UserRole;
    if (query.status) where.status = query.status as UserStatus;

    if (query.q) {
      const term = query.q.trim();
      where.OR = [
        { email: { contains: term, mode: 'insensitive' } },
        { fullName: { contains: term, mode: 'insensitive' } },
      ];
    }

    // Tenant scoping: superadmin puede pasar `tenantId` opcional para limitar
    // a un tenant; el resto de roles está implícitamente scoped por RLS.
    if (ctx.platformAdmin && query.tenantId) {
      where.tenantId = query.tenantId;
    }

    if (query.cursor) {
      const decoded = decodeCursor(query.cursor);
      if (decoded) {
        where.AND = [
          ...(Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []),
          {
            OR: [
              { createdAt: { lt: new Date(decoded.createdAt) } },
              {
                AND: [{ createdAt: new Date(decoded.createdAt) }, { id: { lt: decoded.id } }],
              },
            ],
          },
        ];
      }
    }

    const client = this.pickClient(ctx);
    const rows = await client.user.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });

    const sliced = rows.slice(0, limit);
    const items = sliced.map(toSummary);
    const hasMore = rows.length > limit;
    const last = sliced[sliced.length - 1];
    const nextCursor =
      hasMore && last ? encodeCursor({ id: last.id, createdAt: last.createdAt.toISOString() }) : null;

    return { items, nextCursor };
  }

  async create(dto: CreateUserDto, ctx: UserCallerCtx): Promise<UserSummary> {
    // Resolución de tenantId destino:
    //  - admin_mac: del JWT (ctx.tenantId). El body.tenantId se ignora.
    //  - admin_segurasist: el body.tenantId es required (debe poder crear users
    //    en otros tenants). Si no se pasa, lanzamos 422.
    let targetTenantId: string;
    if (ctx.platformAdmin) {
      if (!dto.tenantId) {
        throw new HttpException(
          { message: 'tenantId requerido para superadmin', code: 'VALIDATION_ERROR' },
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
      targetTenantId = dto.tenantId;
    } else {
      if (!ctx.tenantId) throw new ForbiddenException('Tenant context missing');
      targetTenantId = ctx.tenantId;
    }

    // Defensa redundante: el enum del DTO ya bloquea 'admin_segurasist' aquí,
    // pero la dejo por si alguien añade el rol al enum en el futuro sin
    // revisar este branch.
    if (dto.role === ('admin_segurasist' as UserRole)) {
      throw new ForbiddenException('No se puede crear admin_segurasist por API');
    }

    const data: Prisma.UserCreateInput = {
      tenant: { connect: { id: targetTenantId } },
      cognitoSub: `pending-${randomUUID()}`,
      email: dto.email.toLowerCase(),
      fullName: dto.fullName,
      role: dto.role as UserRole,
      mfaEnrolled: false,
      status: UserStatus.invited,
    };

    try {
      const client = this.pickClient(ctx);
      let row;
      if (ctx.platformAdmin) {
        // Bypass: insertamos directamente con el cliente BYPASSRLS.
        row = await client.user.create({ data });
      } else {
        // RLS: necesitamos withTenant para que el INSERT pase la policy.
        row = await this.prisma.withTenant((tx) => tx.user.create({ data }));
      }
      return toSummary(row);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException({
          message: 'Email ya existe en este tenant',
          code: 'USER_EMAIL_EXISTS',
        });
      }
      throw e;
    }
  }

  async update(id: string, dto: UpdateUserDto, ctx: UserCallerCtx): Promise<UserSummary> {
    const existing = await this.findById(id, ctx);
    if (!existing) throw new NotFoundException('User not found');

    // admin_mac no puede promover/cambiar a admin_segurasist (el enum del DTO
    // ya lo bloquea, pero lo defendemos en el service también).
    if (!ctx.platformAdmin && dto.role && dto.role === ('admin_segurasist' as UserRole)) {
      throw new ForbiddenException('No se puede promover a admin_segurasist');
    }

    const data: Prisma.UserUpdateInput = {};
    if (dto.fullName !== undefined) data.fullName = dto.fullName;
    if (dto.role !== undefined) data.role = dto.role as UserRole;
    if (dto.status !== undefined) data.status = dto.status as UserStatus;
    if (dto.mfaEnrolled !== undefined) data.mfaEnrolled = dto.mfaEnrolled;

    let row;
    if (ctx.platformAdmin) {
      row = await this.prismaBypass.client.user.update({ where: { id }, data });
    } else {
      row = await this.prisma.withTenant((tx) => tx.user.update({ where: { id }, data }));
    }
    return toSummary(row);
  }

  async softDelete(id: string, ctx: UserCallerCtx): Promise<UserSummary> {
    const existing = await this.findById(id, ctx);
    if (!existing) throw new NotFoundException('User not found');
    // Self-delete: comparamos por cognitoSub porque `req.user.id` es el sub del
    // JWT, no el UUID de la fila. Esto cubre el caso de un admin_mac que
    // intenta DELETE su propia fila.
    if (existing.cognitoSub === ctx.callerCognitoSub) {
      throw new HttpException(
        { message: 'No puedes deshabilitarte a ti mismo', code: 'USER_CANNOT_DELETE_SELF' },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    let row;
    if (ctx.platformAdmin) {
      row = await this.prismaBypass.client.user.update({
        where: { id },
        data: { status: UserStatus.disabled },
      });
    } else {
      row = await this.prisma.withTenant((tx) =>
        tx.user.update({ where: { id }, data: { status: UserStatus.disabled } }),
      );
    }
    return toSummary(row);
  }

  private async findById(id: string, ctx: UserCallerCtx) {
    const client = this.pickClient(ctx);
    return client.user.findFirst({ where: { id, deletedAt: null } });
  }

  private pickClient(ctx: UserCallerCtx): AnyPrismaClient {
    return ctx.platformAdmin ? this.prismaBypass.client : this.prisma.client;
  }
}

function toSummary(row: {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  status: UserStatus;
  mfaEnrolled: boolean;
  lastLoginAt: Date | null;
  tenantId: string | null;
  createdAt: Date;
}): UserSummary {
  return {
    id: row.id,
    email: row.email,
    fullName: row.fullName,
    role: row.role,
    status: row.status,
    mfaEnrolled: row.mfaEnrolled,
    lastLoginAt: row.lastLoginAt,
    tenantId: row.tenantId,
    createdAt: row.createdAt,
  };
}
