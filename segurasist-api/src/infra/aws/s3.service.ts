import { GetObjectCommand, PutObjectCommand, S3Client, type PutObjectCommandInput } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { ENV_TOKEN } from '@config/config.module';
import { Env } from '@config/env.schema';
import { Inject, Injectable } from '@nestjs/common';

@Injectable()
export class S3Service {
  private readonly client: S3Client;

  constructor(@Inject(ENV_TOKEN) env: Env) {
    this.client = new S3Client({
      region: env.AWS_REGION,
      ...(env.AWS_ENDPOINT_URL ? { endpoint: env.AWS_ENDPOINT_URL, forcePathStyle: true } : {}),
    });
  }

  async putObject(input: PutObjectCommandInput): Promise<void> {
    await this.client.send(new PutObjectCommand(input));
  }

  async getPresignedGetUrl(bucket: string, key: string, ttlSeconds: number): Promise<string> {
    const cmd = new GetObjectCommand({ Bucket: bucket, Key: key });
    return getSignedUrl(this.client, cmd, { expiresIn: ttlSeconds });
  }

  /**
   * Descarga un objeto S3 y devuelve su contenido como Buffer. Usado por los
   * workers para leer el archivo subido y procesarlo. NO usar en handlers
   * HTTP — para descargas de usuario preferir presigned URL (sin pasar el
   * Body por nuestros servidores).
   */
  async getObject(bucket: string, key: string): Promise<Buffer> {
    const out = await this.client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    if (!out.Body) {
      throw new Error(`S3.getObject: cuerpo vacío para s3://${bucket}/${key}`);
    }
    // El SDK v3 devuelve un stream Node; lo agregamos a Buffer.
    const chunks: Buffer[] = [];
    const stream = out.Body as NodeJS.ReadableStream;
    for await (const chunk of stream) {
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
    }
    return Buffer.concat(chunks);
  }

  /**
   * Devuelve el cliente S3 nativo. Útil para los workers que necesitan
   * comandos no envueltos (e.g. ListObjectsV2). Mantener el set de wrappers
   * arriba para los casos comunes.
   */
  getClient(): S3Client {
    return this.client;
  }
}
