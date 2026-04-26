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
 * crear un cliente con rol `segurasist_admin` aparte.
 */
@Injectable({ scope: Scope.REQUEST })
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(PrismaService.name);
  private readonly tenantId?: string;
  private readonly root: PrismaClient;
  /** Cliente público con el wrapper RLS aplicado. Usar este en services. */
  public readonly client: ReturnType<PrismaService['buildExtended']>;

  constructor(@Inject(REQUEST) req: FastifyRequest & { tenant?: TenantCtx }) {
    this.tenantId = req.tenant?.id;
    this.root = new PrismaClient({ log: ['warn', 'error'] });
    this.client = this.buildExtended();
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
   */
  async withTenant<T>(fn: (tx: TxClient) => Promise<T>): Promise<T> {
    const tenantId = this.assertTenant();
    return this.root.$transaction(async (tx) => {
      await tx.$executeRaw(Prisma.sql`SELECT set_config('app.current_tenant', ${tenantId}, true)`);
      return fn(tx);
    });
  }

  private assertTenant(): string {
    if (!this.tenantId) throw new ForbiddenException('Tenant context missing');
    if (!UUID_RE.test(this.tenantId)) throw new ForbiddenException('Tenant id malformed');
    return this.tenantId;
  }

  private buildExtended() {
    // Bind explícito: el callback se invoca por Prisma sin contexto.
    const root = this.root;
    const log = this.log;
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
