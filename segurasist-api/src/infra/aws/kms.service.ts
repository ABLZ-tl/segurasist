import { DecryptCommand, EncryptCommand, KMSClient } from '@aws-sdk/client-kms';
import { ENV_TOKEN } from '@config/config.module';
import { Env } from '@config/env.schema';
import { Inject, Injectable } from '@nestjs/common';

@Injectable()
export class KmsService {
  private readonly client: KMSClient;
  private readonly keyId: string;

  constructor(@Inject(ENV_TOKEN) env: Env) {
    this.client = new KMSClient({
      region: env.AWS_REGION,
      ...(env.AWS_ENDPOINT_URL ? { endpoint: env.AWS_ENDPOINT_URL } : {}),
    });
    this.keyId = env.KMS_KEY_ID;
  }

  async encrypt(plaintext: Uint8Array): Promise<Uint8Array> {
    const out = await this.client.send(new EncryptCommand({ KeyId: this.keyId, Plaintext: plaintext }));
    if (!out.CiphertextBlob) throw new Error('KMS encrypt: empty ciphertext');
    return out.CiphertextBlob;
  }

  async decrypt(ciphertext: Uint8Array): Promise<Uint8Array> {
    const out = await this.client.send(new DecryptCommand({ CiphertextBlob: ciphertext, KeyId: this.keyId }));
    if (!out.Plaintext) throw new Error('KMS decrypt: empty plaintext');
    return out.Plaintext;
  }
}
