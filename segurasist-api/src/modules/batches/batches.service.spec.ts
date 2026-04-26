import type { PrismaBypassRlsService } from '@common/prisma/prisma-bypass-rls.service';
import type { Env } from '@config/env.schema';
import type { S3Service } from '@infra/aws/s3.service';
import type { SqsService } from '@infra/aws/sqs.service';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { mock, mockDeep } from 'jest-mock-extended';
import { mockPrismaService } from '../../../test/mocks/prisma.mock';
import { BatchesService } from './batches.service';
import { BatchesParserService } from './parser/batches-parser.service';
import { BatchesValidatorService } from './validator/batches-validator.service';

const TENANT = { id: '11111111-1111-1111-1111-111111111111' };
const ENV: Env = {
  S3_BUCKET_UPLOADS: 'segurasist-dev-uploads',
  KMS_KEY_ID: 'alias/segurasist-dev',
  SQS_QUEUE_LAYOUT: 'http://localhost:4566/000000000000/layout-validation-queue',
} as unknown as Env;

describe('BatchesService', () => {
  function makeService() {
    const prisma = mockPrismaService();
    const bypass = mockDeep<PrismaBypassRlsService>();
    const s3 = mock<S3Service>();
    const sqs = mock<SqsService>();
    const parser = new BatchesParserService();
    const validator = new BatchesValidatorService();
    const svc = new BatchesService(prisma, bypass, s3, sqs, parser, validator, ENV);
    return { svc, prisma, bypass, s3, sqs, parser, validator };
  }

  describe('upload — guardas básicas', () => {
    it('rechaza buffer vacío', async () => {
      const { svc } = makeService();
      await expect(
        svc.upload({ buffer: Buffer.alloc(0), filename: 'x.csv', mimetype: 'text/csv' }, TENANT, 'u'),
      ).rejects.toThrow(BadRequestException);
    });

    it('rechaza archivo > 25 MB', async () => {
      const { svc } = makeService();
      const huge = Buffer.alloc(26 * 1024 * 1024);
      await expect(
        svc.upload(
          {
            buffer: huge,
            filename: 'x.xlsx',
            mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          },
          TENANT,
          'u',
        ),
      ).rejects.toThrow(/grande/i);
    });
  });

  describe('findOne / list / cancel — paths sencillos', () => {
    it('findOne lanza NotFoundException si no existe', async () => {
      const { svc, prisma } = makeService();
      prisma.client.batch.findFirst.mockResolvedValue(null as never);
      await expect(svc.findOne('00000000-0000-0000-0000-000000000000', TENANT)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('cancel lanza NotFoundException si no existe', async () => {
      const { svc, prisma } = makeService();
      prisma.client.batch.findFirst.mockResolvedValue(null as never);
      await expect(svc.cancel('00000000-0000-0000-0000-000000000000', TENANT)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('cancel rechaza si batch ya está completed', async () => {
      const { svc, prisma } = makeService();
      prisma.client.batch.findFirst.mockResolvedValue({ id: 'b', status: 'completed' } as never);
      await expect(svc.cancel('00000000-0000-0000-0000-000000000000', TENANT)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('list devuelve cursor null cuando no hay siguiente página', async () => {
      const { svc, prisma } = makeService();
      prisma.client.batch.findMany.mockResolvedValue([
        {
          id: 'b1',
          fileName: 'a.csv',
          status: 'completed',
          rowsTotal: 0,
          rowsOk: 0,
          rowsError: 0,
          createdAt: new Date(),
        },
      ] as never);
      const out = await svc.list({ limit: 50 } as never, TENANT);
      expect(out.items).toHaveLength(1);
      expect(out.nextCursor).toBeNull();
    });
  });

  describe('preview — guardas de status', () => {
    it('lanza BadRequestException si batch no está en preview_ready', async () => {
      const { svc, prisma } = makeService();
      prisma.client.batch.findFirst.mockResolvedValue({
        id: 'b',
        status: 'validating',
        rowsTotal: 0,
        rowsOk: 0,
        rowsError: 0,
      } as never);
      await expect(svc.preview('b', TENANT)).rejects.toThrow(/preview_ready/);
    });

    it('lanza NotFoundException si batch no existe', async () => {
      const { svc, prisma } = makeService();
      prisma.client.batch.findFirst.mockResolvedValue(null as never);
      await expect(svc.preview('b', TENANT)).rejects.toThrow(NotFoundException);
    });
  });

  describe('confirm — guardas de status', () => {
    it('rechaza si batch no está en preview_ready', async () => {
      const { svc, prisma } = makeService();
      prisma.client.batch.findFirst.mockResolvedValue({ id: 'b', status: 'validating', rowsOk: 0 } as never);
      await expect(svc.confirm('b', {}, TENANT)).rejects.toThrow(BadRequestException);
    });

    it('rechaza si batch.rowsOk === 0', async () => {
      const { svc, prisma } = makeService();
      prisma.client.batch.findFirst.mockResolvedValue({
        id: 'b',
        status: 'preview_ready',
        rowsOk: 0,
      } as never);
      await expect(svc.confirm('b', {}, TENANT)).rejects.toThrow(/válidas/);
    });
  });
});
