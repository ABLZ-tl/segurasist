/**
 * Unit tests del AuditWriterService — foco en el hash chain (Sprint 1
 * hardening final).
 *
 * Estrategia: NO mockeamos `crypto.createHash` (la spec lo prohíbe). En su
 * lugar:
 *   - Mockeamos el cliente Prisma con un fake in-memory que registra cada
 *     `auditLog.create` y devuelve filas via `$queryRaw` ordenadas por
 *     occurred_at desc.
 *   - El hash real lo computa el writer (sha256 nativo). Verificamos
 *     determinismo y propagación entre filas.
 *
 * Cobertura:
 *   - Primera fila por tenant: prev_hash = '0'*64.
 *   - Segunda fila: prev_hash = row_hash de la primera.
 *   - Determinismo: mismo input → mismo hash.
 *   - Concurrencia: dos writes serializan vía $transaction (mock simula lock).
 *   - Canonical JSON: keys reordenadas → mismo hash.
 *   - verifyChain: detecta tampering en payloadDiff intermedio.
 */
import { GENESIS_HASH, computeRowHash, canonicalJson } from './audit-hash';
import { AuditWriterService, type AuditEvent } from './audit-writer.service';

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
}

/**
 * Fake Prisma client que satisface el subset usado por AuditWriterService.
 * Implementa $transaction (sequential) y $queryRaw para la lectura del
 * último row_hash con `FOR UPDATE`.
 */
function makeFakePrisma(): {
  client: unknown;
  rows: FakeRow[];
  txOrder: number[];
} {
  const rows: FakeRow[] = [];
  const txOrder: number[] = [];
  let txSeq = 0;

  const auditLog = {
    create: jest.fn(async ({ data }: { data: Omit<FakeRow, 'id'> & { id?: string } }) => {
      const row: FakeRow = {
        id: data.id ?? `row-${rows.length + 1}`,
        ...data,
      };
      rows.push(row);
      return row;
    }),
    findMany: jest.fn(async ({ where }: { where?: { tenantId?: string } }) => {
      const filtered = where?.tenantId ? rows.filter((r) => r.tenantId === where.tenantId) : rows.slice();
      filtered.sort((a, b) => {
        const t = a.occurredAt.getTime() - b.occurredAt.getTime();
        if (t !== 0) return t;
        return a.id.localeCompare(b.id);
      });
      return filtered;
    }),
  };

  // Per-tenant lock simulando `FOR UPDATE`: dos $transaction concurrentes
  // del mismo tenant se serializan. Para tenants distintos: paralelismo libre.
  // Esto refleja la semántica real de Postgres bajo el SELECT FOR UPDATE
  // que el writer emite contra audit_log.tenant_id.
  const tenantLocks = new Map<string, Promise<unknown>>();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client: any = {
    auditLog,
    $queryRaw: jest.fn(async (sql: { values?: unknown[] }) => {
      // Single use case in writer: SELECT row_hash FROM audit_log WHERE tenant_id = $1 ORDER BY ... LIMIT 1.
      // sql es Prisma.Sql; values[0] es el tenantId.
      const tenantId = (sql.values?.[0] as string | undefined) ?? '';
      const filtered = rows.filter((r) => r.tenantId === tenantId);
      if (filtered.length === 0) return [];
      filtered.sort((a, b) => {
        const t = b.occurredAt.getTime() - a.occurredAt.getTime();
        if (t !== 0) return t;
        return b.id.localeCompare(a.id);
      });
      const last = filtered[0];
      if (!last) return [];
      return [{ row_hash: last.rowHash }];
    }),
    $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      const seq = ++txSeq;
      // Para serializar: necesitamos saber el tenantId que la callback va a tocar.
      // Como no podemos inspeccionarlo de antemano, usamos un global lock de
      // tenant resolved al primer $queryRaw. Patch local: envolvemos el
      // $queryRaw del tx para registrar el tenantId y serializar de ahí en
      // adelante. Más simple aún: resolvemos vía un lock GLOBAL secuencial
      // (suficiente para validar la propiedad de encadenamiento sin replicar
      // el modelo de locks per-tenant).
      const prev = tenantLocks.get('__global__') ?? Promise.resolve();
      let release!: () => void;
      const next = new Promise<void>((r) => {
        release = r;
      });
      tenantLocks.set(
        '__global__',
        prev.then(() => next),
      );
      await prev;
      try {
        txOrder.push(seq);
        return await fn(client);
      } finally {
        release();
      }
    }),
    $connect: jest.fn(async () => undefined),
    $disconnect: jest.fn(async () => undefined),
  };

  return { client, rows, txOrder };
}

const TENANT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TENANT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function buildEvent(overrides: Partial<AuditEvent> = {}): AuditEvent {
  return {
    tenantId: TENANT_A,
    actorId: 'actor-1',
    action: 'create',
    resourceType: 'insureds',
    resourceId: 'insured-1',
    payloadDiff: { body: { fullName: 'Juan' } },
    traceId: 'trace-1',
    ...overrides,
  };
}

describe('AuditWriterService (hash chain)', () => {
  let writer: AuditWriterService;
  let fake: ReturnType<typeof makeFakePrisma>;

  beforeEach(() => {
    fake = makeFakePrisma();
    // El constructor del service acepta @Optional() PrismaClient; le pasamos
    // el fake. El cast es seguro: solo exponemos los métodos que el writer usa.
    writer = new AuditWriterService(fake.client as never);
  });

  it("primera fila de tenant: prev_hash = '0' * 64 (génesis)", async () => {
    await writer.record(buildEvent());
    expect(fake.rows).toHaveLength(1);
    const row = fake.rows[0];
    expect(row).toBeDefined();
    expect(row?.prevHash).toBe(GENESIS_HASH);
    expect(row?.rowHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('segunda fila: prev_hash = row_hash de la primera (encadenamiento)', async () => {
    await writer.record(buildEvent({ resourceId: 'insured-1' }));
    await writer.record(buildEvent({ resourceId: 'insured-2' }));
    expect(fake.rows).toHaveLength(2);
    const [first, second] = fake.rows;
    expect(first?.rowHash).toBeDefined();
    expect(second?.prevHash).toBe(first?.rowHash);
    expect(second?.rowHash).not.toBe(first?.rowHash); // distinto contenido → distinto hash
  });

  it('row_hash es determinístico para el mismo input canónico', () => {
    const occurredAt = new Date('2026-04-25T12:00:00.000Z');
    const inputs = {
      prevHash: GENESIS_HASH,
      tenantId: TENANT_A,
      actorId: 'actor-1',
      action: 'create',
      resourceType: 'insureds',
      resourceId: 'insured-1',
      payloadDiff: { body: { fullName: 'Juan', age: 30 } },
      occurredAt,
    };
    const h1 = computeRowHash(inputs);
    const h2 = computeRowHash(inputs);
    expect(h1).toBe(h2);
  });

  it('payloadDiff con keys reordenadas produce mismo row_hash (canonical JSON)', () => {
    const occurredAt = new Date('2026-04-25T12:00:00.000Z');
    const base = {
      prevHash: GENESIS_HASH,
      tenantId: TENANT_A,
      actorId: 'actor-1',
      action: 'create',
      resourceType: 'insureds',
      resourceId: 'insured-1',
      occurredAt,
    };
    const h1 = computeRowHash({
      ...base,
      payloadDiff: { body: { fullName: 'Juan', age: 30 }, query: { p: 1 } },
    });
    // Mismo objeto pero keys insertadas en orden distinto.
    const h2 = computeRowHash({
      ...base,
      payloadDiff: { query: { p: 1 }, body: { age: 30, fullName: 'Juan' } },
    });
    expect(h1).toBe(h2);
  });

  it('canonicalJson maneja arrays, null, números y strings consistentemente', () => {
    expect(canonicalJson({ a: 1, b: 'x', c: [1, 2, 3], d: null })).toBe(
      '{"a":1,"b":"x","c":[1,2,3],"d":null}',
    );
    // Recursivo: keys nesteadas también ordenadas.
    expect(canonicalJson({ z: { b: 2, a: 1 }, a: 1 })).toBe('{"a":1,"z":{"a":1,"b":2}}');
    // undefined omitido.
    expect(canonicalJson({ a: 1, b: undefined })).toBe('{"a":1}');
  });

  it('writes a tenants distintos no colisionan: cada cadena empieza con su génesis', async () => {
    await writer.record(buildEvent({ tenantId: TENANT_A }));
    await writer.record(buildEvent({ tenantId: TENANT_B }));
    await writer.record(buildEvent({ tenantId: TENANT_A }));

    const tA = fake.rows.filter((r) => r.tenantId === TENANT_A);
    const tB = fake.rows.filter((r) => r.tenantId === TENANT_B);
    expect(tA[0]?.prevHash).toBe(GENESIS_HASH);
    expect(tB[0]?.prevHash).toBe(GENESIS_HASH);
    // Segunda fila de A apunta a la primera de A, NO a la fila de B.
    expect(tA[1]?.prevHash).toBe(tA[0]?.rowHash);
  });

  it('writes concurrentes mismo tenant: el segundo lee el row_hash del primero', async () => {
    // El fake $transaction es secuencial: la await a $queryRaw y create
    // dentro de la promesa garantiza que el seq#2 vea seq#1 commited.
    // Verificamos que las dos transacciones se ejecutaron y el segundo
    // prev_hash = primer row_hash.
    await Promise.all([
      writer.record(buildEvent({ resourceId: 'a' })),
      writer.record(buildEvent({ resourceId: 'b' })),
    ]);
    expect(fake.rows).toHaveLength(2);
    expect(fake.txOrder).toHaveLength(2);
    const [first, second] = fake.rows;
    // El encadenamiento debe ser perfecto: prev_hash del segundo = row_hash del primero.
    expect(second?.prevHash).toBe(first?.rowHash);
    expect(second?.prevHash).not.toBe(GENESIS_HASH);
  });

  it('verifyChain: cadena íntegra → valid=true', async () => {
    await writer.record(buildEvent({ resourceId: 'a' }));
    await writer.record(buildEvent({ resourceId: 'b' }));
    await writer.record(buildEvent({ resourceId: 'c' }));
    const res = await writer.verifyChain(TENANT_A);
    expect(res.valid).toBe(true);
    expect(res.totalRows).toBe(3);
    expect(res.brokenAtId).toBeUndefined();
  });

  it('verifyChain: tampering de payloadDiff → valid=false con brokenAtId', async () => {
    await writer.record(buildEvent({ resourceId: 'a' }));
    await writer.record(buildEvent({ resourceId: 'b' }));
    await writer.record(buildEvent({ resourceId: 'c' }));
    // Tamper: modificamos payloadDiff de la fila intermedia (sin re-hashear).
    const mid = fake.rows[1];
    expect(mid).toBeDefined();
    if (mid) {
      mid.payloadDiff = { body: { fullName: 'TAMPERED' } };
    }
    const res = await writer.verifyChain(TENANT_A);
    expect(res.valid).toBe(false);
    expect(res.brokenAtId).toBe(mid?.id);
    expect(res.totalRows).toBe(3);
  });

  it('verifyChain: prev_hash adulterado → valid=false', async () => {
    await writer.record(buildEvent({ resourceId: 'a' }));
    await writer.record(buildEvent({ resourceId: 'b' }));
    const second = fake.rows[1];
    if (second) second.prevHash = '0'.repeat(64); // re-asignar a génesis (rompe encadenamiento)
    const res = await writer.verifyChain(TENANT_A);
    expect(res.valid).toBe(false);
    expect(res.brokenAtId).toBe(second?.id);
  });
});
