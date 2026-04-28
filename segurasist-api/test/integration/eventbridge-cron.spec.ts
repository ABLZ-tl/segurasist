/**
 * S4-04 — Tests del MonthlyReportsHandler.
 *
 * Mockeamos PrismaBypassRlsService + S3 + SES + AuditWriter +
 * MonthlyReportGenerator e invocamos `handleEvent(...)` directamente
 * (igual que reports-worker.service.spec; NO levantamos LocalStack/PG
 * en integration mock). El binding EventBridge → SQS → handler es IaC
 * (Terraform) y se verifica con `terraform plan` en CI.
 *
 * Cubre:
 *   1. Happy path: trigger → handler genera PDF → sube S3 → envía email →
 *      marca completed → audit log.
 *   2. Idempotencia: 2× mismo período (P2002) → 2nd call hace skip
 *      (NO se re-envía email).
 *   3. Resiliencia per-tenant: tenant A falla en PDF gen → tenant B
 *      completa OK; cuenta failed=1, completed=1.
 *   4. resolveReportedPeriod: trigger 1-feb → reporta enero (mes-1).
 *   5. resolveReportedPeriod edge: trigger 1-ene → reporta diciembre del
 *      año anterior.
 *   6. shape DTO inválido (mensaje SQS corrupto) → no procesa.
 */
import { Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { mockDeep, type DeepMockProxy } from 'jest-mock-extended';
import type { PrismaBypassRlsService } from '../../src/common/prisma/prisma-bypass-rls.service';
import type { Env } from '../../src/config/env.schema';
import type { S3Service } from '../../src/infra/aws/s3.service';
import type { SesService } from '../../src/infra/aws/ses.service';
import type { AuditWriterService } from '../../src/modules/audit/audit-writer.service';
import {
  MonthlyReportCronEventSchema,
  resolveReportedPeriod,
} from '../../src/modules/reports/cron/dto/monthly-report-event.dto';
import {
  MonthlyReportsHandlerService,
  type MonthlyReportGenerator,
} from '../../src/modules/reports/cron/monthly-reports-handler.service';

Logger.overrideLogger(false);

const ENV: Env = {
  AWS_REGION: 'mx-central-1',
  NODE_ENV: 'test',
  S3_BUCKET_EXPORTS: 'segurasist-dev-exports',
  KMS_KEY_ID: 'alias/segurasist-dev',
  SES_SENDER_DOMAIN: 'segurasist.local',
  SQS_QUEUE_MONTHLY_REPORTS: 'http://localhost:4566/000000000000/monthly-reports',
  MONTHLY_REPORT_RECIPIENTS: ['ops@segurasist.local', 'admin@hospitalesmac.local'],
} as unknown as Env;

const TENANT_A = '11111111-1111-1111-1111-111111111111';
const TENANT_B = '22222222-2222-2222-2222-222222222222';

interface Deps {
  handler: MonthlyReportsHandlerService;
  prismaBypass: DeepMockProxy<PrismaBypassRlsService>;
  s3: DeepMockProxy<S3Service>;
  ses: DeepMockProxy<SesService>;
  audit: DeepMockProxy<AuditWriterService>;
  generator: jest.Mocked<MonthlyReportGenerator>;
}

function build(): Deps {
  const prismaBypass = mockDeep<PrismaBypassRlsService>();
  const s3 = mockDeep<S3Service>();
  const ses = mockDeep<SesService>();
  const audit = mockDeep<AuditWriterService>();
  const generator: jest.Mocked<MonthlyReportGenerator> = {
    generate: jest.fn(),
  };
  // Default: presigned URL siempre devuelve algo simulado.
  s3.getPresignedGetUrl.mockResolvedValue('https://s3-presigned/url');
  // SES devuelve messageId default.
  ses.sendEmail.mockResolvedValue('ses-msg-001');
  const handler = new MonthlyReportsHandlerService(prismaBypass, s3, ses, audit, generator, ENV);
  return { handler, prismaBypass, s3, ses, audit, generator };
}

describe('MonthlyReportCronEventSchema — DTO contract', () => {
  it('parsea evento válido con triggeredAt + override', () => {
    const parsed = MonthlyReportCronEventSchema.safeParse({
      kind: 'cron.monthly_reports',
      triggeredAt: '2026-05-01T14:00:00.000Z',
      schemaVersion: 1,
      overridePeriod: { year: 2026, month: 4 },
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.overridePeriod).toEqual({ year: 2026, month: 4 });
      expect(parsed.data.triggeredBy).toBe('eventbridge');
    }
  });

  it('rechaza shape inválido (kind incorrecto)', () => {
    const parsed = MonthlyReportCronEventSchema.safeParse({ kind: 'foo' });
    expect(parsed.success).toBe(false);
  });

  it('aplica default schemaVersion=1 cuando no viene', () => {
    const parsed = MonthlyReportCronEventSchema.safeParse({ kind: 'cron.monthly_reports' });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.schemaVersion).toBe(1);
    }
  });
});

describe('resolveReportedPeriod', () => {
  it('trigger en febrero → reporta enero del mismo año', () => {
    expect(resolveReportedPeriod(new Date('2026-02-01T14:00:00Z'))).toEqual({ year: 2026, month: 1 });
  });

  it('trigger en enero → reporta diciembre del año anterior', () => {
    expect(resolveReportedPeriod(new Date('2026-01-01T14:00:00Z'))).toEqual({ year: 2025, month: 12 });
  });

  it('overridePeriod gana siempre', () => {
    expect(resolveReportedPeriod(new Date('2026-05-01T14:00:00Z'), { year: 2024, month: 7 })).toEqual({
      year: 2024,
      month: 7,
    });
  });
});

describe('MonthlyReportsHandlerService.handleEvent', () => {
  const TRIGGER_AT = '2026-05-01T14:00:00.000Z';
  const PERIOD = { year: 2026, month: 4 };

  it('happy path: 2 tenants activos → ambos completan; PDF subido + email enviado + audit log', async () => {
    const { handler, prismaBypass, s3, ses, audit, generator } = build();
    prismaBypass.client.tenant.findMany.mockResolvedValue([
      { id: TENANT_A, name: 'Hospitales MAC' },
      { id: TENANT_B, name: 'Demo Tenant' },
    ] as never);
    prismaBypass.client.monthlyReportRun.create
      .mockResolvedValueOnce({ id: 'run-A' } as never)
      .mockResolvedValueOnce({ id: 'run-B' } as never);
    prismaBypass.client.monthlyReportRun.update.mockResolvedValue({} as never);
    generator.generate.mockResolvedValue({ pdf: Buffer.from('%PDF-1.7 mock') });

    const result = await handler.handleEvent({
      kind: 'cron.monthly_reports',
      triggeredAt: TRIGGER_AT,
      schemaVersion: 1,
      triggeredBy: 'eventbridge',
    });

    expect(result).toEqual({
      period: PERIOD,
      tenantsProcessed: 2,
      tenantsCompleted: 2,
      tenantsSkipped: 0,
      tenantsFailed: 0,
    });

    // 2 PDFs generados, 2 PUTs a S3, 2 emails, 2 audit logs.
    expect(generator.generate).toHaveBeenCalledTimes(2);
    expect(s3.putObject).toHaveBeenCalledTimes(2);
    expect(ses.sendEmail).toHaveBeenCalledTimes(2);
    // Email enviado a TODOS los destinatarios del env (multi-recipient).
    expect(ses.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: ['ops@segurasist.local', 'admin@hospitalesmac.local'],
        subject: expect.stringContaining('2026/04'),
      }),
    );
    // S3 key sigue convención `monthly-reports/{tenantId}/2026-04.pdf`.
    const putCall = s3.putObject.mock.calls[0]?.[0];
    expect(putCall?.Key).toMatch(/^monthly-reports\/[a-f0-9-]+\/2026-04\.pdf$/);
    expect(putCall?.ContentType).toBe('application/pdf');
    expect(putCall?.ServerSideEncryption).toBe('aws:kms');
    expect(putCall?.SSEKMSKeyId).toBe(ENV.KMS_KEY_ID);
    // Audit con action 'create' y resourceType 'report.monthly'.
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'create',
        resourceType: 'report.monthly',
        payloadDiff: expect.objectContaining({ subAction: 'sent', period: PERIOD }),
      }),
    );
    // Update final con status='completed'.
    const updateCalls = prismaBypass.client.monthlyReportRun.update.mock.calls;
    const completedUpdates = updateCalls.filter(
      (c) => (c[0] as { data?: { status?: string } }).data?.status === 'completed',
    );
    expect(completedUpdates.length).toBe(2);
  });

  it('idempotencia: 2do trigger del mismo período → P2002 → skip + NO email re-enviado', async () => {
    const { handler, prismaBypass, ses, generator } = build();
    prismaBypass.client.tenant.findMany.mockResolvedValue([
      { id: TENANT_A, name: 'Hospitales MAC' },
    ] as never);
    // Simulamos que la fila ya existe ⇒ Prisma lanza P2002.
    prismaBypass.client.monthlyReportRun.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('UNIQUE violation', {
        code: 'P2002',
        clientVersion: '5.x',
      }),
    );

    const result = await handler.handleEvent({
      kind: 'cron.monthly_reports',
      triggeredAt: TRIGGER_AT,
      schemaVersion: 1,
      triggeredBy: 'eventbridge',
    });

    expect(result.tenantsSkipped).toBe(1);
    expect(result.tenantsCompleted).toBe(0);
    expect(result.tenantsFailed).toBe(0);
    // NO se intentó generar PDF, ni subir, ni enviar email — el lock
    // P2002 cortó el flow antes.
    expect(generator.generate).not.toHaveBeenCalled();
    expect(ses.sendEmail).not.toHaveBeenCalled();
  });

  it('failure per-tenant aislado: tenant A falla PDF → tenant B completa OK', async () => {
    const { handler, prismaBypass, ses, audit, generator } = build();
    prismaBypass.client.tenant.findMany.mockResolvedValue([
      { id: TENANT_A, name: 'Falla Tenant' },
      { id: TENANT_B, name: 'OK Tenant' },
    ] as never);
    prismaBypass.client.monthlyReportRun.create
      .mockResolvedValueOnce({ id: 'run-A' } as never)
      .mockResolvedValueOnce({ id: 'run-B' } as never);
    prismaBypass.client.monthlyReportRun.update.mockResolvedValue({} as never);
    // A falla, B succeed.
    generator.generate
      .mockRejectedValueOnce(new Error('PDF_RENDER_FAILED'))
      .mockResolvedValueOnce({ pdf: Buffer.from('%PDF ok') });

    const result = await handler.handleEvent({
      kind: 'cron.monthly_reports',
      triggeredAt: TRIGGER_AT,
      schemaVersion: 1,
      triggeredBy: 'eventbridge',
    });

    expect(result.tenantsCompleted).toBe(1);
    expect(result.tenantsFailed).toBe(1);
    expect(result.tenantsSkipped).toBe(0);
    // Sólo 1 email enviado (el del tenant B).
    expect(ses.sendEmail).toHaveBeenCalledTimes(1);
    // El audit log de failure registró el error.
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT_A,
        payloadDiff: expect.objectContaining({
          subAction: 'failed',
          error: expect.stringContaining('PDF_RENDER_FAILED'),
        }),
      }),
    );
    // Update final del A con failed; del B con completed.
    const updateCalls = prismaBypass.client.monthlyReportRun.update.mock.calls;
    const failedUpdate = updateCalls.find(
      (c) => (c[0] as { data?: { status?: string } }).data?.status === 'failed',
    );
    const completedUpdate = updateCalls.find(
      (c) => (c[0] as { data?: { status?: string } }).data?.status === 'completed',
    );
    expect(failedUpdate).toBeDefined();
    expect(completedUpdate).toBeDefined();
    const failedData = (failedUpdate![0] as { data: Record<string, unknown> }).data;
    expect(failedData.errorMessage).toContain('PDF_RENDER_FAILED');
  });

  it('overridePeriod: el reporte sale para el período inyectado (re-trigger manual)', async () => {
    const { handler, prismaBypass, ses, generator } = build();
    prismaBypass.client.tenant.findMany.mockResolvedValue([
      { id: TENANT_A, name: 'Hospitales MAC' },
    ] as never);
    prismaBypass.client.monthlyReportRun.create.mockResolvedValue({ id: 'run-A' } as never);
    prismaBypass.client.monthlyReportRun.update.mockResolvedValue({} as never);
    generator.generate.mockResolvedValue({ pdf: Buffer.from('%PDF') });

    const result = await handler.handleEvent({
      kind: 'cron.monthly_reports',
      triggeredAt: '2026-05-01T14:00:00.000Z',
      overridePeriod: { year: 2024, month: 7 },
      schemaVersion: 1,
      triggeredBy: 'manual',
    });

    expect(result.period).toEqual({ year: 2024, month: 7 });
    expect(generator.generate).toHaveBeenCalledWith({
      tenantId: TENANT_A,
      period: { year: 2024, month: 7 },
    });
    // Subject del email refleja el override period.
    expect(ses.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ subject: expect.stringContaining('2024/07') }),
    );
    // monthlyReportRun.create persiste triggeredBy='manual'.
    expect(prismaBypass.client.monthlyReportRun.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          periodYear: 2024,
          periodMonth: 7,
          triggeredBy: 'manual',
        }),
      }),
    );
  });

  it('cero tenants activos: handler retorna sin invocar generator/SES', async () => {
    const { handler, prismaBypass, ses, generator } = build();
    prismaBypass.client.tenant.findMany.mockResolvedValue([] as never);

    const result = await handler.handleEvent({
      kind: 'cron.monthly_reports',
      triggeredAt: TRIGGER_AT,
      schemaVersion: 1,
      triggeredBy: 'eventbridge',
    });

    expect(result.tenantsProcessed).toBe(0);
    expect(generator.generate).not.toHaveBeenCalled();
    expect(ses.sendEmail).not.toHaveBeenCalled();
  });
});

/**
 * S1 iter 2 — handler integrado con `RealMonthlyReportGenerator`.
 *
 * Reemplaza el `jest.Mocked<MonthlyReportGenerator>` por la clase real
 * (con ReportsService + ReportsPdfRendererService mockeados aguas
 * abajo). Esto verifica el wiring: el handler invoca a la implementación
 * real, que a su vez llama a `getConciliacionReport` con la ventana
 * (year, month) → strings ISO + scope BYPASSRLS, y al pdfRenderer.
 */
describe('MonthlyReportsHandlerService — integración con RealMonthlyReportGenerator', () => {
  const TRIGGER_AT = '2026-05-01T14:00:00.000Z';
  const PERIOD = { year: 2026, month: 4 };

  it('handler + RealMonthlyReportGenerator: pipeline pasa el período correcto a getConciliacionReport', async () => {
    const { RealMonthlyReportGenerator } = await import(
      '../../src/modules/reports/monthly-report-generator.service'
    );
    const { ReportsService } = await import('../../src/modules/reports/reports.service');
    const { ReportsPdfRendererService } = await import(
      '../../src/modules/reports/reports-pdf-renderer.service'
    );

    const reportsSvc = mockDeep<InstanceType<typeof ReportsService>>();
    const pdfRenderer = mockDeep<InstanceType<typeof ReportsPdfRendererService>>();
    reportsSvc.getConciliacionReport.mockResolvedValue({
      from: '2026-04-01',
      to: '2026-04-30',
      tenantId: TENANT_A,
      activosInicio: 100,
      activosCierre: 110,
      altas: 15,
      bajas: 5,
      certificadosEmitidos: 7,
      claimsCount: 0,
      claimsAmountEstimated: 0,
      claimsAmountApproved: 0,
      coverageUsageCount: 0,
      coverageUsageAmount: 0,
      generatedAt: '2026-05-01T14:00:00.000Z',
    } as never);
    pdfRenderer.renderConciliacionPdf.mockResolvedValue(Buffer.from('%PDF-1.7 real'));

    const realGenerator = new RealMonthlyReportGenerator(reportsSvc, pdfRenderer);

    const prismaBypass = mockDeep<PrismaBypassRlsService>();
    const s3 = mockDeep<S3Service>();
    const ses = mockDeep<SesService>();
    const audit = mockDeep<AuditWriterService>();
    s3.getPresignedGetUrl.mockResolvedValue('https://s3-presigned/url');
    ses.sendEmail.mockResolvedValue('ses-msg-002');
    prismaBypass.client.tenant.findMany.mockResolvedValue([
      { id: TENANT_A, name: 'Hospitales MAC' },
    ] as never);
    prismaBypass.client.monthlyReportRun.create.mockResolvedValue({ id: 'run-real' } as never);
    prismaBypass.client.monthlyReportRun.update.mockResolvedValue({} as never);

    const handler = new MonthlyReportsHandlerService(prismaBypass, s3, ses, audit, realGenerator, ENV);

    const result = await handler.handleEvent({
      kind: 'cron.monthly_reports',
      triggeredAt: TRIGGER_AT,
      schemaVersion: 1,
      triggeredBy: 'eventbridge',
    });

    expect(result.tenantsCompleted).toBe(1);
    // Pipeline real: getConciliacionReport llamado con la ventana del mes.
    expect(reportsSvc.getConciliacionReport).toHaveBeenCalledWith(
      '2026-04-01',
      '2026-04-30',
      expect.objectContaining({ platformAdmin: true, tenantId: TENANT_A }),
    );
    expect(pdfRenderer.renderConciliacionPdf).toHaveBeenCalledTimes(1);
    // S3 + SES recibieron el buffer producido por el generator real.
    const putCall = s3.putObject.mock.calls[0]?.[0];
    expect(putCall?.Key).toMatch(/^monthly-reports\/[a-f0-9-]+\/2026-04\.pdf$/);
    expect(putCall?.Body).toBeInstanceOf(Buffer);
    expect(ses.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ subject: expect.stringContaining(`${PERIOD.year}/04`) }),
    );
  });
});
