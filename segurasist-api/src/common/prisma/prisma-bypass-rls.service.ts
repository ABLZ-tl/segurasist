import { ENV_TOKEN } from '@config/config.module';
import { Env } from '@config/env.schema';
import {
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * Cliente Prisma cross-tenant para paths superadmin.
 *
 * Se conecta con `DATABASE_URL_BYPASS` (rol DB `segurasist_admin`, BYPASSRLS).
 * Sólo debe ser inyectado por services que ejecuten lógica del superadmin
 * (e.g. `TenantsService.list()`, listados administrativos cross-tenant).
 *
 * Reglas:
 *   1) NO es request-scoped: comparte una conexión a través de instancias.
 *   2) Cualquier consumidor DEBE verificar `req.user.role === 'admin_segurasist'`
 *      ANTES de llamar a métodos de este service. El control de acceso se hace
 *      arriba (RolesGuard) — este service no impone roles, solo expone el
 *      cliente Prisma.
 *   3) Si `DATABASE_URL_BYPASS` no está configurada (modo dev sin superadmin),
 *      el cliente lanza `NotImplementedException` al usarse.
 */
@Injectable()
export class PrismaBypassRlsService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(PrismaBypassRlsService.name);
  private readonly _client: PrismaClient | undefined;
  private readonly enabled: boolean;

  constructor(@Inject(ENV_TOKEN) env: Env) {
    if (env.DATABASE_URL_BYPASS) {
      this.enabled = true;
      this._client = new PrismaClient({
        log: ['warn', 'error'],
        datasources: { db: { url: env.DATABASE_URL_BYPASS } },
      });
    } else {
      this.enabled = false;
      this._client = undefined;
      this.log.warn(
        'DATABASE_URL_BYPASS ausente: PrismaBypassRlsService deshabilitado. ' +
          'Los paths superadmin (cross-tenant) lanzarán ForbiddenException.',
      );
    }
  }

  async onModuleInit(): Promise<void> {
    if (this._client) {
      await this._client.$connect();
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this._client) {
      await this._client.$disconnect();
    }
  }

  /**
   * Acceso al cliente Prisma. Lanza si el service está deshabilitado para
   * forzar una falla limpia en lugar de leer con el cliente NOBYPASSRLS sin
   * tenant context (que devuelve listas vacías y oculta el bug).
   */
  get client(): PrismaClient {
    if (!this._client) {
      throw new ForbiddenException('PrismaBypassRlsService no configurado: DATABASE_URL_BYPASS ausente');
    }
    return this._client;
  }

  isEnabled(): boolean {
    return this.enabled;
  }
}
