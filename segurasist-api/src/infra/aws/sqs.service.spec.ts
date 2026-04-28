import { SendMessageCommand } from '@aws-sdk/client-sqs';
import type { Env } from '@config/env.schema';
import { SqsService } from './sqs.service';

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    AWS_REGION: 'mx-central-1',
    AWS_ENDPOINT_URL: 'http://localstack:4566',
    ...overrides,
  } as Env;
}

describe('SqsService', () => {
  it('sendMessage despacha SendMessageCommand con QueueUrl y MessageBody serializado', async () => {
    const svc = new SqsService(makeEnv());
    const sendMock = jest.fn().mockResolvedValue({ MessageId: 'mid-1' });
    (svc as unknown as { client: { send: jest.Mock } }).client.send = sendMock;

    const id = await svc.sendMessage('http://q', { foo: 'bar' });
    const cmd = sendMock.mock.calls[0]?.[0] as SendMessageCommand;
    expect(cmd).toBeInstanceOf(SendMessageCommand);
    expect(cmd.input.QueueUrl).toBe('http://q');
    expect(cmd.input.MessageBody).toBe('{"foo":"bar"}');
    // C-09 — colas standard: NUNCA debe enviarse MessageDeduplicationId, ni
    // siquiera si un caller (legacy) intenta pasar argumentos extra. Garantía
    // estructural: la firma del método ya no acepta el parámetro.
    expect(cmd.input.MessageDeduplicationId).toBeUndefined();
    expect(cmd.input.MessageGroupId).toBeUndefined();
    expect(id).toBe('mid-1');
  });

  it('NO emite MessageDeduplicationId aún si el caller (TS-coerced) intenta pasarlo', async () => {
    const svc = new SqsService(makeEnv());
    const sendMock = jest.fn().mockResolvedValue({ MessageId: 'mid-x' });
    (svc as unknown as { client: { send: jest.Mock } }).client.send = sendMock;

    // El siguiente cast simula un call-site legacy que aún tiene el dedupeId
    // TS ignorará el 3er argumento; lo importante es validar que SqsService
    // físicamente NO lo propaga al SDK.
    await (
      svc.sendMessage as unknown as (
        url: string,
        body: Record<string, unknown>,
        dedupe?: string,
      ) => Promise<string | undefined>
    )('http://q', { x: 1 }, 'should-be-ignored');

    const cmd = sendMock.mock.calls[0]?.[0] as SendMessageCommand;
    expect(cmd.input.MessageDeduplicationId).toBeUndefined();
    expect(cmd.input.MessageGroupId).toBeUndefined();
  });

  it('devuelve undefined si SQS no devuelve MessageId (caso borde)', async () => {
    const svc = new SqsService(makeEnv());
    (svc as unknown as { client: { send: jest.Mock } }).client.send = jest.fn().mockResolvedValue({});
    await expect(svc.sendMessage('http://q', {})).resolves.toBeUndefined();
  });
});
