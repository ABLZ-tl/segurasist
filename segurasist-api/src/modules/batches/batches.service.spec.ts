import type { S3Service } from '@infra/aws/s3.service';
import type { SqsService } from '@infra/aws/sqs.service';
import { NotImplementedException } from '@nestjs/common';
import { mock } from 'jest-mock-extended';
import { mockPrismaService } from '../../../test/mocks/prisma.mock';
import { BatchesService } from './batches.service';

describe('BatchesService (stubs Sprint 0)', () => {
  const prisma = mockPrismaService();
  const s3 = mock<S3Service>();
  const sqs = mock<SqsService>();
  const svc = new BatchesService(prisma, s3, sqs);
  const tenant = { id: '11111111-1111-1111-1111-111111111111' };

  it('upload lanza NotImplementedException sin tocar s3/sqs/prisma', async () => {
    await expect(
      svc.upload({ buffer: Buffer.from('x'), filename: 'a.csv', mimetype: 'text/csv' }, tenant, 'u'),
    ).rejects.toThrow(NotImplementedException);
    expect(s3.putObject).not.toHaveBeenCalled();
    expect(sqs.sendMessage).not.toHaveBeenCalled();
  });

  it('list lanza NotImplementedException', async () => {
    await expect(svc.list({ limit: 50 } as never, tenant)).rejects.toThrow('BatchesService.list');
  });

  it('findOne lanza NotImplementedException', async () => {
    await expect(svc.findOne('id', tenant)).rejects.toThrow('BatchesService.findOne');
  });

  it('listErrors lanza NotImplementedException', async () => {
    await expect(svc.listErrors('id', { limit: 100 } as never, tenant)).rejects.toThrow(
      'BatchesService.listErrors',
    );
  });

  it('confirm lanza NotImplementedException', async () => {
    await expect(svc.confirm('id', {} as never, tenant)).rejects.toThrow('BatchesService.confirm');
  });

  it('cancel lanza NotImplementedException', async () => {
    await expect(svc.cancel('id', tenant)).rejects.toThrow('BatchesService.cancel');
  });
});
