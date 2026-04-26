/* eslint-disable @typescript-eslint/require-await -- stubs Sprint 0; implementación en S1-04/05 */
import { TenantCtx } from '@common/decorators/tenant.decorator';
import { PrismaService } from '@common/prisma/prisma.service';
import { S3Service } from '@infra/aws/s3.service';
import { SqsService } from '@infra/aws/sqs.service';
import { Injectable, NotImplementedException } from '@nestjs/common';
import { ConfirmBatchDto, ListBatchErrorsQuery, ListBatchesQuery } from './dto/batch.dto';

@Injectable()
export class BatchesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly s3: S3Service,
    private readonly sqs: SqsService,
  ) {}

  async upload(
    _file: { buffer: Buffer; filename: string; mimetype: string },
    _tenant: TenantCtx,
    _userId: string,
  ): Promise<unknown> {
    throw new NotImplementedException('BatchesService.upload');
  }

  async list(_q: ListBatchesQuery, _tenant: TenantCtx): Promise<unknown> {
    throw new NotImplementedException('BatchesService.list');
  }

  async findOne(_id: string, _tenant: TenantCtx): Promise<unknown> {
    throw new NotImplementedException('BatchesService.findOne');
  }

  async listErrors(_id: string, _q: ListBatchErrorsQuery, _tenant: TenantCtx): Promise<unknown> {
    throw new NotImplementedException('BatchesService.listErrors');
  }

  async confirm(_id: string, _dto: ConfirmBatchDto, _tenant: TenantCtx): Promise<unknown> {
    throw new NotImplementedException('BatchesService.confirm');
  }

  async cancel(_id: string, _tenant: TenantCtx): Promise<unknown> {
    throw new NotImplementedException('BatchesService.cancel');
  }
}
