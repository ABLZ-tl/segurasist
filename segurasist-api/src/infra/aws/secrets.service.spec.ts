import { GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import type { Env } from '@config/env.schema';
import { SecretsService } from './secrets.service';

function makeEnv(): Env {
  return {
    AWS_REGION: 'mx-central-1',
    AWS_ENDPOINT_URL: 'http://localstack:4566',
  } as Env;
}

describe('SecretsService', () => {
  let svc: SecretsService;
  let sendMock: jest.Mock;

  beforeEach(() => {
    svc = new SecretsService(makeEnv());
    sendMock = jest.fn();
    (svc as unknown as { client: { send: jest.Mock } }).client.send = sendMock;
  });

  it('getSecretString despacha GetSecretValueCommand y devuelve SecretString', async () => {
    sendMock.mockResolvedValue({ SecretString: 'super-secret' });
    const v = await svc.getSecretString('arn:my:secret');
    expect(v).toBe('super-secret');
    const cmd = sendMock.mock.calls[0]?.[0] as GetSecretValueCommand;
    expect(cmd).toBeInstanceOf(GetSecretValueCommand);
    expect(cmd.input.SecretId).toBe('arn:my:secret');
  });

  it('cachea por TTL: la 2da llamada NO toca el cliente', async () => {
    sendMock.mockResolvedValue({ SecretString: 'v1' });
    const a = await svc.getSecretString('s1', 60_000);
    const b = await svc.getSecretString('s1', 60_000);
    expect(a).toBe('v1');
    expect(b).toBe('v1');
    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  it('refetch cuando el TTL expira', async () => {
    jest.useFakeTimers();
    sendMock.mockResolvedValueOnce({ SecretString: 'v1' });
    sendMock.mockResolvedValueOnce({ SecretString: 'v2' });

    const a = await svc.getSecretString('s2', 1_000);
    expect(a).toBe('v1');
    jest.advanceTimersByTime(2_000);
    const b = await svc.getSecretString('s2', 1_000);
    expect(b).toBe('v2');
    expect(sendMock).toHaveBeenCalledTimes(2);
    jest.useRealTimers();
  });

  it('lanza si SecretsManager responde sin SecretString', async () => {
    sendMock.mockResolvedValue({});
    await expect(svc.getSecretString('s3')).rejects.toThrow(/has no SecretString/);
  });

  it('cachea por secretId — secrets distintos requieren llamadas distintas', async () => {
    sendMock.mockResolvedValueOnce({ SecretString: 'a' });
    sendMock.mockResolvedValueOnce({ SecretString: 'b' });
    expect(await svc.getSecretString('A')).toBe('a');
    expect(await svc.getSecretString('B')).toBe('b');
    expect(sendMock).toHaveBeenCalledTimes(2);
  });
});
