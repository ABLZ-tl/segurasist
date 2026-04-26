import { Global, Module } from '@nestjs/common';
import { BounceAlarmService } from './bounce-alarm.service';
import { EmailTemplateResolver } from './email-template-resolver';

/**
 * EmailModule expone resolver de plantillas + alarm de bounce rate. El
 * SesService vive en `infra/aws/aws.module.ts` (global). El email worker
 * (`workers/`) importa ambos.
 */
@Global()
@Module({
  providers: [EmailTemplateResolver, BounceAlarmService],
  exports: [EmailTemplateResolver, BounceAlarmService],
})
export class EmailModule {}
