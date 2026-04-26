import { Global, Module } from '@nestjs/common';
import { AuditWriterService } from './audit-writer.service';

/**
 * Módulo dedicado al escritor de audit. Vive separado del `AuditModule`
 * (que sirve la API GET /v1/audit/log de lectura) porque:
 *
 *  1. Crea su propio PrismaClient con `DATABASE_URL_AUDIT` apuntando al rol
 *     `segurasist_admin` (BYPASSRLS). Eso evita conflicto con el
 *     PrismaService request-scoped del resto de la app.
 *
 *  2. Es `@Global()` para que el `AuditInterceptor` pueda inyectarlo desde
 *     el contexto del request sin pelear con el scope.
 *
 *  3. Cuando el otro agente paralelo termine M2 (rediseño del modelo de
 *     superadmin), este módulo puede consolidarse contra el mismo
 *     PrismaClient principal y eliminar la duplicación de conexión.
 */
@Global()
@Module({
  providers: [AuditWriterService],
  exports: [AuditWriterService],
})
export class AuditPersistenceModule {}
