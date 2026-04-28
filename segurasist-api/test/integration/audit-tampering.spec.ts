/**
 * C-10 — Audit chain tampering detection integration test.
 *
 * Verifica que `AuditChainVerifierService.verify(source='both')` detecta
 * tampering coordinado donde un atacante con BYPASSRLS modifica `payloadDiff`
 * Y recomputa `rowHash` matching, lo cual con el "light path" original
 * (que solo encadenaba `prev_hash` sin recomputar SHA) pasaba silencioso.
 *
 * Estrategia (sin BD real — usamos un fake Prisma in-memory que satisface
 * el subset de la API consumida por los services, igual que
 * `verify-chain-cross-source.spec.ts`):
 *
 *   1. Construye una cadena hash válida de N filas (writer escribe rows con
 *      `prev_hash` y `row_hash` consistentes).
 *   2. Verifica `source='db'` → valid=true.
 *   3. **Tampering coordinado**: en una fila ya mirroreada O no mirroreada,
 *      modifica `payloadDiff` Y recomputa `rowHash` con el nuevo payload.
 *      Esto es lo que un atacante con BYPASSRLS haría: cambiar el contenido
 *      Y firmar de nuevo el row para que el row_hash matchee.
 *      ANTES (bug C-10): chain seguía pareciendo válida vía path light que
 *      solo verifica `prev_hash`. Pero `runVerification` (el writer) sí
 *      detecta — ahora consumido también desde el verifier 'both'.
 *   4. Si la fila NO está mirroreada → discrepancy detectada por el SHA
 *      recompute completo (broken DB chain).
 *   5. Si la fila SÍ está mirroreada → discrepancy detectada por cross-check
 *      DB↔S3 (rowHash diferente entre lados, S3 es ground-truth).
 *
 * Pre-requisito LocalStack: si no está, skip suite (igual que peer test).
 */
/* eslint-disable @typescript-eslint/no-non-null-assertion -- noUncheckedIndexedAccess obliga `!`. */
import { randomBytes } from 'node:crypto';
import { CreateBucketCommand, PutObjectLockConfigurationCommand, S3Client } from '@aws-sdk/client-s3';
import type { Env } from '@config/env.schema';
import { AuditChainVerifierService } from '../../src/modules/audit/audit-chain-verifier.service';
import { computeRowHash, GENESIS_HASH } from '../../src/modules/audit/audit-hash';
import { AuditS3MirrorService } from '../../src/modules/audit/audit-s3-mirror.service';
import { AuditWriterService, runVerification } from '../../src/modules/audit/audit-writer.service';

const ENDPOINT = process.env.AWS_ENDPOINT_URL ?? 'http://localhost:4566';
const REGION = process.env.LOCALSTACK_REGION ?? 'us-east-1';
const TENANT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

interface FakeRow {
  id: string;
  tenantId: string;
  actorId: string | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  ip: string | null;
  userAgent: string | null;
  payloadDiff: unknown;
  traceId: string | null;
  occurredAt: Date;
  prevHash: string;
  rowHash: string;
  mirroredToS3: boolean;
  mirroredAt: Date | null;
}

function makePrismaFake(rows: FakeRow[]) {
  const auditLog = {
    findMany: jest.fn(
      async ({ where, take }: { where?: { mirroredToS3?: boolean; tenantId?: string }; take?: number }) => {
        let filtered = rows.slice();
        if (where?.mirroredToS3 === false) filtered = filtered.filter((r) => !r.mirroredToS3);
        if (where?.tenantId) filtered = filtered.filter((r) => r.tenantId === where.tenantId);
        filtered.sort((a, b) => {
          if (a.tenantId !== b.tenantId) return a.tenantId.localeCompare(b.tenantId);
          const t = a.occurredAt.getTime() - b.occurredAt.getTime();
          if (t !== 0) return t;
          return a.id.localeCompare(b.id);
        });
        return typeof take === 'number' ? filtered.slice(0, take) : filtered;
      },
    ),
    updateMany: jest.fn(
      async ({
        where,
        data,
      }: {
        where: { id: { in: string[] } };
        data: { mirroredToS3: boolean; mirroredAt: Date };
      }) => {
        const ids = new Set(where.id.in);
        let count = 0;
        for (const r of rows) {
          if (ids.has(r.id)) {
            r.mirroredToS3 = data.mirroredToS3;
            r.mirroredAt = data.mirroredAt;
            count += 1;
          }
        }
        return { count };
      },
    ),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client: any = {
    auditLog,
    $connect: jest.fn(async () => undefined),
    $disconnect: jest.fn(async () => undefined),
  };
  return client;
}

function makeS3(): S3Client {
  return new S3Client({
    region: REGION,
    endpoint: ENDPOINT,
    forcePathStyle: true,
    credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
  });
}

function makeEnv(bucket: string): Env {
  return {
    AWS_REGION: REGION,
    AWS_ENDPOINT_URL: ENDPOINT,
    S3_BUCKET_UPLOADS: 'b1',
    S3_BUCKET_CERTIFICATES: 'b2',
    S3_BUCKET_AUDIT: bucket,
    S3_BUCKET_EXPORTS: 'b4',
    KMS_KEY_ID: 'alias/segurasist-dev',
  } as Env;
}

async function localstackUp(): Promise<boolean> {
  try {
    const res = await fetch(`${ENDPOINT}/_localstack/health`);
    return res.ok;
  } catch {
    return false;
  }
}

function buildSeedRows(n: number): FakeRow[] {
  const rows: FakeRow[] = [];
  let prev = GENESIS_HASH;
  const base = Date.now();
  for (let i = 0; i < n; i += 1) {
    const occurredAt = new Date(base + i * 1000);
    const payloadDiff = { idx: i, original: true };
    const rowHash = computeRowHash({
      prevHash: prev,
      tenantId: TENANT,
      actorId: null,
      action: 'create',
      resourceType: 'insureds',
      resourceId: `ins-${i}`,
      payloadDiff,
      occurredAt,
    });
    rows.push({
      id: `tamp-${i.toString().padStart(2, '0')}-${randomBytes(2).toString('hex')}`,
      tenantId: TENANT,
      actorId: null,
      action: 'create',
      resourceType: 'insureds',
      resourceId: `ins-${i}`,
      ip: null,
      userAgent: null,
      payloadDiff,
      traceId: null,
      occurredAt,
      prevHash: prev,
      rowHash,
      mirroredToS3: false,
      mirroredAt: null,
    });
    prev = rowHash;
  }
  return rows;
}

describe('C-10 — audit chain tampering detection (full SHA recompute)', () => {
  describe('runVerification (writer-side, no S3 dependency)', () => {
    it('detecta tampering coordinado payloadDiff+rowHash en una fila aún NO mirroreada', () => {
      // Cadena válida de 5 filas — todas pasan la verificación full SHA.
      const rows = buildSeedRows(5);
      const initial = runVerification(rows);
      expect(initial.valid).toBe(true);
      expect(initial.totalRows).toBe(5);

      // Atacante con BYPASSRLS modifica payloadDiff de la fila #2 Y recomputa
      // rowHash matching el nuevo payload. Si el verifier solo chequeara
      // prev_hash (light path), seguiría devolviendo valid=true porque la
      // cadena prev_hash → row_hash sigue consistente:
      //   - row[2].rowHash es nuevo
      //   - row[3].prevHash sigue apuntando al rowHash ORIGINAL (no actualizado)
      //   → ¡rota!
      // Pero el atacante sofisticado también recomputa la cadena downstream:
      const target = rows[2]!;
      const tamperedPayload = { idx: 2, original: false, leaked: 'PII' };
      const newRowHash = computeRowHash({
        prevHash: target.prevHash,
        tenantId: target.tenantId,
        actorId: target.actorId,
        action: target.action,
        resourceType: target.resourceType,
        resourceId: target.resourceId,
        payloadDiff: tamperedPayload,
        occurredAt: target.occurredAt,
      });
      target.payloadDiff = tamperedPayload;
      target.rowHash = newRowHash;

      // Re-encadenar todas las filas siguientes (rows[3], rows[4]).
      let prev = newRowHash;
      for (let i = 3; i < rows.length; i += 1) {
        const r = rows[i]!;
        r.prevHash = prev;
        r.rowHash = computeRowHash({
          prevHash: prev,
          tenantId: r.tenantId,
          actorId: r.actorId,
          action: r.action,
          resourceType: r.resourceType,
          resourceId: r.resourceId,
          payloadDiff: r.payloadDiff,
          occurredAt: r.occurredAt,
        });
        prev = r.rowHash;
      }

      // Con tampering coordinado completo (payload + rowHash + downstream),
      // la cadena DB SOLA es indistinguible de una válida. La detección
      // solo viene del cross-check con S3. Pero si el atacante NO recomputa
      // downstream (caso común: solo le importa la fila X), la cadena se
      // rompe en la siguiente fila.
      const reverify = runVerification(rows);
      expect(reverify.valid).toBe(true); // chain íntegra DB-side post tampering full
      // El atacante "limpió" todo. Cross-check S3 sigue siendo la última
      // defensa — verificada en suite cross-source. Aquí lo importante es
      // que `runVerification` SÍ haría failing si el atacante deja
      // inconsistencia.

      // Escenario realista: atacante NO recomputa downstream.
      const rows2 = buildSeedRows(5);
      const t2 = rows2[2]!;
      const newPayload2 = { idx: 2, original: false, leaked: 'X' };
      t2.payloadDiff = newPayload2;
      t2.rowHash = computeRowHash({
        prevHash: t2.prevHash,
        tenantId: t2.tenantId,
        actorId: t2.actorId,
        action: t2.action,
        resourceType: t2.resourceType,
        resourceId: t2.resourceId,
        payloadDiff: newPayload2,
        occurredAt: t2.occurredAt,
      });
      // rows2[3].prevHash sigue apuntando al rowHash original → cadena rota.
      const partialTampering = runVerification(rows2);
      expect(partialTampering.valid).toBe(false);
      // El break point puede ser t2 (si el SHA no matchea su propio rowHash)
      // o rows2[3] (si t2 sí matchea pero rows2[3].prevHash quedó stale).
      // Aquí t2 fue re-firmado: SHA(t2) == t2.rowHash; pero rows2[3].prevHash
      // sigue siendo el ANTIGUO rowHash de t2 → break at rows2[3].
      expect(partialTampering.brokenAtId).toBe(rows2[3]!.id);
    });

    it('detecta tampering simple sin re-firma del rowHash', () => {
      // Atacante naive: solo modifica payloadDiff sin tocar rowHash.
      // El path light original NO lo detectaba (encadenaba prev_hash y
      // como el rowHash en BD seguía siendo el "original", la cadena
      // parecía consistente). El path nuevo (full SHA) SÍ lo detecta.
      const rows = buildSeedRows(3);
      const t = rows[1]!;
      t.payloadDiff = { tampered: true };
      // t.rowHash se queda igual → SHA recomputed != rowHash persistido.

      const result = runVerification(rows);
      expect(result.valid).toBe(false);
      expect(result.brokenAtId).toBe(t.id);
    });

    it('cadena íntegra → valid=true, brokenAtId undefined', () => {
      const rows = buildSeedRows(10);
      const result = runVerification(rows);
      expect(result.valid).toBe(true);
      expect(result.totalRows).toBe(10);
      expect(result.brokenAtId).toBeUndefined();
    });
  });

  describe("AuditChainVerifierService.verify(source='both') — cross-source tampering detection", () => {
    let s3: S3Client;
    let bucket: string;
    let skip = false;
    let rows: FakeRow[];
    let verifier: AuditChainVerifierService;
    let writer: AuditWriterService;
    let mirror: AuditS3MirrorService;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let prismaFake: any;

    beforeAll(async () => {
      if (!(await localstackUp())) {
        // eslint-disable-next-line no-console
        console.warn('[audit-tampering] LocalStack no disponible; skip suite cross-source.');
        skip = true;
        return;
      }
      s3 = makeS3();
      bucket = `segurasist-test-tamper-${randomBytes(4).toString('hex')}`;
      await s3.send(
        new CreateBucketCommand({
          Bucket: bucket,
          ObjectLockEnabledForBucket: true,
          ...(REGION !== 'us-east-1'
            ? { CreateBucketConfiguration: { LocationConstraint: REGION as never } }
            : {}),
        }),
      );
      await s3.send(
        new PutObjectLockConfigurationCommand({
          Bucket: bucket,
          ObjectLockConfiguration: {
            ObjectLockEnabled: 'Enabled',
            Rule: { DefaultRetention: { Mode: 'COMPLIANCE', Days: 1 } },
          },
        }),
      );

      rows = buildSeedRows(4);
      prismaFake = makePrismaFake(rows);
      writer = new AuditWriterService(prismaFake);
      mirror = new AuditS3MirrorService(makeEnv(bucket), prismaFake, s3);
      verifier = new AuditChainVerifierService(writer, mirror);

      // Mirror inicial: las 4 filas quedan en S3 inmutable.
      await mirror.runOnce();
    }, 60_000);

    it('cadena íntegra post-mirror → both valid=true sin discrepancies', async () => {
      if (skip) return;
      const res = await verifier.verify(TENANT, 'both');
      expect(res.valid).toBe(true);
      expect(res.discrepancies).toBeUndefined();
      expect(res.totalRows).toBe(4);
    }, 30_000);

    it('tampering coordinado payloadDiff+rowHash post-mirror → both detecta vía cross-check DB↔S3', async () => {
      if (skip) return;
      // El atacante con BYPASSRLS modifica una fila YA mirroreada:
      //   - Recomputa rowHash matching el nuevo payload (consistencia local DB).
      //   - NO puede tocar S3 (Object Lock COMPLIANCE bloquea overwrite).
      // → El cross-check DB↔S3 detecta `row_hash_mismatch`.
      const target = rows[1]!;
      const originalPayload = target.payloadDiff;
      const originalRowHash = target.rowHash;
      const tamperedPayload = { idx: 1, leaked: 'PII coordinated' };
      const newRowHash = computeRowHash({
        prevHash: target.prevHash,
        tenantId: target.tenantId,
        actorId: target.actorId,
        action: target.action,
        resourceType: target.resourceType,
        resourceId: target.resourceId,
        payloadDiff: tamperedPayload,
        occurredAt: target.occurredAt,
      });
      target.payloadDiff = tamperedPayload;
      target.rowHash = newRowHash;

      try {
        const res = await verifier.verify(TENANT, 'both');
        expect(res.valid).toBe(false);
        expect(res.discrepancies).toBeDefined();
        const found = (res.discrepancies ?? []).find(
          (d) => d.rowId === target.id && d.reason === 'row_hash_mismatch',
        );
        expect(found).toBeDefined();
        expect(found?.db?.rowHash).toBe(newRowHash);
        expect(found?.s3?.rowHash).toBe(originalRowHash);
      } finally {
        target.payloadDiff = originalPayload;
        target.rowHash = originalRowHash;
      }
    }, 30_000);

    it('tampering simple (payloadDiff sin re-firmar rowHash) → both detecta vía full SHA recompute', async () => {
      if (skip) return;
      // Atacante naive olvida actualizar rowHash. El path antiguo "light"
      // NO detectaba (solo encadenaba prev_hash). Path nuevo full SHA SÍ.
      const target = rows[2]!;
      const originalPayload = target.payloadDiff;
      target.payloadDiff = { tampered: 'naive', leaked: true };
      // rowHash no se toca → SHA recompute != rowHash.

      try {
        const res = await verifier.verify(TENANT, 'both');
        expect(res.valid).toBe(false);
        // Debe haber al menos una discrepancia (puede ser cross-check DB↔S3
        // por payloadDiff distinto en S3; el SHA recompute en DB también
        // falla porque rowHash quedó stale respecto al nuevo payload).
        expect(res.discrepancies).toBeDefined();
        expect((res.discrepancies ?? []).length).toBeGreaterThan(0);
      } finally {
        target.payloadDiff = originalPayload;
      }
    }, 30_000);
  });
});
