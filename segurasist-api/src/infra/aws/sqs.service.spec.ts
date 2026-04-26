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
    expect(cmd.input.MessageDeduplicationId).toBeUndefined();
    expect(id).toBe('mid-1');
  });

  it('incluye MessageDeduplicationId si se pasa (FIFO queues)', async () => {
    const svc = new SqsService(makeEnv());
    const sendMock = jest.fn().mockResolvedValue({ MessageId: 'mid-2' });
    (svc as unknown as { client: { send: jest.Mock } }).client.send = sendMock;

    await svc.sendMessage('http://q.fifo', { x: 1 }, 'dedupe-1');
    const cmd = sendMock.mock.calls[0]?.[0] as SendMessageCommand;
    expect(cmd.input.MessageDeduplicationId).toBe('dedupe-1');
  });

  it('devuelve undefined si Cognito no devuelve MessageId (caso borde, no debería pasar)', async () => {
    const svc = new SqsService(makeEnv());
    (svc as unknown as { client: { send: jest.Mock } }).client.send = jest.fn().mockResolvedValue({});
    await expect(svc.sendMessage('http://q', {})).resolves.toBeUndefined();
  });
});
