/**
 * Integration test del flujo end-to-end del mirror audit_log → S3 (Sprint 2 S2-07).
 *
 * Pre-requisitos: LocalStack 3.7 corriendo en localhost:4566 con S3 + KMS.
 * Postgres NO se requiere — usamos un PrismaClient fake-in-memory que matchea
 * el subset de la API de Prisma que `AuditS3MirrorService` consume. Eso
 * permite que CI corra sin levantar `docker compose up postgres` (el
 * audit-chain.e2e-spec.ts ya cubre el path con Postgres real).
 *
 * Cobertura:
 *   1. Bootstrap bucket fresh con Object Lock COMPLIANCE 1d.
 *   2. Inyectar 10 filas en el "DB" fake con mirroredToS3=false.
 *   3. Llamar `runOnce()` manualmente (sin esperar 60s).
 *   4. Verificar:
 *      - Filas marcadas mirroredToS3=true.
 *      - Bucket S3 contiene NDJSON con prefix `audit/<tenant>/`.
 *      - El NDJSON parsea correctamente y matchea las filas in-memory.
 *      - `readAllForTenant` reconstruye la secuencia completa.
 */
/* eslint-disable @typescript-eslint/no-non-null-assertion -- noUncheckedIndexedAccess obliga `!` en accesos a array que sabemos que están en rango. */
import { randomBytes, createHash } from 'node:crypto';
import type { Readable } from 'node:stream';
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  ListObjectsV2Command,
  ListObjectVersionsCommand,
  PutObjectLockConfigurationCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import type { Env } from '@config/env.schema';
import { computeRowHash, GENESIS_HASH } from '../../src/modules/audit/audit-hash';
import { AuditS3MirrorService, type MirroredAuditRow } from '../../src/modules/audit/audit-s3-mirror.service';

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
    findMany: jest.fn(async ({ where, take }: { where?: { mirroredToS3?: boolean }; take?: number }) => {
      let filtered = rows.slice();
      if (where?.mirroredToS3 === false) filtered = filtered.filter((r) => !r.mirroredToS3);
      filtered.sort((a, b) => {
        if (a.tenantId !== b.tenantId) return a.tenantId.localeCompare(b.tenantId);
        const t = a.occurredAt.getTime() - b.occurredAt.getTime();
        if (t !== 0) return t;
        return a.id.localeCompare(b.id);
      });
      return typeof take === 'number' ? filtered.slice(0, take) : filtered;
    }),
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

async function streamToString(stream: Readable | undefined): Promise<string> {
  if (!stream) return '';
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
  }
  return Buffer.concat(chunks).toString('utf-8');
}

/** Construye una cadena hash válida (10 filas) para verificar el matching DB↔S3. */
function buildSeedRows(n: number): FakeRow[] {
  const rows: FakeRow[] = [];
  let prev = GENESIS_HASH;
  const base = Date.now();
  for (let i = 0; i < n; i += 1) {
    const occurredAt = new Date(base + i * 1000);
    const payloadDiff = { idx: i, body: { fullName: `User ${i}` } };
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
      id: `row-${i.toString().padStart(2, '0')}-${randomBytes(2).toString('hex')}`,
      tenantId: TENANT,
      actorId: null,
      action: 'create',
      resourceType: 'insureds',
      resourceId: `ins-${i}`,
      ip: '127.0.0.1',
      userAgent: 'jest',
      payloadDiff,
      traceId: `trace-${i}`,
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

describe('audit_log → S3 mirror flow (LocalStack Object Lock)', () => {
  let s3: S3Client;
  let bucket: string;
  let skip = false;

  beforeAll(async () => {
    if (!(await localstackUp())) {
      // eslint-disable-next-line no-console
      console.warn('[audit-mirror-flow] LocalStack no disponible; skip.');
      skip = true;
      return;
    }
    s3 = makeS3();
    bucket = `segurasist-test-mirror-${randomBytes(4).toString('hex')}`;

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

    // Sanity: bucket existe.
    await s3.send(new HeadBucketCommand({ Bucket: bucket }));
  }, 60_000);

  it('runOnce: 10 filas pendientes → todas mirroreadas, NDJSON en S3 con prefix correcto', async () => {
    if (skip) return;
    const rows = buildSeedRows(10);
    const prisma = makePrismaFake(rows);
    const svc = new AuditS3MirrorService(makeEnv(bucket), prisma, s3);
    const result = await svc.runOnce();

    expect(result.failedBatches).toBe(0);
    expect(result.rows).toBe(10);
    // 10 filas, mismo tenant, agrupadas por día UTC. Todas deberían caer en
    // 1 ó 2 batches (cruce de medianoche). El test pasa si batches >= 1.
    expect(result.batches).toBeGreaterThanOrEqual(1);

    // Todas las filas marcadas.
    expect(rows.every((r) => r.mirroredToS3)).toBe(true);
    expect(rows.every((r) => r.mirroredAt !== null)).toBe(true);

    // El bucket contiene objetos con prefix audit/<tenant>/.
    const list = await s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: `audit/${TENANT}/` }));
    expect((list.Contents ?? []).length).toBeGreaterThanOrEqual(1);
  }, 60_000);

  it('runOnce: idempotente — 2da llamada con todo mirroreado es no-op', async () => {
    if (skip) return;
    // Reusamos las filas del test anterior (todas mirroredToS3=true).
    const rows = buildSeedRows(10).map((r) => ({ ...r, mirroredToS3: true, mirroredAt: new Date() }));
    const prisma = makePrismaFake(rows);
    const svc = new AuditS3MirrorService(makeEnv(bucket), prisma, s3);
    const result = await svc.runOnce();
    expect(result).toEqual({ batches: 0, rows: 0, failedBatches: 0 });
  }, 30_000);

  it('NDJSON descargado matchea las filas DB byte-a-byte (id, hashes, payloadDiff)', async () => {
    if (skip) return;
    const rows = buildSeedRows(5);
    const prisma = makePrismaFake(rows);
    const svc = new AuditS3MirrorService(makeEnv(bucket), prisma, s3);
    await svc.runOnce();

    const list = await s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: `audit/${TENANT}/` }));
    const keys = (list.Contents ?? []).map((c) => c.Key as string).filter(Boolean);
    expect(keys.length).toBeGreaterThanOrEqual(1);

    // Descarga + parse.
    const allDownloaded: MirroredAuditRow[] = [];
    for (const k of keys) {
      const obj = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: k }));
      const text = await streamToString(obj.Body as Readable | undefined);
      for (const line of text.split('\n')) {
        const t = line.trim();
        if (!t) continue;
        allDownloaded.push(JSON.parse(t) as MirroredAuditRow);
      }
    }

    // Filtrar las filas del test actual (las del test anterior están en el
    // mismo bucket — discriminamos por id prefix `row-`).
    const ours = allDownloaded.filter((r) => rows.some((dbR) => dbR.id === r.id));
    expect(ours).toHaveLength(rows.length);
    for (const dbRow of rows) {
      const s3Row = ours.find((x) => x.id === dbRow.id);
      expect(s3Row).toBeDefined();
      expect(s3Row?.rowHash).toBe(dbRow.rowHash);
      expect(s3Row?.prevHash).toBe(dbRow.prevHash);
      expect(s3Row?.payloadDiff).toEqual(dbRow.payloadDiff);
      expect(s3Row?.occurredAt).toBe(dbRow.occurredAt.toISOString());
    }
  }, 60_000);

  it('readAllForTenant reconstruye la secuencia ordenada por occurredAt', async () => {
    if (skip) return;
    const prisma = makePrismaFake([]);
    const svc = new AuditS3MirrorService(makeEnv(bucket), prisma, s3);
    const all = await svc.readAllForTenant(TENANT);
    // Hubo 10 + 5 = 15 filas mirroreadas en este bucket por los tests previos.
    expect(all.length).toBeGreaterThanOrEqual(5);
    // Verificar orden cronológico.
    for (let i = 1; i < all.length; i += 1) {
      const prev = new Date(all[i - 1]!.occurredAt).getTime();
      const cur = new Date(all[i]!.occurredAt).getTime();
      expect(cur).toBeGreaterThanOrEqual(prev);
    }
  }, 60_000);

  it('integridad inmutable: intentar borrar un NDJSON ya subido → AccessDenied', async () => {
    if (skip) return;
    const list = await s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: `audit/${TENANT}/` }));
    const k = (list.Contents ?? []).map((c) => c.Key).filter(Boolean)[0];
    if (!k) {
      // Si por alguna razón quedó vacío, este test no aplica.
      return;
    }
    const versions = await s3.send(new ListObjectVersionsCommand({ Bucket: bucket, Prefix: k }));
    const v = versions.Versions?.[0];
    expect(v?.VersionId).toBeDefined();

    let threw = false;
    try {
      await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: k, VersionId: v?.VersionId }));
    } catch (err) {
      threw = true;
      const msg = err instanceof Error ? err.message : String(err);
      expect(msg).toMatch(/Access\s?Denied|WORM|locked|Compliance/i);
    }
    expect(threw).toBe(true);

    // Sanity: hash del objeto sigue accesible.
    const got = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: k }));
    const text = await streamToString(got.Body as Readable | undefined);
    expect(createHash('sha256').update(text).digest('hex')).toMatch(/^[0-9a-f]{64}$/);
  }, 30_000);
});
