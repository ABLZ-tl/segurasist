import { Module } from '@nestjs/common';
import { CoveragesController } from './coverages.controller';
import { CoveragesService } from './coverages.service';

@Module({
  controllers: [CoveragesController],
  providers: [CoveragesService],
})
export class CoveragesModule {}
