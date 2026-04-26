import { Module } from '@nestjs/common';
import { BatchesController } from './batches.controller';
import { BatchesService } from './batches.service';
import { LayoutsService } from './layouts.service';
import { BatchesParserService } from './parser/batches-parser.service';
import { BatchesValidatorService } from './validator/batches-validator.service';

@Module({
  controllers: [BatchesController],
  providers: [BatchesService, LayoutsService, BatchesParserService, BatchesValidatorService],
  exports: [BatchesService, LayoutsService, BatchesParserService, BatchesValidatorService],
})
export class BatchesModule {}
