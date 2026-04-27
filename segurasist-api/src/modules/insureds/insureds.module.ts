import { Module } from '@nestjs/common';
import { ExportRateLimitGuard } from './export-rate-limit.guard';
import { ExportsController } from './exports.controller';
import { InsuredsController } from './insureds.controller';
import { InsuredsService } from './insureds.service';

/**
 * `InsuredsModule` agrupa el CRUD + búsqueda + export del recurso `insureds`
 * y el endpoint `GET /v1/exports/:id` (porque hoy sólo hay un kind de export).
 *
 * `S3Service`/`SqsService` vienen del `AwsModule` global; `AuditWriterService`
 * del `AuditPersistenceModule` global. `InsuredsService` los inyecta como
 * `@Optional()` para que los unit tests del servicio puedan instanciarlo
 * sin pasar todas esas dependencias.
 */
@Module({
  controllers: [InsuredsController, ExportsController],
  providers: [InsuredsService, ExportRateLimitGuard],
  exports: [InsuredsService],
})
export class InsuredsModule {}
