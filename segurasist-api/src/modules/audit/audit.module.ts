import { Module } from '@nestjs/common';
import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';
import { AuditTimelineController } from './audit-timeline.controller';
import { AuditTimelineService } from './audit-timeline.service';

@Module({
  controllers: [AuditController, AuditTimelineController],
  providers: [AuditService, AuditTimelineService],
  exports: [AuditService, AuditTimelineService],
})
export class AuditModule {}
