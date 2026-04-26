import { Global, Module } from '@nestjs/common';
import { CognitoService } from './cognito.service';
import { KmsService } from './kms.service';
import { S3Service } from './s3.service';
import { SecretsService } from './secrets.service';
import { SesService } from './ses.service';
import { SqsService } from './sqs.service';

@Global()
@Module({
  providers: [S3Service, SqsService, SesService, KmsService, CognitoService, SecretsService],
  exports: [S3Service, SqsService, SesService, KmsService, CognitoService, SecretsService],
})
export class AwsModule {}
