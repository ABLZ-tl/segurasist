import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import * as presigner from '@aws-sdk/s3-request-presigner';
import type { Env } from '@config/env.schema';
import { S3Service } from './s3.service';

jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: jest.fn(),
}));

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    AWS_REGION: 'mx-central-1',
    AWS_ENDPOINT_URL: 'http://localstack:4566',
    S3_BUCKET_UPLOADS: 'b1',
    S3_BUCKET_CERTIFICATES: 'b2',
    S3_BUCKET_AUDIT: 'b3',
    S3_BUCKET_EXPORTS: 'b4',
    ...overrides,
  } as Env;
}

describe('S3Service', () => {
  it('construye S3Client con forcePathStyle cuando AWS_ENDPOINT_URL está presente', () => {
    const svc = new S3Service(makeEnv());
    const client = (svc as unknown as { client: S3Client }).client;
    expect(client).toBeInstanceOf(S3Client);
  });

  it('construye S3Client sin endpoint override en prod', () => {
    const svc = new S3Service(makeEnv({ AWS_ENDPOINT_URL: undefined }));
    expect((svc as unknown as { client: S3Client }).client).toBeInstanceOf(S3Client);
  });

  it('putObject envía PutObjectCommand al cliente con el input recibido', async () => {
    const svc = new S3Service(makeEnv());
    const sendMock = jest.fn().mockResolvedValue({});
    (svc as unknown as { client: { send: jest.Mock } }).client.send = sendMock;

    await svc.putObject({ Bucket: 'b1', Key: 'k', Body: Buffer.from('x') });
    const cmd = sendMock.mock.calls[0]?.[0] as PutObjectCommand;
    expect(cmd).toBeInstanceOf(PutObjectCommand);
    expect(cmd.input.Bucket).toBe('b1');
    expect(cmd.input.Key).toBe('k');
  });

  it('getPresignedGetUrl construye GetObjectCommand y llama getSignedUrl con expiresIn', async () => {
    const svc = new S3Service(makeEnv());
    (presigner.getSignedUrl as jest.Mock).mockResolvedValue('https://signed.example/abc');

    const url = await svc.getPresignedGetUrl('bucket-x', 'key-x', 600);
    expect(url).toBe('https://signed.example/abc');
    const args = (presigner.getSignedUrl as jest.Mock).mock.calls[0];
    expect(args[1]).toBeInstanceOf(GetObjectCommand);
    expect((args[1] as GetObjectCommand).input).toEqual({ Bucket: 'bucket-x', Key: 'key-x' });
    expect(args[2]).toEqual({ expiresIn: 600 });
  });
});
