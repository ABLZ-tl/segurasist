/**
 * Integration test del bucket S3 con Object Lock COMPLIANCE (Sprint 2 — S2-07).
 *
 * Pre-requisitos: LocalStack 3.7 corriendo en localhost:4566 con
 * `s3,sqs,kms,secretsmanager` services. El test crea SU PROPIO bucket fresh
 * (`segurasist-test-objectlock-<random>`) con TTL corto (1 día) — NO toca el
 * bucket de dev. Limpieza: COMPLIANCE no permite delete antes de TTL, así
 * que el bucket queda "huérfano" hasta que LocalStack se baje (
 * `docker compose down -v`).
 *
 * Cobertura:
 *   1. Bucket nuevo CON Object Lock → PUT objeto OK.
 *   2. DELETE de la versión actual → AccessDenied (Object Lock COMPLIANCE).
 *   3. PUT mismo Key → permite versión nueva, pero la anterior queda lockeada
 *      (versioning + object lock). Verificamos que la version anterior sigue
 *      retrievable y no se puede borrar.
 *   4. Sin Object Lock → DELETE permitido (control negativo).
 */
import { randomBytes } from 'node:crypto';
import type { Readable } from 'node:stream';
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectVersionsCommand,
  PutObjectCommand,
  PutObjectLockConfigurationCommand,
  S3Client,
} from '@aws-sdk/client-s3';

const ENDPOINT = process.env.AWS_ENDPOINT_URL ?? 'http://localhost:4566';
const REGION = process.env.LOCALSTACK_REGION ?? 'us-east-1';

function makeS3(): S3Client {
  return new S3Client({
    region: REGION,
    endpoint: ENDPOINT,
    forcePathStyle: true,
    credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
  });
}

async function streamToString(stream: Readable | undefined): Promise<string> {
  if (!stream) return '';
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
  }
  return Buffer.concat(chunks).toString('utf-8');
}

async function localstackUp(): Promise<boolean> {
  try {
    const res = await fetch(`${ENDPOINT}/_localstack/health`);
    return res.ok;
  } catch {
    return false;
  }
}

describe('S3 Object Lock COMPLIANCE — inmutabilidad (LocalStack)', () => {
  let s3: S3Client;
  let lockedBucket: string;
  let plainBucket: string;
  let skip = false;

  beforeAll(async () => {
    if (!(await localstackUp())) {
      // eslint-disable-next-line no-console
      console.warn('[object-lock-immutability] LocalStack no disponible; skip.');
      skip = true;
      return;
    }
    s3 = makeS3();
    const suffix = randomBytes(4).toString('hex');
    lockedBucket = `segurasist-test-objectlock-${suffix}`;
    plainBucket = `segurasist-test-plain-${suffix}`;

    // Bucket con Object Lock + COMPLIANCE 1 día (TTL corto pero válido —
    // mínimo aceptado: 1 día).
    await s3.send(
      new CreateBucketCommand({
        Bucket: lockedBucket,
        ObjectLockEnabledForBucket: true,
        ...(REGION !== 'us-east-1'
          ? { CreateBucketConfiguration: { LocationConstraint: REGION as never } }
          : {}),
      }),
    );
    // Object Lock implica versioning automático en LocalStack (y AWS real lo
    // mismo). Saltamos PutBucketVersioning porque devuelve InvalidBucketState.
    await s3.send(
      new PutObjectLockConfigurationCommand({
        Bucket: lockedBucket,
        ObjectLockConfiguration: {
          ObjectLockEnabled: 'Enabled',
          Rule: { DefaultRetention: { Mode: 'COMPLIANCE', Days: 1 } },
        },
      }),
    );

    // Bucket de control (sin Object Lock) para validar que el DELETE pasa
    // cuando NO hay protección — descarta falsos positivos del primer test.
    await s3.send(
      new CreateBucketCommand({
        Bucket: plainBucket,
        ...(REGION !== 'us-east-1'
          ? { CreateBucketConfiguration: { LocationConstraint: REGION as never } }
          : {}),
      }),
    );
  }, 60_000);

  it('PUT objeto al bucket con Object Lock → 200 OK, retrievable', async () => {
    if (skip) return;
    const key = 'audit/sample-1.ndjson';
    const body = Buffer.from('{"id":"r1","action":"create"}\n', 'utf-8');
    await s3.send(new PutObjectCommand({ Bucket: lockedBucket, Key: key, Body: body }));

    const got = await s3.send(new GetObjectCommand({ Bucket: lockedBucket, Key: key }));
    const text = await streamToString(got.Body as Readable | undefined);
    expect(text).toContain('"id":"r1"');
  }, 30_000);

  it('DELETE de la versión actual → AccessDenied (COMPLIANCE)', async () => {
    if (skip) return;
    const key = 'audit/sample-1.ndjson';
    // Primero: obtener la VersionId del objeto puesto antes.
    const versions = await s3.send(new ListObjectVersionsCommand({ Bucket: lockedBucket, Prefix: key }));
    const v = versions.Versions?.[0];
    expect(v?.VersionId).toBeDefined();

    let threw = false;
    try {
      await s3.send(new DeleteObjectCommand({ Bucket: lockedBucket, Key: key, VersionId: v?.VersionId }));
    } catch (err) {
      threw = true;
      const msg = err instanceof Error ? err.message : String(err);
      expect(msg).toMatch(/Access\s?Denied|Object is WORM protected|locked|Compliance/i);
    }
    expect(threw).toBe(true);
  }, 30_000);

  it('PUT misma Key crea NUEVA versión; versión previa queda inmutable', async () => {
    if (skip) return;
    const key = 'audit/sample-1.ndjson';
    const newBody = Buffer.from('{"id":"r1","action":"update"}\n', 'utf-8');
    await s3.send(new PutObjectCommand({ Bucket: lockedBucket, Key: key, Body: newBody }));

    // Listar versiones: debe haber al menos 2.
    const versions = await s3.send(new ListObjectVersionsCommand({ Bucket: lockedBucket, Prefix: key }));
    const all = versions.Versions ?? [];
    expect(all.length).toBeGreaterThanOrEqual(2);

    // La versión más vieja (no-latest) sigue retrievable y NO se puede borrar.
    const oldVersion = all.find((v) => !v.IsLatest);
    expect(oldVersion?.VersionId).toBeDefined();
    if (!oldVersion?.VersionId) return;

    const got = await s3.send(
      new GetObjectCommand({ Bucket: lockedBucket, Key: key, VersionId: oldVersion.VersionId }),
    );
    const text = await streamToString(got.Body as Readable | undefined);
    expect(text).toContain('"action":"create"');

    let threw = false;
    try {
      await s3.send(
        new DeleteObjectCommand({
          Bucket: lockedBucket,
          Key: key,
          VersionId: oldVersion.VersionId,
        }),
      );
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  }, 30_000);

  it('control negativo: bucket SIN Object Lock permite DELETE', async () => {
    if (skip) return;
    const key = 'plain/sample.txt';
    await s3.send(new PutObjectCommand({ Bucket: plainBucket, Key: key, Body: Buffer.from('hello') }));
    // Sin VersionId — el bucket plain NO tiene versioning, así que delete
    // directo elimina el objeto.
    await s3.send(new DeleteObjectCommand({ Bucket: plainBucket, Key: key }));

    let stillThere = true;
    try {
      await s3.send(new GetObjectCommand({ Bucket: plainBucket, Key: key }));
    } catch {
      stillThere = false;
    }
    expect(stillThere).toBe(false);
  }, 30_000);
});
