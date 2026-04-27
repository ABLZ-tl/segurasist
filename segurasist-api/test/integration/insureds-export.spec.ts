/**
 * Integration: flujo POST /v1/insureds/export → worker.runOnce() → ready.
 *
 * Mockea PrismaService + PrismaBypassRlsService + S3 + SQS para no requerir
 * LocalStack/Postgres. El objetivo es probar que:
 *   1. exportRequest persiste, encola y devuelve exportId.
 *   2. ReportsWorker.handleEvent procesa el mismo evento end-to-end.
 *   3. findExport devuelve downloadUrl tras ready.
 *   4. Cross-tenant: un export de tenant A NO es visible para tenant B
 *      (defense-in-depth check explícito en findExport).
 *
 * Este spec NO es e2e (no levanta NestApplication) — es integration porque
 * compone los services reales con mocks selectivos.
 */
import type { PrismaBypassRlsService } from '@common/prisma/prisma-bypass-rls.service';
import type { PrismaService } from '@common/prisma/prisma.service';
import type { Env } from '@config/env.schema';
import type { S3Service } from '@infra/aws/s3.service';
import type { SqsService } from '@infra/aws/sqs.service';
import type { AuditWriterService } from '@modules/audit/audit-writer.service';
import type { PuppeteerService } from '@modules/certificates/puppeteer.service';
import { InsuredsService } from '@modules/insureds/insureds.service';
import { Logger, NotFoundException } from '@nestjs/common';
import { mockDeep } from 'jest-mock-extended';
import { ReportsWorkerService } from '../../src/workers/reports-worker.service';

Logger.overrideLogger(false);

const ENV: Env = {
  AWS_REGION: 'us-east-1',
  NODE_ENV: 'test',
  S3_BUCKET_EXPORTS: 'segurasist-dev-exports',
  KMS_KEY_ID: 'alias/segurasist-dev',
  SQS_QUEUE_REPORTS: 'http://localhost:4566/000000000000/reports-queue',
} as unknown as Env;

const TENANT_A = '11111111-1111-1111-1111-111111111111';
const TENANT_B = '22222222-2222-2222-2222-222222222222';
const USER_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const USER_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

describe('Insureds Export — request→worker→download flow', () => {
  it('happy path: request → worker.runOnce → row=ready → findExport returns presigned URL', async () => {
    // Mocks compartidos: el INSERT del service se replica en una "DB" en memoria
    // que el worker lee.
    const inMemoryExports = new Map<string, Record<string, unknown>>();

    const prisma = mockDeep<PrismaService>();
    const bypass = mockDeep<PrismaBypassRlsService>();
    const audit = mockDeep<AuditWriterService>();
    const sqs = mockDeep<SqsService>();
    const s3 = mockDeep<S3Service>();
    const puppeteer = mockDeep<PuppeteerService>();

    // PrismaService.withTenant → ejecuta el callback con un tx que delega al
    // map en memoria. Inyectamos `requestedAt` Date porque el findExport
    // serializa con .toISOString().
    prisma.withTenant.mockImplementation(async (fn: (tx: never) => Promise<unknown>) =>
      fn({
        export: {
          create: async (args: { data: { id: string; [k: string]: unknown } }) => {
            const row = { ...args.data, requestedAt: new Date(), completedAt: null };
            inMemoryExports.set(args.data.id, row);
            return row;
          },
        },
      } as never),
    );
    // PrismaService.client.export.findFirst (findExport) → lee del map.
    // Casteamos los args a `never` para esquivar la inferencia exhaustiva
    // de Prisma — el test sólo lee `where.id` y `where.requestedBy`.
    prisma.client.export.findFirst.mockImplementation((async (args: unknown): Promise<unknown> => {
      const a = args as { where: { id: string; requestedBy?: string } };
      const row = inMemoryExports.get(a.where.id);
      if (!row) return null;
      if (a.where.requestedBy && row.requestedBy !== a.where.requestedBy) return null;
      return row;
    }) as never);
    // PrismaBypassRlsService → mismo map (worker corre con bypass).
    bypass.client.export.findFirst.mockImplementation((async (args: unknown): Promise<unknown> => {
      const a = args as { where: { id: string } };
      return inMemoryExports.get(a.where.id) ?? null;
    }) as never);
    bypass.client.export.update.mockImplementation((async (args: unknown): Promise<unknown> => {
      const a = args as { where: { id: string }; data: Record<string, unknown> };
      const cur = inMemoryExports.get(a.where.id) ?? {};
      const next = { ...cur, ...a.data };
      inMemoryExports.set(a.where.id, next);
      return next;
    }) as never);
    bypass.client.insured.findMany.mockResolvedValueOnce([
      {
        id: 'i1',
        curp: 'AAAA800101HDFRRR01',
        rfc: null,
        fullName: 'Insured 1',
        email: 'a@b.c',
        phone: null,
        validFrom: new Date('2026-01-01'),
        validTo: new Date('2027-01-01'),
        status: 'active',
        metadata: null,
        package: { name: 'Básico' },
      },
    ] as never);
    bypass.client.insured.findMany.mockResolvedValueOnce([] as never);
    s3.getPresignedGetUrl.mockResolvedValue('https://s3.local/exports/signed-url-abc');

    const svc = new InsuredsService(prisma, bypass, audit, sqs, s3, ENV);
    const worker = new ReportsWorkerService(bypass, s3, puppeteer, audit, ENV);

    // 1. request
    const result = await svc.exportRequest('xlsx', { status: 'active' }, { id: TENANT_A }, { id: USER_A });
    expect(result.status).toBe('pending');
    expect(sqs.sendMessage).toHaveBeenCalledTimes(1);

    // Capturar el evento que se envió a la cola y dárselo al worker.
    const [, body] = sqs.sendMessage.mock.calls[0]!;
    const event = body;

    // 2. worker procesa
    const workerResult = await worker.handleEvent(event as never);
    expect(workerResult).toEqual({ status: 'ready' });

    // 3. download URL
    const status = await svc.findExport(result.exportId, { id: TENANT_A }, { id: USER_A });
    expect(status.status).toBe('ready');
    expect(status.downloadUrl).toBe('https://s3.local/exports/signed-url-abc');
    expect(status.rowCount).toBe(1);
  });

  it('cross-tenant: tenant B no puede ver export de tenant A', async () => {
    const inMemoryExports = new Map<string, Record<string, unknown>>();

    const prisma = mockDeep<PrismaService>();
    const bypass = mockDeep<PrismaBypassRlsService>();
    const audit = mockDeep<AuditWriterService>();
    const sqs = mockDeep<SqsService>();
    const s3 = mockDeep<S3Service>();

    // Sembrar manualmente un export de TENANT_A.
    const aExportId = '99999999-9999-9999-9999-999999999991';
    inMemoryExports.set(aExportId, {
      id: aExportId,
      tenantId: TENANT_A,
      requestedBy: USER_A,
      status: 'ready',
      format: 'xlsx',
      rowCount: 5,
      s3Key: `exports/${TENANT_A}/${aExportId}.xlsx`,
      hash: 'a'.repeat(64),
      error: null,
      requestedAt: new Date(),
      completedAt: new Date(),
    });
    // Simular RLS — un user de TENANT_B (USER_B) NO debe ver el export.
    // Escenario realista:
    //   - findFirst con requestedBy=USER_B devuelve null (no es el dueño).
    //   - aún si forzáramos a buscar como USER_A desde TENANT_B, el guard
    //     de `findExport` rechaza por tenantId mismatch.
    prisma.client.export.findFirst.mockImplementation((async (args: unknown): Promise<unknown> => {
      const a = args as { where: { id: string; requestedBy?: string } };
      const row = inMemoryExports.get(a.where.id);
      if (!row) return null;
      if (a.where.requestedBy && row.requestedBy !== a.where.requestedBy) return null;
      return row;
    }) as never);

    const svc = new InsuredsService(prisma, bypass, audit, sqs, s3, ENV);

    // Intento desde TENANT_B con USER_B → 404.
    await expect(svc.findExport(aExportId, { id: TENANT_B }, { id: USER_B })).rejects.toThrow(
      NotFoundException,
    );

    // Intento desde TENANT_B con USER_A (suplantación parcial) → la fila
    // existe pero el chequeo de tenantId la rechaza.
    await expect(svc.findExport(aExportId, { id: TENANT_B }, { id: USER_A })).rejects.toThrow(
      NotFoundException,
    );

    // Confirmamos que TENANT_A + USER_A SÍ tiene acceso (sanity).
    s3.getPresignedGetUrl.mockResolvedValue('https://s3.local/ok');
    const ok = await svc.findExport(aExportId, { id: TENANT_A }, { id: USER_A });
    expect(ok.status).toBe('ready');
  });
});
