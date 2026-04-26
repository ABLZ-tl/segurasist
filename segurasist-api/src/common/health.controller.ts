import { Controller, Get } from '@nestjs/common';
import { HealthCheck, HealthCheckService, PrismaHealthIndicator } from '@nestjs/terminus';
import { PrismaClient } from '@prisma/client';

// Cliente Prisma dedicado al health check: no es request-scoped (no necesita
// contexto de tenant) y NO debe pasar por las políticas RLS. Singleton del
// proceso, conexión perezosa.
const healthClient = new PrismaClient({ log: ['warn', 'error'] });

@Controller({ path: 'health', version: undefined })
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
