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
}
