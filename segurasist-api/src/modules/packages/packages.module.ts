import { Module } from '@nestjs/common';
import { CoveragesModule } from '../coverages/coverages.module';
import { PackagesController } from './packages.controller';
import { PackagesService } from './packages.service';

@Module({
  imports: [CoveragesModule],
  controllers: [PackagesController],
  providers: [PackagesService],
})
export class PackagesModule {}
