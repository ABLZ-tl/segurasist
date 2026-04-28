/**
 * cert-integrity.spec.ts — Sprint 4 Fix C-01 (B-PDF, F1).
 *
 * Cierra la auditoría `04-certificates-email-v2.md` (CONV-01 + B4-V2-T01 +
 * B4-V2-T08): garantiza que `Certificate.hash` es el SHA-256 del buffer
 * Puppeteer real (PASS-1) y NO un valor random derivado de `randomUUID()`.
 *
 * Pre-fix (commit a8af110): `pdf-worker.service.ts:316,357` calculaba
 * `pdfHash = createHash(...).digest()` y luego `void pdfHash`. La BD
 * guardaba `provisionalHash` (random). El test recomputa SHA del buffer
 * mockeado y confronta contra el valor persistido a `prisma.certificate.create`.
 *
 * Diseño:
 *  - Mocks completos (Prisma, S3, SQS, Puppeteer): NO requiere Docker ni
 *    LocalStack; corre en CI sin infraestructura.
 *  - Verifica end-to-end del worker desde `handleEvent` hasta el `create`.
 *  - Cubre flow primera emisión + flow verify endpoint (recomputo SHA y
 *    confronta con la fila buscada).
 */
import { createHash } from 'node:crypto';
import type { AuthUser } from '../../src/common/decorators/current-user.decorator';
import type { PrismaBypassRlsService } from '../../src/common/prisma/prisma-bypass-rls.service';
import type { PrismaService } from '../../src/common/prisma/prisma.service';
import type { Env } from '../../src/config/env.schema';
import type { S3Service } from '../../src/infra/aws/s3.service';
import type { SqsService } from '../../src/infra/aws/sqs.service';
import { CertificatesService } from '../../src/modules/certificates/certificates.service';
import type { PuppeteerService } from '../../src/modules/certificates/puppeteer.service';
import { PdfWorkerService } from '../../src/workers/pdf-worker.service';

function makeEnv(): Env {
  return {
    NODE_ENV: 'test',
    AWS_REGION: 'us-east-1',
    AWS_ENDPOINT_URL: 'http://localstack:4566',
    S3_BUCKET_CERTIFICATES: 'certs-bucket',
    KMS_KEY_ID: 'alias/test',
    SQS_QUEUE_PDF: 'http://q/pdf',
    SQS_QUEUE_EMAIL: 'http://q/email',
    CERT_BASE_URL: 'http://localhost:3000',
    EMAIL_FROM_CERT: 'cert@x.com',
  } as Env;
}

interface MockClient {
  insured: { findFirst: jest.Mock };
  package: { findFirst: jest.Mock };
  tenant: { findFirst: jest.Mock };
  certificate: {
    findFirst: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
  };
  emailEvent?: { findMany: jest.Mock };
  $transaction: jest.Mock;
}

function makeMocks() {
  const mockClient: MockClient = {
    insured: { findFirst: jest.fn() },
    package: { findFirst: jest.fn() },
    tenant: { findFirst: jest.fn() },
    certificate: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    emailEvent: { findMany: jest.fn().mockResolvedValue([]) },
    $transaction: jest.fn(async (fn: (tx: MockClient) => Promise<unknown>) => fn(mockClient)),
  };
  const prismaBypass = { client: mockClient } as unknown as PrismaBypassRlsService;
  const prisma = { client: mockClient } as unknown as PrismaService;
  const s3 = {
    putObject: jest.fn().mockResolvedValue(undefined),
    getPresignedGetUrl: jest.fn().mockResolvedValue('https://s3/presigned'),
  } as unknown as S3Service;
  const sqs = { sendMessage: jest.fn().mockResolvedValue('msg-1') } as unknown as SqsService;
  const puppeteer = {
    renderPdf: jest.fn(),
  } as unknown as PuppeteerService;
  return { mockClient, prismaBypass, prisma, s3, sqs, puppeteer };
}

describe('Certificate integrity (Fix C-01) — F1 B-PDF', () => {
  const tenantId = '11111111-1111-1111-1111-111111111111';
  const insuredId = '22222222-2222-2222-2222-222222222222';
  const packageId = '33333333-3333-3333-3333-333333333333';

  function seedHappyPath(mockClient: MockClient): void {
    mockClient.insured.findFirst.mockResolvedValue({
      id: insuredId,
      tenantId,
      packageId,
      fullName: 'María García',
      curp: 'GARM850101MMNXXX02',
      email: 'maria@example.com',
      validFrom: new Date('2026-01-01'),
      validTo: new Date('2026-12-31'),
      package: {
        id: packageId,
        name: 'Plan Oro',
        coverages: [],
      },
    });
    mockClient.tenant.findFirst.mockResolvedValue({
      id: tenantId,
      name: 'Hospital MAC',
      slug: 'mac',
      brandJson: null,
    });
    mockClient.package.findFirst.mockResolvedValue({
      id: packageId,
      name: 'Plan Oro',
      coverages: [],
    });
  }

  describe('PdfWorkerService.generate persiste SHA real (NO random)', () => {
    it('Certificate.hash === SHA-256 del buffer Puppeteer PASS-1 (invariante crítico)', async () => {
      const { mockClient, prismaBypass, s3, sqs, puppeteer } = makeMocks();
      seedHappyPath(mockClient);

      // Buffer determinista para que el SHA sea reproducible.
      const fixedBuffer = Buffer.from('%PDF-1.4 deterministic-bytes-for-cert-integrity-spec');
      const expectedSha = createHash('sha256').update(fixedBuffer).digest('hex');

      (puppeteer.renderPdf as jest.Mock).mockResolvedValue({
        pdf: fixedBuffer,
        durationMs: 42,
      });

      mockClient.certificate.create.mockImplementation(async (args: { data: Record<string, unknown> }) => ({
        id: 'cert-real-hash-1',
        ...args.data,
        issuedAt: new Date('2026-04-27'),
      }));

      const worker = new PdfWorkerService(prismaBypass, s3, sqs, puppeteer, makeEnv());
      const out = await worker.handleEvent({
        kind: 'insured.created',
        tenantId,
        insuredId,
        packageId,
        source: { batchId: 'b1', rowNumber: 1 },
        occurredAt: new Date().toISOString(),
      });

      expect(out.certificateId).toBe('cert-real-hash-1');

      // ---- Invariante C-01 ----
      const data = mockClient.certificate.create.mock.calls[0][0].data;
      expect(data.hash).toBe(expectedSha);
      expect(data.hash).toMatch(/^[a-f0-9]{64}$/);
      expect(data.qrPayload).toBe(`http://localhost:3000/v1/certificates/verify/${expectedSha}`);

      // S3 metadata refleja el mismo SHA en x-hash y x-sha256-content
      // (cuando PASS-1 y PASS-2 producen idéntico buffer en mock).
      const meta = (s3.putObject as jest.Mock).mock.calls[0][0].Metadata;
      expect(meta['x-hash']).toBe(expectedSha);
      expect(meta['x-sha256-content']).toBe(expectedSha);

      // Evento certificate.issued en cola email lleva el hash real.
      const msg = (sqs.sendMessage as jest.Mock).mock.calls[0][1] as {
        kind: string;
        hash: string;
        verificationUrl: string;
      };
      expect(msg.kind).toBe('certificate.issued');
      expect(msg.hash).toBe(expectedSha);
    });

    it('PASS-1 y PASS-2 ambos invocados (Puppeteer renderPdf x2)', async () => {
      const { mockClient, prismaBypass, s3, sqs, puppeteer } = makeMocks();
      seedHappyPath(mockClient);

      (puppeteer.renderPdf as jest.Mock).mockResolvedValue({
        pdf: Buffer.from('%PDF-1.4 a'),
        durationMs: 10,
      });
      mockClient.certificate.create.mockResolvedValue({ id: 'c-2pass' });

      const worker = new PdfWorkerService(prismaBypass, s3, sqs, puppeteer, makeEnv());
      await worker.handleEvent({
        kind: 'insured.created',
        tenantId,
        insuredId,
        packageId,
        source: { batchId: 'b', rowNumber: 1 },
        occurredAt: new Date().toISOString(),
      });

      expect(puppeteer.renderPdf).toHaveBeenCalledTimes(2);
      const calls = (puppeteer.renderPdf as jest.Mock).mock.calls;
      expect(calls[0][0].ref).toMatch(/pass1$/);
      expect(calls[1][0].ref).toMatch(/pass2$/);
    });

    it('hash NO depende de randomUUID() — buffers iguales producen mismo hash', async () => {
      // Pre-fix: cada generación producía hash distinto aún con buffer
      // idéntico (porque randomUUID variaba). Post-fix: el hash es función
      // pura del buffer.
      const { mockClient: mc1, prismaBypass: pb1, s3: s31, sqs: sq1, puppeteer: pp1 } = makeMocks();
      const { mockClient: mc2, prismaBypass: pb2, s3: s32, sqs: sq2, puppeteer: pp2 } = makeMocks();
      seedHappyPath(mc1);
      seedHappyPath(mc2);
      const buf = Buffer.from('%PDF-1.4 same');
      (pp1.renderPdf as jest.Mock).mockResolvedValue({ pdf: buf, durationMs: 1 });
      (pp2.renderPdf as jest.Mock).mockResolvedValue({ pdf: buf, durationMs: 1 });
      mc1.certificate.create.mockResolvedValue({ id: 'c1' });
      mc2.certificate.create.mockResolvedValue({ id: 'c2' });

      const w1 = new PdfWorkerService(pb1, s31, sq1, pp1, makeEnv());
      const w2 = new PdfWorkerService(pb2, s32, sq2, pp2, makeEnv());
      await w1.handleEvent({
        kind: 'insured.created',
        tenantId,
        insuredId,
        packageId,
        source: { batchId: 'b', rowNumber: 1 },
        occurredAt: new Date().toISOString(),
      });
      await w2.handleEvent({
        kind: 'insured.created',
        tenantId,
        insuredId,
        packageId,
        source: { batchId: 'b', rowNumber: 1 },
        occurredAt: new Date().toISOString(),
      });

      const h1 = mc1.certificate.create.mock.calls[0][0].data.hash;
      const h2 = mc2.certificate.create.mock.calls[0][0].data.hash;
      // Pre-fix: h1 !== h2 (distintos randomUUID). Post-fix: h1 === h2.
      expect(h1).toBe(h2);
      expect(h1).toBe(createHash('sha256').update(buf).digest('hex'));
    });
  });

  describe('CertificatesService.verify(hash) recupera el cert recién emitido', () => {
    it('verify endpoint encuentra cert por hash real (lookup matchea PASS-1 SHA)', async () => {
      const { mockClient, prismaBypass, prisma, s3, sqs, puppeteer } = makeMocks();
      seedHappyPath(mockClient);

      const fixedBuffer = Buffer.from('%PDF-1.4 verify-roundtrip-bytes');
      const expectedSha = createHash('sha256').update(fixedBuffer).digest('hex');
      (puppeteer.renderPdf as jest.Mock).mockResolvedValue({
        pdf: fixedBuffer,
        durationMs: 33,
      });
      mockClient.certificate.create.mockImplementation(async (args: { data: Record<string, unknown> }) => ({
        id: 'cert-verify-1',
        ...args.data,
        issuedAt: new Date('2026-04-27T10:00:00Z'),
      }));

      const worker = new PdfWorkerService(prismaBypass, s3, sqs, puppeteer, makeEnv());
      await worker.handleEvent({
        kind: 'insured.created',
        tenantId,
        insuredId,
        packageId,
        source: { batchId: 'b', rowNumber: 1 },
        occurredAt: new Date().toISOString(),
      });

      // Simular que el verify endpoint encuentra el cert recién emitido.
      // findFirst se invoca con el hash provisto → el mock compara contra
      // el último create.
      mockClient.certificate.findFirst.mockImplementation(async (args: { where: { hash?: string } }) => {
        const created = mockClient.certificate.create.mock.calls[0][0].data as {
          hash: string;
          insuredId: string;
          tenantId: string;
          validTo: Date;
        };
        if (args.where.hash === created.hash) {
          return {
            tenantId: created.tenantId,
            insuredId: created.insuredId,
            validTo: created.validTo,
            issuedAt: new Date('2026-04-27T10:00:00Z'),
          };
        }
        return null;
      });
      mockClient.insured.findFirst.mockResolvedValue({
        fullName: 'María García',
        validFrom: new Date('2026-01-01'),
        package: { name: 'Plan Oro' },
      });
      mockClient.tenant.findFirst.mockResolvedValue({ name: 'Hospital MAC' });

      const certs = new CertificatesService(prisma, prismaBypass, s3, sqs, makeEnv());
      const result = (await certs.verify(expectedSha)) as {
        valid: boolean;
        insured?: { fullName: string; packageName: string };
        tenantName?: string;
      };

      expect(result.valid).toBe(true);
      expect(result.insured?.fullName).toBe('María García');
      expect(result.insured?.packageName).toBe('Plan Oro');
      expect(result.tenantName).toBe('Hospital MAC');

      // Verify NO devuelve PII sensible (CURP/RFC/email/phone).
      const serialized = JSON.stringify(result);
      expect(serialized).not.toMatch(/curp|rfc|@example\.com|\d{10}/i);
    });

    it('verify endpoint NO encuentra cert con hash random (defensa pre-fix)', async () => {
      const { mockClient, prismaBypass, prisma, s3, sqs } = makeMocks();
      mockClient.certificate.findFirst.mockResolvedValue(null);

      const certs = new CertificatesService(prisma, prismaBypass, s3, sqs, makeEnv());
      const result = (await certs.verify('a'.repeat(64))) as { valid: boolean };
      expect(result.valid).toBe(false);
    });

    it('verify endpoint rechaza hash mal formado sin filtrar info', async () => {
      const { prismaBypass, prisma, s3, sqs } = makeMocks();
      const certs = new CertificatesService(prisma, prismaBypass, s3, sqs, makeEnv());
      const r1 = (await certs.verify('not-hex')) as { valid: boolean };
      const r2 = (await certs.verify('short')) as { valid: boolean };
      expect(r1.valid).toBe(false);
      expect(r2.valid).toBe(false);
    });
  });

  describe('Fix B4-V2-16 — urlForSelf filtra status="issued"', () => {
    /**
     * Pre-fix: `urlForSelf` solo filtraba `{ insuredId, deletedAt: null }`,
     * por lo que un cert revoked/replaced (incluyendo el placeholder
     * `revoked` que el PASS-1 fail path persiste con hash random) podía ser
     * servido al asegurado. Post-fix: where incluye `status: 'issued'`.
     *
     * El test inspecciona el `where` pasado a `prisma.client.certificate.findFirst`
     * — la verdad sobre el filtro vive en el query, no en el resultado.
     */
    const insuredUser: AuthUser = {
      id: 'cog-sub-revoked-test',
      cognitoSub: 'cog-sub-revoked-test',
      email: 'asegurado@example.com',
      role: 'insured',
      scopes: [],
      mfaEnrolled: false,
    };

    it('urlForSelf incluye status="issued" en where clause (no devuelve revoked)', async () => {
      const { mockClient, prismaBypass, prisma, s3, sqs } = makeMocks();
      mockClient.insured.findFirst.mockResolvedValue({
        id: 'ins-rev-1',
        tenantId,
      });
      // Mock que captura el where y solo devuelve un cert si status='issued'
      // está presente en el filtro (simulando comportamiento Prisma + RLS).
      mockClient.certificate.findFirst.mockImplementation(
        async (args: { where: Record<string, unknown> }) => {
          if (args.where.status !== 'issued') {
            // Pre-fix simulado: si no hay filtro, podría devolver revoked.
            // El mock devuelve null aquí porque post-fix esperamos que el
            // service SIEMPRE pase status='issued'.
            return null;
          }
          return {
            id: 'cert-issued-1',
            version: 3,
            s3Key: 'certificates/t/i/v3.pdf',
            issuedAt: new Date('2026-04-01T10:00:00Z'),
            validTo: new Date('2027-01-01'),
          };
        },
      );

      const certs = new CertificatesService(prisma, prismaBypass, s3, sqs, makeEnv());
      const out = await certs.urlForSelf(insuredUser);
      expect(out.certificateId).toBe('cert-issued-1');

      // Invariante B4-V2-16: el where DEBE incluir status='issued'.
      const callArgs = mockClient.certificate.findFirst.mock.calls[0][0] as {
        where: Record<string, unknown>;
      };
      expect(callArgs.where.status).toBe('issued');
      expect(callArgs.where.insuredId).toBe('ins-rev-1');
      expect(callArgs.where.deletedAt).toBeNull();
    });

    it('urlForSelf 404 cuando único cert del asegurado está revoked', async () => {
      // Simulación realista: BD tiene un cert con status='revoked' (placeholder
      // del PASS-1 fail path). El query con status='issued' no matchea → 404.
      const { mockClient, prismaBypass, prisma, s3, sqs } = makeMocks();
      mockClient.insured.findFirst.mockResolvedValue({
        id: 'ins-rev-2',
        tenantId,
      });
      // Mock de Prisma que respeta filtros: si pides status='issued' y solo
      // hay revoked en "BD", devuelve null.
      const fakeRows = [{ id: 'cert-revoked', status: 'revoked', insuredId: 'ins-rev-2', deletedAt: null }];
      mockClient.certificate.findFirst.mockImplementation(
        async (args: { where: Record<string, unknown> }) => {
          const matched = fakeRows.find((r) => {
            if (args.where.insuredId && r.insuredId !== args.where.insuredId) return false;
            if (args.where.deletedAt === null && r.deletedAt !== null) return false;
            if (args.where.status && r.status !== args.where.status) return false;
            return true;
          });
          return matched ?? null;
        },
      );

      const certs = new CertificatesService(prisma, prismaBypass, s3, sqs, makeEnv());
      await expect(certs.urlForSelf(insuredUser)).rejects.toThrow(/Aún no se ha emitido tu certificado/);
      // Pre-fix: el mismo mock con where sin status devolvería el revoked
      // y el service generaría presigned URL. Post-fix: el filtro impide eso.
    });
  });
});
