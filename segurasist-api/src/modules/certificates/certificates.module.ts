import { Module } from '@nestjs/common';
import { EmailWorkerService } from '../../workers/email-worker.service';
import { MailpitTrackerService } from '../../workers/mailpit-tracker.service';
import { PdfWorkerService } from '../../workers/pdf-worker.service';
import { CertificatesController } from './certificates.controller';
import { CertificatesService } from './certificates.service';
import { PuppeteerService } from './puppeteer.service';

/**
 * Wireup S2-03 / S2-04. Los workers se registran como providers del módulo
 * para que `OnApplicationBootstrap` arranque el polling al boot del API.
 *
 * NOTA: en NODE_ENV=test los workers detectan el env y NO arrancan el loop;
 * los specs invocan `pollOnce()` / `handleEvent()` directos.
 */
@Module({
  controllers: [CertificatesController],
  providers: [
    CertificatesService,
    PuppeteerService,
    PdfWorkerService,
    EmailWorkerService,
    MailpitTrackerService,
  ],
  exports: [CertificatesService, PuppeteerService],
})
export class CertificatesModule {}
