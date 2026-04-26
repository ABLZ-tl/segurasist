import {
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  Scope,
} from '@nestjs/common';
import { REQUEST } from '@nestjs/core';
import { Prisma, PrismaClient } from '@prisma/client';
import { FastifyRequest } from 'fastify';
import { TenantCtx } from '../decorators/tenant.decorator';

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

type TxClient = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

/**
 * Per-request Prisma client. Garantiza que TODA query a la BD lleve
 * `SET LOCAL app.current_tenant = '<uuid>'` antes del statement principal,
 * en la misma conexión, vía transacción interactiva. Esto activa las
 * políticas RLS de PostgreSQL.
 *
 * Por qué transacción: `SET LOCAL` (y `set_config(..., is_local=true)`) sólo
 * aplica dentro de la transacción actual. Si el SET y la query principal
 * caen en conexiones distintas del pool de Prisma, la variable se pierde y
 * RLS bloquea todo. Emparejamos SET + query en la misma transacción.
 *
 * Implementación: `$extends.query.$allOperations` intercepta cada operación
 * de modelo, abre una transacción y re-despacha la operación contra el
 * cliente `tx` después de fijar el tenant. Reusamos el `query` callback de
 * Prisma redirigiéndolo al modelo correspondiente del cliente de transacción.
 *
 * Endpoints públicos / health NO deben usar PrismaService (request-scoped y
 * sin tenant → ForbiddenException). Para tareas administrativas (BYPASSRLS)
 * inyectar `PrismaBypassRlsService` (rol DB `segurasist_admin`, BYPASSRLS).
 *
 * M2 — Branch superadmin:
 *   Si el JwtAuthGuard marcó `req.bypassRls = true` (rol admin_segurasist),
 *   este service IGUAL conserva el rol DB `segurasist_app` (NOBYPASSRLS):
 *   intentar leer con él sin tenant context devuelve 0 filas o falla por
 *   `assertTenant`. Esa es la defensa en profundidad — los services superadmin
 *   DEBEN inyectar `PrismaBypassRlsService` explícitamente.
 */
@Injectable({ scope: Scope.REQUEST })
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(PrismaService.name);
  private readonly req: FastifyRequest & { tenant?: TenantCtx; bypassRls?: boolean };
  private readonly root: PrismaClient;
  /** Cliente público con el wrapper RLS aplicado. Usar este en services. */
  public readonly client: ReturnType<PrismaService['buildExtended']>;

  constructor(@Inject(REQUEST) req: FastifyRequest & { tenant?: TenantCtx; bypassRls?: boolean }) {
    // NOTE — leemos `req.tenant` / `req.bypassRls` LAZY en cada query
    // (`getTenantId()` / `getBypassRls()`) en lugar de en el constructor.
    // Razón: NestJS+Fastify puede instanciar este provider request-scoped
    // ANTES de que el JwtAuthGuard pueble `req.tenant`, lo que dejaba
    // `tenantId` como `undefined` para todo el ciclo de vida del request
    // y rompía con "Tenant context missing" en endpoints que sí tenían
    // sesión válida (ver bug Sprint 2 día consolidación).
    this.req = req;
    this.root = new PrismaClient({ log: ['warn', 'error'] });
    this.client = this.buildExtended();
  }

  private getTenantId(): string | undefined {
    return this.req.tenant?.id;
  }

  private getBypassRls(): boolean {
    return this.req.bypassRls === true;
  }

  async onModuleInit(): Promise<void> {
    await this.root.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.root.$disconnect();
  }

  /**
   * Ejecuta una callback dentro de una transacción explícita con
   * `app.current_tenant` ya fijado. Útil para handlers que requieran agrupar
   * varias mutaciones bajo una sola transacción (atomicidad cruzada).
   *
   * Para superadmin (`bypassRls=true`): NO seteamos el tenant — el rol DB
   * BYPASSRLS hace que las policies se ignoren. Usar `withTenant` en path
   * superadmin SÓLO si las queries son inocuas (e.g. no asumen tenant).
   */
  async withTenant<T>(fn: (tx: TxClient) => Promise<T>): Promise<T> {
    if (this.getBypassRls()) {
      // Superadmin: sin SET, defensa en profundidad → en PrismaService normal
      // (rol segurasist_app NOBYPASSRLS) las queries devolverán 0 filas o
      // fallarán por `tenant_id::text = current_setting(...)`. Lanzamos antes:
      throw new ForbiddenException(
        'PrismaService.withTenant invocado en path superadmin: usar PrismaBypassRlsService',
      );
    }
    const tenantId = this.assertTenant();
    return this.root.$transaction(async (tx) => {
      await tx.$executeRaw(Prisma.sql`SELECT set_config('app.current_tenant', ${tenantId}, true)`);
      return fn(tx);
    });
  }

  private assertTenant(): string {
    const tenantId = this.getTenantId();
    if (!tenantId) throw new ForbiddenException('Tenant context missing');
    if (!UUID_RE.test(tenantId)) throw new ForbiddenException('Tenant id malformed');
    return tenantId;
  }

  private buildExtended() {
    // Bind explícito: el callback se invoca por Prisma sin contexto.
    const root = this.root;
    const log = this.log;
    // bypassRls + tenantId se evalúan LAZY en cada query (ver nota en
    // constructor sobre timing NestJS+Fastify request-scoped vs guards).
    const getBypassRls = (): boolean => this.getBypassRls();
    const assertTenant = (): string => this.assertTenant();
    return root.$extends({
      name: 'rls-tenant-context',
      query: {
        $allOperations({ args, query, model, operation }) {
          // Sin modelo (raw $executeRaw / $queryRaw) → quien lo invoque debe
          // usar `withTenant` o asumir contexto admin.
          if (!model) {
            return query(args);
          }
          // Superadmin: NO seteamos app.current_tenant. El rol DB
          // segurasist_app aplica RLS y devuelve 0 filas — eso es defensa en
          // profundidad: el código superadmin NUNCA debe leer con este client.
          // Si algún service lo hace por error, queda como un bug detectable
          // (lista vacía / 404) en lugar de una fuga cross-tenant.
          if (getBypassRls()) {
            log.warn(
              `PrismaService: query con bypassRls=true ignora tenant context (model=${model} op=${operation}); el cliente NOBYPASSRLS devolverá 0 filas. Usar PrismaBypassRlsService.`,
            );
            return query(args);
          }
          const tenantId = assertTenant();
          log.debug(`RLS model=${model} op=${operation} tenant=${tenantId.slice(0, 8)}`);

          return root.$transaction(async (tx) => {
            // 1) fijar variable de sesión SCOPED a la transacción.
            await tx.$executeRaw(Prisma.sql`SELECT set_config('app.current_tenant', ${tenantId}, true)`);
            // 2) re-despachar la operación contra `tx` para que comparta
            //    conexión con el SET. `query(args)` ejecuta contra el root
            //    client, así que NO lo usamos aquí: vamos directo al modelo
            //    del cliente de transacción.
            const txClient = tx as unknown as Record<
              string,
              Record<string, (a: unknown) => Promise<unknown>>
            >;
            const txModel = txClient[lowerFirst(model)];
            if (!txModel) {
              throw new Error(`PrismaService: modelo desconocido en tx: ${model}`);
            }
            const txOp = txModel[operation];
            if (typeof txOp !== 'function') {
              throw new Error(`PrismaService: operación desconocida ${model}.${operation}`);
            }
            return txOp.call(txModel, args);
          });
        },
      },
    });
  }
}

function lowerFirst(s: string): string {
  if (s.length === 0) return s;
  return s.charAt(0).toLowerCase() + s.slice(1);
}
