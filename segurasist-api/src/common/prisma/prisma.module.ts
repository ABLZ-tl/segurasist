import { Global, Module } from '@nestjs/common';
import { PrismaBypassRlsService } from './prisma-bypass-rls.service';
import { PrismaService } from './prisma.service';

@Global()
@Module({
  providers: [PrismaService, PrismaBypassRlsService],
  exports: [PrismaService, PrismaBypassRlsService],
})
export class PrismaModule {}
