import { Global, Module } from '@nestjs/common';
import { AuditChainVerifierService } from './audit-chain-verifier.service';
import { AuditContextFactory } from './audit-context.factory';
import { AuditS3MirrorService } from './audit-s3-mirror.service';
import { AuditWriterService } from './audit-writer.service';

/**
 * Módulo dedicado al escritor de audit + mirror inmutable a S3.
 *
 * Responsabilidades:
 *
 *  - `AuditWriterService` — fire-and-forget INSERT en `audit_log` con hash chain.
 *  - `AuditS3MirrorService` (Sprint 2 S2-07) — worker que cada 60s lee filas
 *    pendientes y las espeja como NDJSON al bucket S3 con Object Lock
 *    COMPLIANCE 730d. NO bloquea el flujo de writes.
 *  - `AuditChainVerifierService` (Sprint 2 S2-07) — verifica el chain en DB,
 *    en S3, o cross-source para detectar tampering en el lado mutable.
 *
 * Por qué vive separado del `AuditModule` (que sirve la API GET /v1/audit/log
 * de lectura):
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
  providers: [AuditWriterService, AuditS3MirrorService, AuditChainVerifierService, AuditContextFactory],
  exports: [AuditWriterService, AuditS3MirrorService, AuditChainVerifierService, AuditContextFactory],
})
export class AuditPersistenceModule {}
