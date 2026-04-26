import { Injectable, NotImplementedException } from '@nestjs/common';

@Injectable()
export class CertificatesService {
  list(): never {
    throw new NotImplementedException('CertificatesService.list');
  }
  findOne(): never {
    throw new NotImplementedException('CertificatesService.findOne');
  }
  presignedUrl(): never {
    throw new NotImplementedException('CertificatesService.presignedUrl');
  }
  reissue(): never {
    throw new NotImplementedException('CertificatesService.reissue');
  }
}
