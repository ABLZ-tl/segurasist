import { Module } from '@nestjs/common';
import { BatchesController } from './batches.controller';
import { BatchesService } from './batches.service';
import { LayoutsService } from './layouts.service';

@Module({
  controllers: [BatchesController],
  providers: [BatchesService, LayoutsService],
  exports: [BatchesService, LayoutsService],
})
export class BatchesModule {}
