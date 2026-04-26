import { PrismaBypassRlsService } from '@common/prisma/prisma-bypass-rls.service';
import { BatchesModule } from '@modules/batches/batches.module';
import { Module } from '@nestjs/common';
import { InsuredsCreationWorkerService } from './insureds-creation-worker.service';
import { LayoutWorkerService } from './layout-worker.service';

/**
 * Workers SQS para el sprint 2.
 *
 * NOTA: estos services hacen polling SQS desde `onModuleInit`. En entornos
 * test/e2e queremos que el módulo Nest levante sin que los pollers se inicien
 * (eso requiere LocalStack y crea ruido en logs). El gating se hace por la
 * env var `WORKERS_ENABLED=true`. Los services siguen siendo inyectables
 * — los tests pueden invocar `processBatch()` / `processMessage()`
 * directamente sin tocar SQS.
 */
@Module({
  imports: [BatchesModule],
  providers: [PrismaBypassRlsService, LayoutWorkerService, InsuredsCreationWorkerService],
  exports: [LayoutWorkerService, InsuredsCreationWorkerService],
})
export class WorkersModule {}
