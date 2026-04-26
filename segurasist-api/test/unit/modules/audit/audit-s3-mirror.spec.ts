/**
 * Unit tests del AuditS3MirrorService (Sprint 2 — story S2-07).
 *
 * No depende de Postgres ni de S3 real: mockeamos `PrismaClient` y `S3Client`
 * vía DI. Foco en el contrato del worker:
 *
 *   1. Lee filas con mirrored_to_s3=false agrupadas por (tenant, día UTC).
 *   2. Genera NDJSON con el shape esperado por verifyChain (source=s3).
 *   3. Sube al bucket configurado con SSE-KMS y default Object Lock retention.
 *   4. Marca filas mirroreadas como mirrored_to_s3=true.
 *   5. Si S3 PUT falla: NO marca, deja pendiente para retry.
 *   6. Re-entrancia: dos `runOnce()` simultáneos no se pisan (lock interno).
 *   7. Sin BD: degrada a no-op silencioso.
 *   8. `readAllForTenant` lista keys con prefijo, descarga, parsea NDJSON.
 */
/* eslint-disable @typescript-eslint/no-non-null-assertion -- noUncheckedIndexedAccess obliga `!` en accesos a array que sabemos que están en rango. */
import { Readable } from 'node:stream';
import type { S3Client } from '@aws-sdk/client-s3';
import { GetObjectCommand, ListObjectsV2Command, PutObjectCommand } from '@aws-sdk/client-s3';
import type { Env } from '@config/env.schema';
import {
  AuditS3MirrorService,
  serializeAuditRow,
  type MirroredAuditRow,
} from '../../../../src/modules/audit/audit-s3-mirror.service';

const TENANT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TENANT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

interface FakeAuditRow {
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

function row(overrides: Partial<FakeAuditRow>): FakeAuditRow {
  return {
    id: overrides.id ?? `row-${Math.random().toString(36).slice(2, 8)}`,
    tenantId: overrides.tenantId ?? TENANT_A,
    actorId: overrides.actorId ?? null,
    action: overrides.action ?? 'create',
    resourceType: overrides.resourceType ?? 'insureds',
    resourceId: overrides.resourceId ?? null,
    ip: overrides.ip ?? null,
    userAgent: overrides.userAgent ?? null,
    payloadDiff: overrides.payloadDiff ?? null,
    traceId: overrides.traceId ?? null,
    occurredAt: overrides.occurredAt ?? new Date('2026-04-25T12:00:00.000Z'),
    prevHash: overrides.prevHash ?? '0'.repeat(64),
    rowHash: overrides.rowHash ?? 'a'.repeat(64),
    mirroredToS3: overrides.mirroredToS3 ?? false,
    mirroredAt: overrides.mirroredAt ?? null,
  };
}

function makeFakePrisma(initial: FakeAuditRow[] = []): {
  client: unknown;
  rows: FakeAuditRow[];
  updateManyMock: jest.Mock;
} {
  const rows = [...initial];
  const updateManyMock = jest.fn(
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
  );
  const auditLog = {
    findMany: jest.fn(
      async ({
        where,
        take,
        orderBy: _o,
      }: {
        where?: { mirroredToS3?: boolean };
        take?: number;
        orderBy?: unknown;
      }) => {
        let filtered = rows.slice();
        if (where?.mirroredToS3 === false) {
          filtered = filtered.filter((r) => r.mirroredToS3 === false);
        }
        // Sort por (tenantId, occurredAt, id).
        filtered.sort((a, b) => {
          if (a.tenantId !== b.tenantId) return a.tenantId.localeCompare(b.tenantId);
          const t = a.occurredAt.getTime() - b.occurredAt.getTime();
          if (t !== 0) return t;
          return a.id.localeCompare(b.id);
        });
        return typeof take === 'number' ? filtered.slice(0, take) : filtered;
      },
    ),
    updateMany: updateManyMock,
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client: any = {
    auditLog,
    $connect: jest.fn(async () => undefined),
    $disconnect: jest.fn(async () => undefined),
  };
  return { client, rows, updateManyMock };
}

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    AWS_REGION: 'mx-central-1',
    AWS_ENDPOINT_URL: 'http://localstack:4566',
    S3_BUCKET_UPLOADS: 'b1',
    S3_BUCKET_CERTIFICATES: 'b2',
    S3_BUCKET_AUDIT: 'segurasist-dev-audit-v2',
    S3_BUCKET_EXPORTS: 'b4',
    KMS_KEY_ID: 'alias/segurasist-dev',
    ...overrides,
  } as Env;
}

function makeS3Stub(opts: { failPut?: boolean } = {}): { client: S3Client; sendMock: jest.Mock } {
  const sendMock = jest.fn(async (cmd: unknown) => {
    if (cmd instanceof PutObjectCommand) {
      if (opts.failPut) throw new Error('S3 down (test stub)');
      return { ETag: '"deadbeef"' };
    }
    if (cmd instanceof ListObjectsV2Command) {
      return { Contents: [], IsTruncated: false };
    }
    if (cmd instanceof GetObjectCommand) {
      return { Body: Readable.from(['']) };
    }
    return {};
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client: any = { send: sendMock };
  return { client: client as S3Client, sendMock };
}

describe('AuditS3MirrorService — batched mirror', () => {
  const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

  beforeAll(() => {
    process.env.NODE_ENV = 'test'; // desactiva el setInterval auto-arranque.
  });
  afterAll(() => {
    process.env.NODE_ENV = ORIGINAL_NODE_ENV;
  });

  it('runOnce: 0 filas pendientes → no-op (no llama a S3)', async () => {
    const fake = makeFakePrisma([]);
    const s3 = makeS3Stub();
    const svc = new AuditS3MirrorService(makeEnv(), fake.client as never, s3.client);
    const r = await svc.runOnce();
    expect(r).toEqual({ batches: 0, rows: 0, failedBatches: 0 });
    expect(s3.sendMock).not.toHaveBeenCalled();
  });

  it('runOnce: 3 filas mismo tenant + mismo día → 1 batch NDJSON', async () => {
    const occurred = new Date('2026-04-25T10:00:00.000Z');
    const fake = makeFakePrisma([
      row({ id: 'r1', occurredAt: occurred }),
      row({ id: 'r2', occurredAt: new Date(occurred.getTime() + 1000) }),
      row({ id: 'r3', occurredAt: new Date(occurred.getTime() + 2000) }),
    ]);
    const s3 = makeS3Stub();
    const svc = new AuditS3MirrorService(makeEnv(), fake.client as never, s3.client);
    const r = await svc.runOnce();

    expect(r.batches).toBe(1);
    expect(r.rows).toBe(3);
    expect(r.failedBatches).toBe(0);

    const calls = s3.sendMock.mock.calls.filter((c) => c[0] instanceof PutObjectCommand);
    expect(calls).toHaveLength(1);
    const put = calls[0][0] as PutObjectCommand;
    expect(put.input.Bucket).toBe('segurasist-dev-audit-v2');
    expect(put.input.Key).toMatch(new RegExp(`^audit/${TENANT_A}/2026/04/25/\\d{8}T\\d{6}\\d{3}Z\\.ndjson$`));
    expect(put.input.ServerSideEncryption).toBe('aws:kms');
    expect(put.input.SSEKMSKeyId).toBe('alias/segurasist-dev');
    expect(put.input.ContentType).toBe('application/x-ndjson');

    // El body es un buffer NDJSON con 3 líneas válidas.
    const body = (put.input.Body as Buffer).toString('utf-8');
    const lines = body.trim().split('\n');
    expect(lines).toHaveLength(3);
    const parsed = lines.map((l) => JSON.parse(l) as MirroredAuditRow);
    expect(parsed.map((p) => p.id)).toEqual(['r1', 'r2', 'r3']);
    expect(parsed[0]!.occurredAt).toBe(occurred.toISOString());

    // Filas marcadas.
    expect(fake.rows.every((r) => r.mirroredToS3)).toBe(true);
  });

  it('runOnce: filas de 2 tenants en mismo día → 2 batches separados', async () => {
    const occurred = new Date('2026-04-25T10:00:00.000Z');
    const fake = makeFakePrisma([
      row({ id: 'a1', tenantId: TENANT_A, occurredAt: occurred }),
      row({ id: 'b1', tenantId: TENANT_B, occurredAt: occurred }),
    ]);
    const s3 = makeS3Stub();
    const svc = new AuditS3MirrorService(makeEnv(), fake.client as never, s3.client);
    const r = await svc.runOnce();
    expect(r.batches).toBe(2);

    const puts = s3.sendMock.mock.calls
      .filter((c) => c[0] instanceof PutObjectCommand)
      .map((c) => c[0] as PutObjectCommand);
    expect(puts).toHaveLength(2);
    const keys = puts.map((p) => p.input.Key as string);
    expect(keys.some((k) => k.startsWith(`audit/${TENANT_A}/`))).toBe(true);
    expect(keys.some((k) => k.startsWith(`audit/${TENANT_B}/`))).toBe(true);
  });

  it('runOnce: filas de 2 días distintos del mismo tenant → 2 batches', async () => {
    const fake = makeFakePrisma([
      row({ id: 'd1', occurredAt: new Date('2026-04-25T23:59:00.000Z') }),
      row({ id: 'd2', occurredAt: new Date('2026-04-26T00:00:01.000Z') }),
    ]);
    const s3 = makeS3Stub();
    const svc = new AuditS3MirrorService(makeEnv(), fake.client as never, s3.client);
    const r = await svc.runOnce();
    expect(r.batches).toBe(2);

    const keys = s3.sendMock.mock.calls
      .filter((c) => c[0] instanceof PutObjectCommand)
      .map((c) => (c[0] as PutObjectCommand).input.Key as string);
    expect(keys.some((k) => k.includes('/2026/04/25/'))).toBe(true);
    expect(keys.some((k) => k.includes('/2026/04/26/'))).toBe(true);
  });

  it('runOnce: PUT falla para 1 batch → ese batch NO se marca, el resto sí', async () => {
    const occurred = new Date('2026-04-25T10:00:00.000Z');
    const fake = makeFakePrisma([
      row({ id: 'a1', tenantId: TENANT_A, occurredAt: occurred }),
      row({ id: 'b1', tenantId: TENANT_B, occurredAt: occurred }),
    ]);
    // Stub: PUT para tenant_B falla, tenant_A OK.
    const sendMock = jest.fn(async (cmd: unknown) => {
      if (cmd instanceof PutObjectCommand) {
        if ((cmd.input.Key as string).includes(TENANT_B)) {
          throw new Error('S3 throttle (test)');
        }
        return { ETag: '"ok"' };
      }
      return {};
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client: any = { send: sendMock };
    const svc = new AuditS3MirrorService(makeEnv(), fake.client as never, client as S3Client);
    const r = await svc.runOnce();
    expect(r.batches).toBe(1);
    expect(r.failedBatches).toBe(1);

    const a1 = fake.rows.find((r) => r.id === 'a1');
    const b1 = fake.rows.find((r) => r.id === 'b1');
    expect(a1?.mirroredToS3).toBe(true);
    expect(b1?.mirroredToS3).toBe(false); // próximo tick reintenta
  });

  it('runOnce: respeta batchLimit (no lee más de N filas en un tick)', async () => {
    process.env.AUDIT_MIRROR_BATCH_LIMIT = '2';
    try {
      const fake = makeFakePrisma([
        row({ id: 'r1', occurredAt: new Date('2026-04-25T10:00:00.000Z') }),
        row({ id: 'r2', occurredAt: new Date('2026-04-25T10:00:01.000Z') }),
        row({ id: 'r3', occurredAt: new Date('2026-04-25T10:00:02.000Z') }),
      ]);
      const s3 = makeS3Stub();
      const svc = new AuditS3MirrorService(makeEnv(), fake.client as never, s3.client);
      const r = await svc.runOnce();
      expect(r.rows).toBe(2);
      // r3 sigue pendiente para el próximo tick.
      const r3 = fake.rows.find((r) => r.id === 'r3');
      expect(r3?.mirroredToS3).toBe(false);
    } finally {
      delete process.env.AUDIT_MIRROR_BATCH_LIMIT;
    }
  });

  it('runOnce: re-entrancia → segundo runOnce concurrente devuelve no-op', async () => {
    const fake = makeFakePrisma([row({ id: 'r1' })]);
    // S3 stub que demora un poco para que las dos invocaciones se solapen.
    let releaseFirst!: () => void;
    const firstDone = new Promise<void>((res) => {
      releaseFirst = res;
    });
    const sendMock = jest.fn(async (cmd: unknown) => {
      if (cmd instanceof PutObjectCommand) {
        await firstDone;
        return { ETag: '"ok"' };
      }
      return {};
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client: any = { send: sendMock };
    const svc = new AuditS3MirrorService(makeEnv(), fake.client as never, client as S3Client);

    const p1 = svc.runOnce();
    // Pequeño tick para asegurar que p1 entró al PUT.
    await new Promise((r) => setImmediate(r));
    expect(svc.isRunning()).toBe(true);
    const r2 = await svc.runOnce();
    expect(r2).toEqual({ batches: 0, rows: 0, failedBatches: 0 });
    releaseFirst();
    const r1 = await p1;
    expect(r1.batches).toBe(1);
  });

  it('serializeAuditRow: matchea el shape esperado por verifyChain (source=s3)', () => {
    const occurredAt = new Date('2026-04-25T10:00:00.123Z');
    const out = serializeAuditRow({
      id: 'r1',
      tenantId: TENANT_A,
      actorId: 'actor-1',
      action: 'create',
      resourceType: 'insureds',
      resourceId: 'ins-1',
      ip: '127.0.0.1',
      userAgent: 'jest',
      payloadDiff: { body: { fullName: 'Juan' } },
      traceId: 'trace-1',
      occurredAt,
      prevHash: '0'.repeat(64),
      rowHash: 'a'.repeat(64),
    });
    expect(out).toEqual({
      id: 'r1',
      tenantId: TENANT_A,
      actorId: 'actor-1',
      action: 'create',
      resourceType: 'insureds',
      resourceId: 'ins-1',
      ip: '127.0.0.1',
      userAgent: 'jest',
      payloadDiff: { body: { fullName: 'Juan' } },
      traceId: 'trace-1',
      occurredAt: '2026-04-25T10:00:00.123Z',
      prevHash: '0'.repeat(64),
      rowHash: 'a'.repeat(64),
    });
  });
});

describe('AuditS3MirrorService.readAllForTenant', () => {
  beforeAll(() => {
    process.env.NODE_ENV = 'test';
  });

  it('lista keys con prefix, descarga, parsea NDJSON, ordena por occurredAt', async () => {
    const fake = makeFakePrisma([]);
    const ndjsonContent = [
      JSON.stringify({
        id: 'r2',
        tenantId: TENANT_A,
        actorId: null,
        action: 'create',
        resourceType: 'insureds',
        resourceId: null,
        ip: null,
        userAgent: null,
        payloadDiff: null,
        traceId: null,
        occurredAt: '2026-04-25T11:00:00.000Z',
        prevHash: '0'.repeat(64),
        rowHash: 'b'.repeat(64),
      }),
      JSON.stringify({
        id: 'r1',
        tenantId: TENANT_A,
        actorId: null,
        action: 'create',
        resourceType: 'insureds',
        resourceId: null,
        ip: null,
        userAgent: null,
        payloadDiff: null,
        traceId: null,
        occurredAt: '2026-04-25T10:00:00.000Z',
        prevHash: '0'.repeat(64),
        rowHash: 'a'.repeat(64),
      }),
    ].join('\n');
    const sendMock = jest.fn(async (cmd: unknown) => {
      if (cmd instanceof ListObjectsV2Command) {
        return {
          Contents: [{ Key: `audit/${TENANT_A}/2026/04/25/20260425T100000000Z.ndjson` }],
          IsTruncated: false,
        };
      }
      if (cmd instanceof GetObjectCommand) {
        return { Body: Readable.from([ndjsonContent]) };
      }
      return {};
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client: any = { send: sendMock };
    const svc = new AuditS3MirrorService(makeEnv(), fake.client as never, client as S3Client);
    const rows = await svc.readAllForTenant(TENANT_A);
    expect(rows).toHaveLength(2);
    // Ordenadas por occurredAt asc.
    expect(rows[0]!.id).toBe('r1');
    expect(rows[1]!.id).toBe('r2');
    // ListObjectsV2Command llamado con el prefix correcto.
    const listCall = sendMock.mock.calls.find((c) => c[0] instanceof ListObjectsV2Command);
    expect((listCall?.[0] as ListObjectsV2Command).input.Prefix).toBe(`audit/${TENANT_A}/`);
  });
});
