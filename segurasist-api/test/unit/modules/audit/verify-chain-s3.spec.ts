/**
 * Unit tests del verificador de cadena hash desde S3 (Sprint 2 — S2-07).
 *
 * Validamos `verifyChainFromMirror` (parser NDJSON + recompute) y la lógica
 * cross-source de `AuditChainVerifierService.verify(source='both')`.
 *
 * Estrategia: construimos un set de filas mirroreadas con SHA-256 reales
 * (computeRowHash) — NO mockeamos crypto. La cadena válida pasa el verifier;
 * tampering en S3 o discrepancia DB↔S3 dispara `valid=false`.
 */
/* eslint-disable @typescript-eslint/no-non-null-assertion -- noUncheckedIndexedAccess obliga a `!` en accesos a array que sabemos que están en rango (test fixtures con length conocido). */
import {
  AuditChainVerifierService,
  verifyChainFromMirror,
} from '../../../../src/modules/audit/audit-chain-verifier.service';
import { computeRowHash, GENESIS_HASH } from '../../../../src/modules/audit/audit-hash';
import type {
  AuditS3MirrorService,
  MirroredAuditRow,
} from '../../../../src/modules/audit/audit-s3-mirror.service';
import type {
  AuditChainVerification,
  AuditWriterService,
} from '../../../../src/modules/audit/audit-writer.service';

const TENANT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

interface ChainSeed {
  id: string;
  occurredAt: Date;
  payloadDiff: unknown;
}

function buildChain(seeds: ChainSeed[]): MirroredAuditRow[] {
  const rows: MirroredAuditRow[] = [];
  let prev = GENESIS_HASH;
  for (const s of seeds) {
    const rowHash = computeRowHash({
      prevHash: prev,
      tenantId: TENANT,
      actorId: null,
      action: 'create',
      resourceType: 'insureds',
      resourceId: null,
      payloadDiff: s.payloadDiff,
      occurredAt: s.occurredAt,
    });
    rows.push({
      id: s.id,
      tenantId: TENANT,
      actorId: null,
      action: 'create',
      resourceType: 'insureds',
      resourceId: null,
      ip: null,
      userAgent: null,
      payloadDiff: s.payloadDiff,
      traceId: null,
      occurredAt: s.occurredAt.toISOString(),
      prevHash: prev,
      rowHash,
    });
    prev = rowHash;
  }
  return rows;
}

describe('verifyChainFromMirror (NDJSON parser + recompute)', () => {
  it('cadena íntegra → valid=true, totalRows correcto', () => {
    const rows = buildChain([
      { id: 'r1', occurredAt: new Date('2026-04-25T10:00:00.000Z'), payloadDiff: { v: 1 } },
      { id: 'r2', occurredAt: new Date('2026-04-25T10:00:01.000Z'), payloadDiff: { v: 2 } },
      { id: 'r3', occurredAt: new Date('2026-04-25T10:00:02.000Z'), payloadDiff: { v: 3 } },
    ]);
    const res = verifyChainFromMirror(rows);
    expect(res.valid).toBe(true);
    expect(res.totalRows).toBe(3);
    expect(res.brokenAtId).toBeUndefined();
  });

  it('vacío → valid=true, totalRows=0 (no hay nada que verificar)', () => {
    const res = verifyChainFromMirror([]);
    expect(res.valid).toBe(true);
    expect(res.totalRows).toBe(0);
  });

  it('tampering en payloadDiff de fila intermedia → valid=false, brokenAtId apunta a esa fila', () => {
    const rows = buildChain([
      { id: 'r1', occurredAt: new Date('2026-04-25T10:00:00.000Z'), payloadDiff: { v: 1 } },
      { id: 'r2', occurredAt: new Date('2026-04-25T10:00:01.000Z'), payloadDiff: { v: 2 } },
      { id: 'r3', occurredAt: new Date('2026-04-25T10:00:02.000Z'), payloadDiff: { v: 3 } },
    ]);
    rows[1]!.payloadDiff = { v: 999 }; // tampered
    const res = verifyChainFromMirror(rows);
    expect(res.valid).toBe(false);
    expect(res.brokenAtId).toBe('r2');
  });

  it('prev_hash adulterado en segunda fila → valid=false', () => {
    const rows = buildChain([
      { id: 'r1', occurredAt: new Date('2026-04-25T10:00:00.000Z'), payloadDiff: null },
      { id: 'r2', occurredAt: new Date('2026-04-25T10:00:01.000Z'), payloadDiff: null },
    ]);
    rows[1]!.prevHash = '0'.repeat(64); // ya no apunta al row_hash de r1
    const res = verifyChainFromMirror(rows);
    expect(res.valid).toBe(false);
    expect(res.brokenAtId).toBe('r2');
  });

  it('row_hash adulterado → valid=false en esa fila', () => {
    const rows = buildChain([
      { id: 'r1', occurredAt: new Date('2026-04-25T10:00:00.000Z'), payloadDiff: null },
    ]);
    rows[0]!.rowHash = 'f'.repeat(64);
    const res = verifyChainFromMirror(rows);
    expect(res.valid).toBe(false);
    expect(res.brokenAtId).toBe('r1');
  });

  it('génesis violado: primera fila con prev_hash != GENESIS → valid=false', () => {
    const rows = buildChain([
      { id: 'r1', occurredAt: new Date('2026-04-25T10:00:00.000Z'), payloadDiff: null },
    ]);
    rows[0]!.prevHash = 'a'.repeat(64);
    const res = verifyChainFromMirror(rows);
    expect(res.valid).toBe(false);
    expect(res.brokenAtId).toBe('r1');
  });
});

describe('AuditChainVerifierService.verify (cross-source)', () => {
  function buildDbRowsFromMirror(rows: MirroredAuditRow[], opts: { mirrored?: boolean } = {}) {
    const mirrored = opts.mirrored ?? true;
    return rows.map((r) => ({
      id: r.id,
      tenantId: r.tenantId,
      actorId: r.actorId,
      action: r.action,
      resourceType: r.resourceType,
      resourceId: r.resourceId,
      payloadDiff: r.payloadDiff,
      occurredAt: new Date(r.occurredAt),
      prevHash: r.prevHash,
      rowHash: r.rowHash,
      mirroredToS3: mirrored,
    }));
  }

  function makeVerifier(opts: {
    dbRows?: ReturnType<typeof buildDbRowsFromMirror>;
    s3Rows?: MirroredAuditRow[];
    dbValid?: boolean;
    dbBrokenAtId?: string;
  }): AuditChainVerifierService {
    const writerStub = {
      verifyChain: jest.fn(
        async (): Promise<AuditChainVerification> => ({
          valid: opts.dbValid ?? true,
          brokenAtId: opts.dbBrokenAtId,
          totalRows: opts.dbRows?.length ?? 0,
        }),
      ),
      verifyChainRows: jest.fn(async () => ({ rows: opts.dbRows ?? [] })),
    } as unknown as AuditWriterService;
    const mirrorStub = {
      readAllForTenant: jest.fn(async (): Promise<MirroredAuditRow[]> => opts.s3Rows ?? []),
    } as unknown as AuditS3MirrorService;
    return new AuditChainVerifierService(writerStub, mirrorStub);
  }

  const seeds: ChainSeed[] = [
    { id: 'r1', occurredAt: new Date('2026-04-25T10:00:00.000Z'), payloadDiff: { v: 1 } },
    { id: 'r2', occurredAt: new Date('2026-04-25T10:00:01.000Z'), payloadDiff: { v: 2 } },
  ];

  it("source='db' delega a writer.verifyChain", async () => {
    const verifier = makeVerifier({ dbValid: true, dbRows: [] });
    const res = await verifier.verify(TENANT, 'db');
    expect(res.source).toBe('db');
    expect(res.valid).toBe(true);
    expect(res.checkedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("source='s3' lee del mirror y verifica chain", async () => {
    const s3Rows = buildChain(seeds);
    const verifier = makeVerifier({ s3Rows });
    const res = await verifier.verify(TENANT, 's3');
    expect(res.source).toBe('s3');
    expect(res.valid).toBe(true);
    expect(res.totalRows).toBe(2);
  });

  it("source='both': DB y S3 coinciden → valid=true sin discrepancias", async () => {
    const s3Rows = buildChain(seeds);
    const dbRows = buildDbRowsFromMirror(s3Rows, { mirrored: true });
    const verifier = makeVerifier({ s3Rows, dbRows });
    const res = await verifier.verify(TENANT, 'both');
    expect(res.source).toBe('both');
    expect(res.valid).toBe(true);
    expect(res.discrepancies).toBeUndefined();
  });

  it("source='both': fila DB con row_hash distinto al de S3 → valid=false con discrepancia row_hash_mismatch", async () => {
    const s3Rows = buildChain(seeds);
    const dbRows = buildDbRowsFromMirror(s3Rows, { mirrored: true });
    // Tamper DB: cambiar row_hash de r2 (simula UPDATE bypass-RLS).
    dbRows[1]!.rowHash = 'f'.repeat(64);
    const verifier = makeVerifier({ s3Rows, dbRows });
    const res = await verifier.verify(TENANT, 'both');
    expect(res.valid).toBe(false);
    expect(res.discrepancies).toBeDefined();
    expect(res.discrepancies).toEqual(
      expect.arrayContaining([expect.objectContaining({ rowId: 'r2', reason: 'row_hash_mismatch' })]),
    );
  });

  it("source='both': filas no mirroreadas todavía NO se reportan como discrepancia", async () => {
    const s3Rows = buildChain([seeds[0]!]); // sólo r1 está en S3
    const dbAll = buildDbRowsFromMirror(buildChain(seeds), { mirrored: true });
    // Marcar r2 como aún no mirroreada.
    dbAll[1]!.mirroredToS3 = false;
    const verifier = makeVerifier({ s3Rows, dbRows: dbAll });
    const res = await verifier.verify(TENANT, 'both');
    expect(res.valid).toBe(true);
    expect(res.discrepancies).toBeUndefined();
  });

  it("source='both': fila en S3 que falta en DB (DELETE post-mirror) → discrepancia missing_in_db", async () => {
    const s3Rows = buildChain(seeds);
    // DB: solo tiene r1, alguien borró r2.
    const dbRows = buildDbRowsFromMirror([s3Rows[0]!], { mirrored: true });
    const verifier = makeVerifier({ s3Rows, dbRows });
    const res = await verifier.verify(TENANT, 'both');
    expect(res.valid).toBe(false);
    expect(res.discrepancies).toEqual(
      expect.arrayContaining([expect.objectContaining({ rowId: 'r2', reason: 'missing_in_db' })]),
    );
  });
});
