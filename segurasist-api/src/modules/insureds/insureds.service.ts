/* eslint-disable @typescript-eslint/require-await -- stubs Sprint 0; implementación en Sprint 2 */
import { TenantCtx } from '@common/decorators/tenant.decorator';
import { PrismaService } from '@common/prisma/prisma.service';
import { Injectable, NotImplementedException } from '@nestjs/common';
import { CreateInsuredDto, ListInsuredsQuery, UpdateInsuredDto } from './dto/insured.dto';

@Injectable()
export class InsuredsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(_query: ListInsuredsQuery, _tenant: TenantCtx): Promise<unknown> {
    throw new NotImplementedException('InsuredsService.list');
  }

  async findOne(_id: string, _tenant: TenantCtx): Promise<unknown> {
    throw new NotImplementedException('InsuredsService.findOne');
  }

  async create(_dto: CreateInsuredDto, _tenant: TenantCtx): Promise<unknown> {
    throw new NotImplementedException('InsuredsService.create');
  }

  async update(_id: string, _dto: UpdateInsuredDto, _tenant: TenantCtx): Promise<unknown> {
    throw new NotImplementedException('InsuredsService.update');
  }

  async softDelete(_id: string, _tenant: TenantCtx): Promise<void> {
    throw new NotImplementedException('InsuredsService.softDelete');
  }
}
