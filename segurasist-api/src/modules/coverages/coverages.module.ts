import { Module } from '@nestjs/common';
import { CoveragesController } from './coverages.controller';
import { CoveragesService } from './coverages.service';

@Module({
  controllers: [CoveragesController],
  providers: [CoveragesService],
  exports: [CoveragesService],
})
export class CoveragesModule {}
