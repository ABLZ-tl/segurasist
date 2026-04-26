import { Roles } from '@common/decorators/roles.decorator';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { RolesGuard } from '@common/guards/roles.guard';
import { Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { CertificatesService } from './certificates.service';

@Controller({ path: 'certificates', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
export class CertificatesController {
  constructor(private readonly certs: CertificatesService) {}

  @Get()
  @Roles('admin_segurasist', 'admin_mac', 'operator', 'supervisor', 'insured')
  list() {
    return this.certs.list();
  }

  @Get(':id')
  @Roles('admin_segurasist', 'admin_mac', 'operator', 'supervisor', 'insured')
  findOne(@Param('id', new ParseUUIDPipe()) _id: string) {
    return this.certs.findOne();
  }

  @Get(':id/url')
  @Roles('admin_segurasist', 'admin_mac', 'operator', 'supervisor', 'insured')
  presignedUrl(@Param('id', new ParseUUIDPipe()) _id: string) {
    return this.certs.presignedUrl();
  }

  @Post(':id/reissue')
  @Roles('admin_segurasist', 'admin_mac', 'operator')
  reissue(@Param('id', new ParseUUIDPipe()) _id: string) {
    return this.certs.reissue();
  }
}
