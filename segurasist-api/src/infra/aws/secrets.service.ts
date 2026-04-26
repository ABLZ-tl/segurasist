import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { ENV_TOKEN } from '@config/config.module';
import { Env } from '@config/env.schema';
import { Inject, Injectable } from '@nestjs/common';

@Injectable()
export class SecretsService {
  private readonly client: SecretsManagerClient;
  private readonly cache = new Map<string, { value: string; expiresAt: number }>();

  constructor(@Inject(ENV_TOKEN) env: Env) {
    this.client = new SecretsManagerClient({
      region: env.AWS_REGION,
      ...(env.AWS_ENDPOINT_URL ? { endpoint: env.AWS_ENDPOINT_URL } : {}),
    });
  }

  async getSecretString(secretId: string, ttlMs = 5 * 60 * 1000): Promise<string> {
    const now = Date.now();
    const cached = this.cache.get(secretId);
    if (cached && cached.expiresAt > now) return cached.value;

    const out = await this.client.send(new GetSecretValueCommand({ SecretId: secretId }));
    const value = out.SecretString;
    if (typeof value !== 'string') throw new Error(`Secret ${secretId} has no SecretString`);
    this.cache.set(secretId, { value, expiresAt: now + ttlMs });
    return value;
  }
}
