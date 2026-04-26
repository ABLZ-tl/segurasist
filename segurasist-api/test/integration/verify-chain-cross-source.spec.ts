/**
 * Integration test del verificador cross-source DB ↔ S3 (Sprint 2 — S2-07).
 *
 * Estrategia:
 *   1. Construimos una cadena hash válida de N filas.
 *   2. Mirroreamos a un bucket fresh con Object Lock COMPLIANCE 1d.
 *   3. Ejercemos `AuditChainVerifierService.verify(...)` en los 3 modos:
 *      - source='db'   → valid=true (cadena en BD íntegra).
 *      - source='s3'   → valid=true (NDJSON en S3 íntegro).
 *      - source='both' → valid=true, sin discrepancies.
 *   4. **Tampering scenario**: simulamos un UPDATE en el lado DB
 *      (cambio de `rowHash` de una fila ya mirroreada). Re-corremos
 *      `verify(source='both')` → valid=false con discrepancia
 *      `row_hash_mismatch`.
 *
 * Pre-requisitos: LocalStack 3.7. Postgres no se requiere (usamos fake
 * in-memory que matchea la API consumida por los services).
 */
/* eslint-disable @typescript-eslint/no-non-null-assertion -- noUncheckedIndexedAccess obliga `!` en accesos a array que sabemos que están en rango. */
import { randomBytes } from 'node:crypto';
import { CreateBucketCommand, PutObjectLockConfigurationCommand, S3Client } from '@aws-sdk/client-s3';
import type { Env } from '@config/env.schema';
import { AuditChainVerifierService } from '../../src/modules/audit/audit-chain-verifier.service';
import { computeRowHash, GENESIS_HASH } from '../../src/modules/audit/audit-hash';
import { AuditS3MirrorService } from '../../src/modules/audit/audit-s3-mirror.service';
import { AuditWriterService } from '../../src/modules/audit/audit-writer.service';

const ENDPOINT = process.env.AWS_ENDPOINT_URL ?? 'http://localhost:4566';
const REGION = process.env.LOCALSTACK_REGION ?? 'us-east-1';
const TENANT = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

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
    const payloadDiff = { idx: i };
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
      id: `cs-${i.toString().padStart(2, '0')}-${randomBytes(2).toString('hex')}`,
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

describe('verify-chain cross-source DB ↔ S3 (LocalStack Object Lock)', () => {
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
      console.warn('[verify-chain-cross-source] LocalStack no disponible; skip.');
      skip = true;
      return;
    }
    s3 = makeS3();
    bucket = `segurasist-test-cross-${randomBytes(4).toString('hex')}`;
    await s3.send(
      new CreateBucketCommand({
        Bucket: bucket,
        ObjectLockEnabledForBucket: true,
        ...(REGION !== 'us-east-1'
          ? { CreateBucketConfiguration: { LocationConstraint: REGION as never } }
          : {}),
      }),
    );
    // Object Lock habilita versioning implícitamente — no llamamos PutBucketVersioning.
    await s3.send(
      new PutObjectLockConfigurationCommand({
        Bucket: bucket,
        ObjectLockConfiguration: {
          ObjectLockEnabled: 'Enabled',
          Rule: { DefaultRetention: { Mode: 'COMPLIANCE', Days: 1 } },
        },
      }),
    );

    rows = buildSeedRows(5);
    prismaFake = makePrismaFake(rows);

    // Bootstrap services usando los mismos PrismaClient/S3Client.
    writer = new AuditWriterService(prismaFake);
    mirror = new AuditS3MirrorService(makeEnv(bucket), prismaFake, s3);
    verifier = new AuditChainVerifierService(writer, mirror);

    // Mirror inicial.
    await mirror.runOnce();
  }, 60_000);

  it("source='db' devuelve valid=true para una cadena íntegra", async () => {
    if (skip) return;
    const res = await verifier.verify(TENANT, 'db');
    expect(res.source).toBe('db');
    expect(res.valid).toBe(true);
    expect(res.totalRows).toBe(5);
    expect(res.checkedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  }, 30_000);

  it("source='s3' devuelve valid=true después del mirror", async () => {
    if (skip) return;
    const res = await verifier.verify(TENANT, 's3');
    expect(res.source).toBe('s3');
    expect(res.valid).toBe(true);
    expect(res.totalRows).toBe(5);
  }, 30_000);

  it("source='both' devuelve valid=true sin discrepancies (DB y S3 coinciden)", async () => {
    if (skip) return;
    const res = await verifier.verify(TENANT, 'both');
    expect(res.source).toBe('both');
    expect(res.valid).toBe(true);
    expect(res.discrepancies).toBeUndefined();
  }, 30_000);

  it("tampering en DB (rowHash modificado) → source='both' detecta la discrepancia", async () => {
    if (skip) return;
    // Tampering: modificamos el rowHash de la fila #2 in-memory (simula un
    // UPDATE bypass-RLS que pasó desapercibido).
    const target = rows[2]!;
    const originalRowHash = target.rowHash;
    target.rowHash = 'f'.repeat(64);

    try {
      const res = await verifier.verify(TENANT, 'both');
      expect(res.source).toBe('both');
      expect(res.valid).toBe(false);
      expect(res.discrepancies).toBeDefined();
      const found = (res.discrepancies ?? []).find(
        (d) => d.rowId === target.id && d.reason === 'row_hash_mismatch',
      );
      expect(found).toBeDefined();
      expect(found?.db?.rowHash).toBe('f'.repeat(64));
      expect(found?.s3?.rowHash).toBe(originalRowHash);
    } finally {
      // Restaurar para no contaminar tests siguientes.
      target.rowHash = originalRowHash;
    }
  }, 30_000);

  it("source='s3' sigue íntegro tras el tampering DB (S3 es ground-truth)", async () => {
    if (skip) return;
    // El tampering del test anterior se restauró. Aún así validamos que el
    // S3 source recompute exitosamente — es una garantía sobre Object Lock.
    const res = await verifier.verify(TENANT, 's3');
    expect(res.valid).toBe(true);
  }, 30_000);

  it("filas no mirroreadas todavía (mirroredToS3=false) NO disparan discrepancia en source='both'", async () => {
    if (skip) return;
    // Inserta una nueva fila DB que aún no fue mirroreada.
    let prev = rows[rows.length - 1]!.rowHash;
    const occurredAt = new Date(Date.now() + 60_000);
    const payloadDiff = { idx: 999, lateRow: true };
    const rowHash = computeRowHash({
      prevHash: prev,
      tenantId: TENANT,
      actorId: null,
      action: 'create',
      resourceType: 'insureds',
      resourceId: 'ins-999',
      payloadDiff,
      occurredAt,
    });
    rows.push({
      id: `cs-late-${randomBytes(2).toString('hex')}`,
      tenantId: TENANT,
      actorId: null,
      action: 'create',
      resourceType: 'insureds',
      resourceId: 'ins-999',
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

    const res = await verifier.verify(TENANT, 'both');
    expect(res.valid).toBe(true);
    expect(res.discrepancies).toBeUndefined();

    // Mirror la fila tardía y re-verifica: sigue íntegra.
    await mirror.runOnce();
    const res2 = await verifier.verify(TENANT, 'both');
    expect(res2.valid).toBe(true);
    expect(res2.totalRows).toBe(6);
  }, 60_000);
});
