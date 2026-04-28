/**
 * C-09 — SqsService: el cambio arquitectónico que quitó `dedupeId` /
 * `MessageDeduplicationId` debe verificarse end-to-end. Mockeamos el
 * `SQSClient.send` interno y validamos que el comando enviado al SDK
 * NUNCA incluye `MessageDeduplicationId` ni `MessageGroupId` (los workers
 * legacy podrían intentar pasar argumentos extra; este test es el regresion
 * gate que cierra el bug operacional #1 — 5 agentes lo confirmaron en
 * Sprint 3).
 *
 * NO requiere Postgres ni LocalStack: corre en cualquier suite (unit o
 * integration) por ser un mock-only test.
 */
import type { SendMessageCommand } from '@aws-sdk/client-sqs';
import type { Env } from '../../src/config/env.schema';
import { SqsService } from '../../src/infra/aws/sqs.service';

function makeEnv(): Env {
  return {
    AWS_REGION: 'mx-central-1',
    AWS_ENDPOINT_URL: 'http://localstack:4566',
  } as Env;
}

interface ClientLike {
  send: jest.Mock;
}

function withMockedSqs(svc: SqsService): ClientLike {
  const mock = jest.fn().mockResolvedValue({ MessageId: 'm-1' });
  (svc as unknown as { client: ClientLike }).client.send = mock;
  return (svc as unknown as { client: ClientLike }).client;
}

describe('SqsService — C-09 dedupeId removal', () => {
  it('NO incluye MessageDeduplicationId en standard queue (call básico)', async () => {
    const svc = new SqsService(makeEnv());
    const client = withMockedSqs(svc);

    await svc.sendMessage('http://localstack:4566/000000000000/insureds-creation-queue', {
      kind: 'insured.create',
      tenantId: 't-1',
      batchId: 'b-1',
      rowNumber: 7,
    });

    expect(client.send).toHaveBeenCalledTimes(1);
    const cmd = client.send.mock.calls[0]?.[0] as SendMessageCommand;
    expect(cmd.input.MessageDeduplicationId).toBeUndefined();
    expect(cmd.input.MessageGroupId).toBeUndefined();
    expect(cmd.input.QueueUrl).toContain('insureds-creation-queue');
  });

  it('NO propaga MessageDeduplicationId aunque el caller use cast TS para forzarlo', async () => {
    const svc = new SqsService(makeEnv());
    const client = withMockedSqs(svc);

    // Caller "legacy": signature anterior aceptaba (url, body, dedupeId).
    // El cast `as unknown as ...` simula un worker que aún no fue limpiado.
    await (
      svc.sendMessage as unknown as (
        url: string,
        body: Record<string, unknown>,
        dedupe?: string,
      ) => Promise<string | undefined>
    )('http://q', { x: 1 }, 'batch-99:row-3');

    const cmd = client.send.mock.calls[0]?.[0] as SendMessageCommand;
    expect(cmd.input.MessageDeduplicationId).toBeUndefined();
  });

  it('serializa el body como JSON (regression del comportamiento previo)', async () => {
    const svc = new SqsService(makeEnv());
    const client = withMockedSqs(svc);

    await svc.sendMessage('http://q', { kind: 'batch.preview_ready', batchId: 'b-1' });
    const cmd = client.send.mock.calls[0]?.[0] as SendMessageCommand;
    expect(cmd.input.MessageBody).toBe('{"kind":"batch.preview_ready","batchId":"b-1"}');
  });

  it('multi-call: 100 mensajes en standard queue, ninguno con MessageDeduplicationId', async () => {
    const svc = new SqsService(makeEnv());
    const client = withMockedSqs(svc);

    for (let i = 0; i < 100; i += 1) {
      await svc.sendMessage('http://q', { i });
    }
    expect(client.send).toHaveBeenCalledTimes(100);
    for (const call of client.send.mock.calls) {
      const cmd = call[0] as SendMessageCommand;
      expect(cmd.input.MessageDeduplicationId).toBeUndefined();
      expect(cmd.input.MessageGroupId).toBeUndefined();
    }
  });
});
