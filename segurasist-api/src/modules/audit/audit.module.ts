import { Module } from '@nestjs/common';
import { AuditTimelineController } from './audit-timeline.controller';
import { AuditTimelineService } from './audit-timeline.service';
import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';

@Module({
  controllers: [AuditController, AuditTimelineController],
  providers: [AuditService, AuditTimelineService],
  exports: [AuditService, AuditTimelineService],
})
export class AuditModule {}
