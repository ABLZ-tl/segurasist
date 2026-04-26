import { Controller, Get } from '@nestjs/common';
import { HealthCheck, HealthCheckService, PrismaHealthIndicator } from '@nestjs/terminus';
import { PrismaClient } from '@prisma/client';
import { SkipThrottle } from './throttler/throttler.decorators';

// Cliente Prisma dedicado al health check: no es request-scoped (no necesita
// contexto de tenant) y NO debe pasar por las políticas RLS. Singleton del
// proceso, conexión perezosa.
const healthClient = new PrismaClient({ log: ['warn', 'error'] });

@Controller({ path: 'health', version: undefined })
// Health endpoints exentos del rate limiter: ALB / App Runner los hace
// constantemente y los usa para gating de rolling deploys. Bloquearlos por
// cuota tirarí­a el servicio en un autoscaling event.
@SkipThrottle()
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly prismaIndicator: PrismaHealthIndicator,
  ) {}

  @Get('live')
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  @Get('ready')
  @HealthCheck()
  async ready(): ReturnType<HealthCheckService['check']> {
    return this.health.check([
      (): ReturnType<PrismaHealthIndicator['pingCheck']> =>
        this.prismaIndicator.pingCheck('database', healthClient, { timeout: 200 }),
    ]);
  }
}
