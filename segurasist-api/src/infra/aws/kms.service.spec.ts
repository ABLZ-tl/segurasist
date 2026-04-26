import { DecryptCommand, EncryptCommand } from '@aws-sdk/client-kms';
import type { Env } from '@config/env.schema';
import { KmsService } from './kms.service';

function makeEnv(): Env {
  return {
    AWS_REGION: 'mx-central-1',
    AWS_ENDPOINT_URL: 'http://localstack:4566',
    KMS_KEY_ID: 'alias/test',
  } as Env;
}

describe('KmsService', () => {
  let svc: KmsService;
  let sendMock: jest.Mock;

  beforeEach(() => {
    svc = new KmsService(makeEnv());
    sendMock = jest.fn();
    (svc as unknown as { client: { send: jest.Mock } }).client.send = sendMock;
  });

  it('encrypt despacha EncryptCommand con KeyId y Plaintext', async () => {
    sendMock.mockResolvedValue({ CiphertextBlob: new Uint8Array([1, 2, 3]) });
    const out = await svc.encrypt(new Uint8Array([9]));
    const cmd = sendMock.mock.calls[0]?.[0] as EncryptCommand;
    expect(cmd).toBeInstanceOf(EncryptCommand);
    expect(cmd.input.KeyId).toBe('alias/test');
    expect(cmd.input.Plaintext).toEqual(new Uint8Array([9]));
    expect(out).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('encrypt lanza si KMS responde sin CiphertextBlob', async () => {
    sendMock.mockResolvedValue({});
    await expect(svc.encrypt(new Uint8Array([1]))).rejects.toThrow('KMS encrypt: empty ciphertext');
  });

  it('decrypt despacha DecryptCommand con CiphertextBlob y KeyId', async () => {
    sendMock.mockResolvedValue({ Plaintext: new Uint8Array([7]) });
    const out = await svc.decrypt(new Uint8Array([1, 2]));
    const cmd = sendMock.mock.calls[0]?.[0] as DecryptCommand;
    expect(cmd).toBeInstanceOf(DecryptCommand);
    expect(cmd.input.CiphertextBlob).toEqual(new Uint8Array([1, 2]));
    expect(cmd.input.KeyId).toBe('alias/test');
    expect(out).toEqual(new Uint8Array([7]));
  });

  it('decrypt lanza si KMS responde sin Plaintext', async () => {
    sendMock.mockResolvedValue({});
    await expect(svc.decrypt(new Uint8Array([1]))).rejects.toThrow('KMS decrypt: empty plaintext');
  });
});
