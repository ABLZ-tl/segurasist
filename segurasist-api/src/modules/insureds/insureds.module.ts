import { Module } from '@nestjs/common';
import { InsuredsController } from './insureds.controller';
import { InsuredsService } from './insureds.service';

@Module({
  controllers: [InsuredsController],
  providers: [InsuredsService],
  exports: [InsuredsService],
})
export class InsuredsModule {}
